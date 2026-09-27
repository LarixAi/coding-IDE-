const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { ModelProvider, OllamaModelProvider, ReadOnlyToolProvider, ControlledToolProvider, ToolRegistry, ExternalCapabilityProvider, RunStore, createRun, startAgentRun, resumeRun } = require("../index.js");

const FIXTURE = path.join(__dirname, "../../qwen-qualify/fixture");
const MODEL = process.env.CODEME_QWEN_MODEL || "qwen3.5:9b";
const OLLAMA = process.env.CODEME_OLLAMA_URL || "http://127.0.0.1:11434";

class ScriptedModelProvider extends ModelProvider {
  constructor(steps) {
    super("scripted");
    this.steps = [...steps];
    this.calls = [];
  }

  async complete(input) {
    this.calls.push(input);
    if (input.signal && input.signal.aborted) {
      throw Object.assign(new Error("model call cancelled"), { code: "cancelled" });
    }
    const step = this.steps.shift();
    if (!step) throw Object.assign(new Error("no scripted decision"), { code: "model_disconnected" });
    if (step.waitForAbort) {
      await new Promise((resolve, reject) => {
        const fail = () => reject(Object.assign(new Error("model call cancelled"), { code: "cancelled" }));
        if (input.signal && input.signal.aborted) return fail();
        input.signal.addEventListener("abort", fail);
      });
    }
    if (step.error) throw step.error;
    return { text: step.text || "", toolCalls: step.toolCalls || [] };
  }
}

class RecordingModelProvider extends ModelProvider {
  constructor(inner) {
    super(inner.name);
    this.inner = inner;
    this.calls = [];
  }

  async complete(input) {
    this.calls.push({ messages: input.messages, tools: input.tools, model: input.model });
    return this.inner.complete(input);
  }
}

function workspaceHost(root, hooks = {}) {
  const state = { reads: 0, writes: 0, searches: 0 };
  const host = {
    state,
    async readFile(filePath) {
      state.reads += 1;
      if (hooks.readFile) return hooks.readFile(filePath);
      const full = path.resolve(root, filePath);
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
        throw Object.assign(new Error(`File not found: ${filePath}`), { code: "not_found" });
      }
      return { path: filePath, contents: fs.readFileSync(full, "utf8") };
    },
    async search(query) {
      state.searches += 1;
      const matches = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === ".git") continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.isFile() && fs.readFileSync(full, "utf8").includes(query)) {
            matches.push({ path: path.relative(root, full) });
          }
        }
      };
      walk(root);
      return { query, matches };
    },
    async writeFile() {
      state.writes += 1;
      return { wrote: true };
    },
    async gitStatus() {
      return { porcelain: "" };
    },
    async gitDiff() {
      return { diff: "" };
    },
    async diagnostics() {
      return { items: [] };
    },
    async browserCheck(url) {
      return { available: false, code: "browser_unavailable", message: "No browser runner is configured", url };
    },
  };
  return host;
}

function trackedStore(directory) {
  const store = new RunStore(directory);
  const lifecycles = [];
  const save = store.save.bind(store);
  store.save = (run) => {
    lifecycles.push(run.lifecycle);
    return save(run);
  };
  return { store, lifecycles };
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codeme-agent-run-"));
}

async function test(name, fn) {
  try {
    await fn();
    console.log("ok", name);
  } catch (error) {
    console.error("fail", name);
    console.error(error);
    process.exitCode = 1;
  }
}

function quoteRun(run) {
  return JSON.stringify({ lifecycle: run.lifecycle, outcome: run.outcome, tools: run.toolCalls.map((call) => call.name), verification: run.verification }, null, 2);
}

function ollamaAvailable() {
  if (process.env.CODEME_SKIP_LIVE === "1") return Promise.resolve(false);
  return new Promise((resolve) => {
    const req = http.get(new URL("/api/tags", OLLAMA), { timeout: 800 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function main() {
  await test("run ids differ and the goal is stored", async () => {
    const first = createRun({ goal: "find the badge", model: MODEL, providerName: "ollama" });
    const second = createRun({ goal: "find the badge", model: MODEL, providerName: "ollama" });
    assert.notStrictEqual(first.id, second.id);
    assert.strictEqual(first.goal, "find the badge");
    assert.strictEqual(first.requestedModel, first.effectiveModel);
    assert.deepStrictEqual(first.filesChanged, []);
    assert.strictEqual(first.outcome, null);
  });

  await test("the agent loop does not talk to Ollama directly", async () => {
    const source = fs.readFileSync(path.join(__dirname, "../agent-run.js"), "utf8");
    assert.strictEqual(source.includes("ollama"), false);
    assert.strictEqual(source.includes("11434"), false);
    assert.strictEqual(source.includes("executeReadOnly"), false);
    assert.strictEqual(source.includes("registry.call"), true);
  });

  await test("workspace inspection is injected before the first model turn", async () => {
    const provider = new ScriptedModelProvider([{ text: "Workspace understood." }]);
    const host = workspaceHost(FIXTURE);
    host.inspectWorkspace = async () => ({
      state: "project",
      root: "badge-demo",
      entries: 3,
      git: false,
      projectMarkers: ["package.json"],
      languages: ["typescript"],
      frameworks: [],
      packageManager: "npm",
      scripts: {},
    });
    const { store } = trackedStore(tempDir());
    const handle = startAgentRun({
      goal: "describe this project",
      model: MODEL,
      providerName: provider.name,
      provider,
      registry: new ToolRegistry(new ReadOnlyToolProvider(host)),
      store,
      verify: () => ({ status: "passed", summary: "ok", evidence: ["workspace.inspect"] }),
    });
    const run = await handle.done;
    assert.strictEqual(run.lifecycle, "completed");
    assert.strictEqual(run.workspace.state, "project");
    assert.strictEqual(run.workspace.root, "badge-demo");
    assert.ok(run.events.some((event) => event.type === "workspace" && event.state === "project"));
    assert.strictEqual(provider.calls.length, 1);
    const context = provider.calls[0].messages.map((message) => message.content || "").join("\n");
    assert.ok(context.includes("CodeMe inspected the active workspace before this run."));
    assert.ok(context.includes("\"root\":\"badge-demo\""));
  });

  await test("empty static scaffold uses only file tools and reads every created file back", async () => {
    const root = tempDir();
    const state = { terminalCalls: 0, testCalls: 0, capabilityListCalls: 0, capabilityCalls: 0 };
    const host = {
      async inspectWorkspace() {
        return {
          state: "empty",
          root: path.basename(root),
          entries: 0,
          git: false,
          projectMarkers: [],
          languages: [],
          frameworks: [],
          packageManager: null,
          scripts: {},
        };
      },
      async writeFile(filePath, contents) {
        const full = path.join(root, filePath);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, contents, "utf8");
        return { path: filePath, bytes: Buffer.byteLength(contents) };
      },
      async readFile(filePath) {
        const full = path.join(root, filePath);
        return { path: filePath, contents: fs.readFileSync(full, "utf8") };
      },
      async createDirectory(dirPath) {
        fs.mkdirSync(path.join(root, dirPath), { recursive: true });
        return { path: dirPath };
      },
      async listDirectory() {
        return { path: ".", entries: [] };
      },
      async runTerminal() {
        state.terminalCalls += 1;
        return { exitCode: 0, output: "" };
      },
      async runTests() {
        state.testCalls += 1;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
      async search() { return { query: "", matches: [] }; },
      async gitStatus() { return { branch: null, changes: [] }; },
      async gitDiff() { return { diff: "" }; },
      async diagnostics() { return { items: [] }; },
      async browserCheck(url) { return { available: true, statusCode: 200, title: "Hello CodeMe", url }; },
    };

    const provider = new ScriptedModelProvider([
      {
        toolCalls: [
          { name: "file.write", args: { path: "index.html", contents: "<!doctype html><h1>Hello CodeMe</h1><link rel=\"stylesheet\" href=\"style.css\">" } },
          { name: "file.write", args: { path: "style.css", contents: "h1 { font-family: sans-serif; }" } },
        ],
      },
      {
        toolCalls: [
          { name: "file.read", args: { path: "index.html" } },
          { name: "file.read", args: { path: "style.css" } },
        ],
      },
      {
        toolCalls: [
          { name: "browser.check", args: { url: "index.html" } },
        ],
      },
      { text: "Created index.html and style.css and verified both files in the browser." },
    ]);

    const capabilities = {
      async listCapabilities() {
        state.capabilityListCalls += 1;
        return [{
          name: "research.problem",
          description: "Research an unknown technical problem.",
          category: "research",
          risk: "read",
          permissions: ["evidence", "network"],
          inputSchema: {
            type: "object",
            properties: { question: { type: "string" } },
            required: ["question"],
          },
        }];
      },
      async invoke() {
        state.capabilityCalls += 1;
        throw new Error("simple scaffold must not invoke external capabilities");
      },
    };

    const { store } = trackedStore(tempDir());
    const handle = startAgentRun({
      goal: "Create a simple HTML website with a heading that says Hello CodeMe.",
      model: MODEL,
      providerName: provider.name,
      provider,
      registry: new ToolRegistry(new ControlledToolProvider(host)),
      store,
      capabilities,
      mode: "controlled",
      maxIterations: 6,
    });
    const run = await handle.done;

    assert.strictEqual(run.lifecycle, "completed", quoteRun(run));
    assert.strictEqual(run.workspace.state, "empty");
    assert.strictEqual(run.projectDecision.kind, "static_site");
    assert.strictEqual(run.projectDecision.dependenciesRequired, false);
    assert.deepStrictEqual(run.filesChanged.sort(), ["index.html", "style.css"]);
    assert.strictEqual(fs.readFileSync(path.join(root, "index.html"), "utf8").includes("Hello CodeMe"), true);
    assert.strictEqual(fs.existsSync(path.join(root, "package.json")), false);
    assert.strictEqual(fs.existsSync(path.join(root, "server.js")), false);
    assert.strictEqual(state.terminalCalls, 0);
    assert.strictEqual(state.testCalls, 0);
    assert.strictEqual(state.capabilityListCalls, 0);
    assert.strictEqual(state.capabilityCalls, 0);
    assert.strictEqual(run.verification.status, "passed");
    assert.deepStrictEqual(run.verification.evidence, ["file.write", "file.read", "browser.check"]);

    for (const call of provider.calls) {
      const names = call.tools.map((tool) => tool.name);
      assert.strictEqual(names.includes("terminal.run"), false);
      assert.strictEqual(names.includes("tests.run"), false);
      assert.strictEqual(names.includes("process.start"), false);
      assert.strictEqual(names.includes("file.patch"), false);
      assert.strictEqual(names.includes("capability.invoke"), false);
      assert.strictEqual(names.includes("browser.check"), true);
      assert.strictEqual(names.includes("capability.list"), false);
    }
  });

  await test("React request is classified as a frontend app before the model turn", async () => {
    const provider = new ScriptedModelProvider([{ text: "Architecture understood." }]);
    const host = workspaceHost(tempDir());
    host.inspectWorkspace = async () => ({
      state: "empty",
      root: "react-demo",
      entries: 0,
      git: false,
      projectMarkers: [],
      languages: [],
      frameworks: [],
      packageManager: null,
      scripts: {},
    });
    host.patchFile = async () => ({ path: "src/App.jsx", replacements: 1 });
    host.startProcess = async (command) => ({ started: true, command });
    host.createDirectory = async (dirPath) => ({ path: dirPath });
    host.listDirectory = async () => ({ path: ".", entries: [] });

    const { store } = trackedStore(tempDir());
    const handle = startAgentRun({
      goal: "Create a React website with a heading that says Hello CodeMe.",
      model: MODEL,
      providerName: provider.name,
      provider,
      registry: new ToolRegistry(new ControlledToolProvider(host)),
      store,
      mode: "controlled",
      verify: () => ({ status: "passed", summary: "decision captured", evidence: ["project_decision"] }),
    });
    const run = await handle.done;

    assert.strictEqual(run.lifecycle, "completed", quoteRun(run));
    assert.strictEqual(run.projectDecision.kind, "frontend_app");
    assert.strictEqual(run.projectDecision.framework, "react");
    assert.strictEqual(run.projectDecision.dependenciesRequired, true);
    assert.ok(run.events.some((event) => event.type === "project_decision" && event.kind === "frontend_app"));
    const firstCall = provider.calls[0];
    const context = firstCall.messages.map((message) => message.content || "").join("\n");
    assert.ok(context.includes("Project type: React frontend app."));
    const tools = firstCall.tools.map((tool) => tool.name);
    assert.ok(tools.includes("process.start"));
    assert.ok(tools.includes("file.patch"));
  });

  await test("stale process.start is suppressed during browser repair without starting another server", async () => {
    const root = tempDir();
    fs.writeFileSync(path.join(root, "index.html"), '<h1 id="title">Hello CodeMe</h1>\n', "utf8");
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
      name: "preview-reuse",
      scripts: { start: "node server.js" },
    }, null, 2), "utf8");

    let starts = 0;
    let statuses = 0;
    const host = {
      async inspectWorkspace() {
        return {
          state: "project",
          root: path.basename(root),
          entries: 2,
          git: false,
          projectMarkers: ["package.json"],
          languages: ["html", "javascript"],
          frameworks: [],
          packageManager: "npm",
          scripts: { start: "node server.js" },
        };
      },
      async listDirectory() {
        return {
          path: ".",
          entries: [
            { path: "index.html", type: "file" },
            { path: "package.json", type: "file" },
          ],
        };
      },
      async readFile(filePath) {
        return { path: filePath, contents: fs.readFileSync(path.join(root, filePath), "utf8") };
      },
      async patchFile(filePath, oldText, newText) {
        const full = path.join(root, filePath);
        const before = fs.readFileSync(full, "utf8");
        fs.writeFileSync(full, before.replace(oldText, newText), "utf8");
        return { path: filePath, replacements: 1 };
      },
      async writeFile() { throw new Error("not used"); },
      async createDirectory(dirPath) { return { path: dirPath }; },
      async search() { return { query: "", matches: [] }; },
      async runTerminal() { return { exitCode: 0, output: "" }; },
      async processStatus() {
        statuses += 1;
        return { found: true, status: "running", command: "npm start", exitCode: null };
      },
      async processLogs() {
        return { found: true, status: "running", command: "npm start", output: "Server running at http://localhost:3000" };
      },
      async startProcess() {
        starts += 1;
        return { started: true, status: "running", command: "npm start" };
      },
      async runTests() { throw new Error("not used"); },
      async gitStatus() { throw new Error("not used"); },
      async gitDiff() { throw new Error("not used"); },
      async diagnostics() { return { items: [] }; },
      async browserCheck(url) {
        return { available: true, statusCode: 200, title: "Hello CodeMe", url, assets: [] };
      },
    };

    const provider = new ScriptedModelProvider([
      { toolCalls: [{ name: "process.start", args: { command: "npm start" } }] },
      { toolCalls: [{ name: "file.read", args: { path: "index.html" } }] },
      {
        toolCalls: [{
          name: "file.patch",
          args: { path: "index.html", oldText: "Hello CodeMe", newText: "Hello Again" },
        }],
      },
      { toolCalls: [{ name: "file.read", args: { path: "index.html" } }] },
      { toolCalls: [{ name: "browser.check", args: { url: "index.html" } }] },
      { text: "Updated the heading." },
    ]);

    const { store } = trackedStore(tempDir());
    const run = await startAgentRun({
      goal: "Fix the page and change the heading. Make sure it works in the browser.",
      model: MODEL,
      providerName: provider.name,
      provider,
      registry: new ToolRegistry(new ControlledToolProvider(host)),
      store,
      mode: "controlled",
      maxIterations: 8,
    }).done;

    assert.strictEqual(run.lifecycle, "completed", quoteRun(run));
    assert.strictEqual(starts, 0);
    assert.ok(statuses >= 1);

    const staleStart = run.toolCalls.find((call) => call.name === "process.start");
    assert.ok(staleStart);
    assert.strictEqual(staleStart.result.ok, true);
    assert.strictEqual(staleStart.result.data.suppressed, true);
    assert.strictEqual(staleStart.result.data.reused, true);
    assert.strictEqual(staleStart.result.data.reason, "already_running");
    assert.ok(!run.toolCalls.some((call) => (
      call.name === "process.start" && call.result && call.result.ok === false
    )));
  });

  await test("static project policy hard-blocks package scaffolding and process tools", async () => {
    const root = tempDir();
    let writes = 0;
    let processes = 0;
    const host = {
      async inspectWorkspace() {
        return {
          state: "empty",
          root: "static-demo",
          entries: 0,
          git: false,
          projectMarkers: [],
          languages: [],
          frameworks: [],
          packageManager: null,
          scripts: {},
        };
      },
      async writeFile() {
        writes += 1;
        return { wrote: true };
      },
      async readFile() { return { contents: "" }; },
      async createDirectory(dirPath) { return { path: dirPath }; },
      async listDirectory() { return { path: ".", entries: [] }; },
      async browserCheck(url) { return { available: true, statusCode: 200, url }; },
      async startProcess(command) {
        processes += 1;
        return { started: true, command };
      },
    };
    const provider = new ScriptedModelProvider([
      {
        toolCalls: [
          { name: "file.write", args: { path: "package.json", contents: "{}" } },
          { name: "process.start", args: { command: "npm start" } },
        ],
      },
    ]);
    const { store } = trackedStore(tempDir());
    const run = await startAgentRun({
      goal: "Create a simple website with a heading that says Hello CodeMe.",
      model: MODEL,
      providerName: provider.name,
      provider,
      registry: new ToolRegistry(new ControlledToolProvider(host)),
      store,
      mode: "controlled",
      maxIterations: 2,
    }).done;

    assert.strictEqual(run.projectDecision.kind, "static_site");
    assert.strictEqual(writes, 0);
    assert.strictEqual(processes, 0);
    assert.ok(run.toolCalls.some((call) => call.name === "file.write" && call.result && call.result.error && call.result.error.code === "policy_denied"));
    assert.ok(run.toolCalls.some((call) => call.name === "process.start" && call.result && call.result.error && call.result.error.code === "policy_denied"));
  });

  await test("simple existing HTML edit skips research tests and Git, then verifies in browser", async () => {
    const root = tempDir();
    fs.writeFileSync(path.join(root, "index.html"), '<h1 style="color: blue; text-align: center;">Hello CodeMe</h1>\n', "utf8");
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
      name: "hello-codeme",
      scripts: { start: "node server.js" },
    }, null, 2), "utf8");

    const state = { tests: 0, git: 0, research: 0, capabilityLists: 0 };
    const host = {
      async inspectWorkspace() {
        return {
          state: "project",
          root: path.basename(root),
          entries: 2,
          git: false,
          projectMarkers: ["package.json"],
          languages: ["html", "javascript"],
          frameworks: [],
          packageManager: "npm",
          scripts: { start: "node server.js" },
        };
      },
      async listDirectory() {
        return {
          path: ".",
          entries: [
            { path: "index.html", type: "file" },
            { path: "package.json", type: "file" },
          ],
        };
      },
      async readFile(filePath) {
        return { path: filePath, contents: fs.readFileSync(path.join(root, filePath), "utf8") };
      },
      async patchFile(filePath, oldText, newText) {
        const full = path.join(root, filePath);
        const before = fs.readFileSync(full, "utf8");
        assert.ok(before.includes(oldText));
        fs.writeFileSync(full, before.replace(oldText, newText), "utf8");
        return { path: filePath, replacements: 1 };
      },
      async writeFile() { throw new Error("not used"); },
      async createDirectory(dirPath) { return { path: dirPath }; },
      async search() { return { query: "", matches: [] }; },
      async runTerminal() { return { exitCode: 0, output: "" }; },
      async startProcess(command) { return { started: true, command }; },
      async runTests() {
        state.tests += 1;
        throw new Error("tests.run must not be called");
      },
      async gitStatus() {
        state.git += 1;
        throw Object.assign(new Error("not git"), { code: "not_a_repository" });
      },
      async gitDiff() {
        state.git += 1;
        throw Object.assign(new Error("not git"), { code: "not_a_repository" });
      },
      async diagnostics() { return { items: [] }; },
      async browserCheck(url) { return { available: true, statusCode: 200, title: "Hello CodeMe", url }; },
    };

    const capabilities = {
      async listCapabilities() {
        state.capabilityLists += 1;
        return [{
          name: "research.problem",
          description: "Research documentation.",
          category: "research",
          risk: "read",
          permissions: ["network"],
          inputSchema: {
            type: "object",
            properties: { question: { type: "string" } },
            required: ["question"],
          },
        }];
      },
      async invoke() {
        state.research += 1;
        throw new Error("research must not run for this local edit");
      },
    };

    const provider = new ScriptedModelProvider([
      { toolCalls: [{ name: "file.read", args: { path: "index.html" } }] },
      {
        toolCalls: [{
          name: "file.patch",
          args: {
            path: "index.html",
            oldText: "color: blue",
            newText: "color: red",
          },
        }],
      },
      { toolCalls: [{ name: "file.read", args: { path: "index.html" } }] },
      { toolCalls: [{ name: "browser.check", args: { url: "index.html" } }] },
      { text: "The heading is red now." },
    ]);

    const { store } = trackedStore(tempDir());
    const run = await startAgentRun({
      goal: "Now change the heading to red",
      model: MODEL,
      providerName: provider.name,
      provider,
      registry: new ToolRegistry(new ControlledToolProvider(host)),
      store,
      capabilities,
      mode: "controlled",
      maxIterations: 8,
    }).done;

    assert.strictEqual(run.lifecycle, "completed", quoteRun(run));
    assert.strictEqual(run.projectDecision.kind, "existing_project_edit");
    assert.strictEqual(run.verification.status, "passed");
    assert.deepStrictEqual(run.verification.evidence, ["file.patch", "file.read", "browser.check"]);
    assert.strictEqual(state.tests, 0);
    assert.strictEqual(state.git, 0);
    assert.strictEqual(state.research, 0);
    assert.strictEqual(state.capabilityLists, 0);
    assert.ok(fs.readFileSync(path.join(root, "index.html"), "utf8").includes("color: red"));

    for (const modelCall of provider.calls) {
      const names = modelCall.tools.map((tool) => tool.name);
      assert.strictEqual(names.includes("tests.run"), false);
      assert.strictEqual(names.includes("git.diff"), false);
      assert.strictEqual(names.includes("git.status"), false);
      assert.strictEqual(names.includes("capability.invoke"), false);
      assert.strictEqual(names.includes("capability.list"), false);
      assert.strictEqual(names.includes("file.patch"), true);
      assert.strictEqual(names.includes("browser.check"), true);
    }

    const context = provider.calls[0].messages.map((message) => message.content || "").join("\n");
    assert.ok(context.includes("there is no test script"));
    assert.ok(context.includes("this is not a Git repository"));
  });

  await test("already-satisfied button repair reroutes preview shell commands and completes without a new write", async () => {
    const root = tempDir();
    fs.writeFileSync(path.join(root, "index.html"), [
      '<!doctype html>',
      '<link rel="stylesheet" href="styles.css">',
      '<button id="actionBtn">Click Me</button>',
      '<script src="script.js"></script>',
      "",
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(root, "styles.css"), "#actionBtn { color: white; }\n", "utf8");
    fs.writeFileSync(
      path.join(root, "script.js"),
      'document.getElementById("actionBtn").addEventListener("click", function () { this.textContent = "It works!"; });\n',
      "utf8",
    );
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
      name: "already-fixed",
      scripts: { start: "node server.js" },
    }, null, 2), "utf8");

    const host = {
      async inspectWorkspace() {
        return {
          state: "project",
          root: path.basename(root),
          entries: 4,
          git: false,
          projectMarkers: ["package.json"],
          languages: ["html", "css", "javascript"],
          frameworks: [],
          packageManager: "npm",
          scripts: { start: "node server.js" },
        };
      },
      async listDirectory() {
        return {
          path: ".",
          entries: ["index.html", "styles.css", "script.js", "package.json"]
            .map((filePath) => ({ path: filePath, type: "file" })),
        };
      },
      async readFile(filePath) {
        return { path: filePath, contents: fs.readFileSync(path.join(root, filePath), "utf8") };
      },
      async patchFile() { throw new Error("no patch should be needed"); },
      async writeFile() { throw new Error("no write should be needed"); },
      async createDirectory(dirPath) { return { path: dirPath }; },
      async search() { return { query: "", matches: [] }; },
      async runTerminal() { throw new Error("preview server command must be routed before terminal.run"); },
      async processStatus() {
        return { found: true, status: "running", command: "npm start", exitCode: null };
      },
      async processLogs() {
        return { found: true, status: "running", command: "npm start", output: "Server running" };
      },
      async startProcess() { throw new Error("must not start another preview"); },
      async runTests() { throw new Error("no tests"); },
      async gitStatus() { throw new Error("not git"); },
      async gitDiff() { throw new Error("not git"); },
      async diagnostics() { return { items: [] }; },
      async browserCheck(url) {
        return {
          available: true,
          statusCode: 200,
          title: "Already fixed",
          url,
          assets: [
            { kind: "style", path: "styles.css", statusCode: 200, contentType: "text/css", ok: true },
            { kind: "script", path: "script.js", statusCode: 200, contentType: "text/javascript", ok: true },
          ],
        };
      },
      async browserInteract(args) {
        return {
          available: true,
          url: args.url,
          action: "click",
          targetText: args.targetText,
          expectedText: args.expectedText,
          beforeText: "Click Me",
          afterText: "It works!",
          matched: true,
          consoleErrors: [],
          statusCode: 200,
          title: "Already fixed",
          assets: [
            { kind: "style", path: "styles.css", statusCode: 200, contentType: "text/css", ok: true },
            { kind: "script", path: "script.js", statusCode: 200, contentType: "text/javascript", ok: true },
          ],
        };
      },
    };

    const provider = new ScriptedModelProvider([
      {
        toolCalls: [
          { name: "file.read", args: { path: "index.html" } },
          { name: "file.read", args: { path: "styles.css" } },
          { name: "file.read", args: { path: "script.js" } },
        ],
      },
      { toolCalls: [{ name: "terminal.run", args: { command: "node server.js &" } }] },
      { text: "This should never be needed because CodeMe should auto-verify the click." },
    ]);

    const { store } = trackedStore(tempDir());
    const run = await startAgentRun({
      goal: 'The button still does not work. Fix it so clicking "Click Me" changes the button text to "It works!", and do not finish until styles.css and script.js load successfully.',
      model: MODEL,
      providerName: provider.name,
      provider,
      registry: new ToolRegistry(new ControlledToolProvider(host)),
      store,
      mode: "controlled",
      maxIterations: 4,
    }).done;

    assert.strictEqual(run.lifecycle, "completed", quoteRun(run));
    assert.strictEqual(run.filesChanged.length, 0);
    assert.strictEqual(run.verification.status, "passed");
    assert.ok(/already satisfied|real browser/i.test(run.verification.summary));
    assert.strictEqual(provider.calls.length, 2);
    assert.ok(!run.toolCalls.some((call) => call.name === "terminal.run"));
    assert.ok(run.toolCalls.some((call) => (
      call.name === "browser.check"
      && call.result
      && call.result.ok
      && call.routedFrom
      && call.routedFrom.name === "terminal.run"
      && call.routedFrom.command === "node server.js &"
    )));
    assert.ok(run.toolCalls.some((call) => (
      call.name === "browser.interact"
      && call.directedBy === "runtime"
      && call.result
      && call.result.ok
      && call.result.data
      && call.result.data.afterText === "It works!"
    )));
    assert.ok(!String(run.error && run.error.message || "").includes("no workspace change"));
  });

  await test("user conditional edit rule verifies failure before allowing a patch", async () => {
    const root = tempDir();
    fs.writeFileSync(path.join(root, "index.html"), [
      "<!doctype html>",
      '<button id="actionBtn">Click Me</button>',
      '<script src="script.js"></script>',
      "",
    ].join("\n"), "utf8");
    fs.writeFileSync(
      path.join(root, "script.js"),
      'document.getElementById("actionBtn").addEventListener("click", function () { this.textContent = "Still broken"; });\n',
      "utf8",
    );
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
      name: "conditional-button",
      scripts: { start: "node server.js" },
    }, null, 2), "utf8");

    let hostPatches = 0;
    let interactions = 0;
    const host = {
      async inspectWorkspace() {
        return {
          state: "project",
          root: path.basename(root),
          entries: 3,
          git: false,
          projectMarkers: ["package.json"],
          languages: ["html", "javascript"],
          frameworks: [],
          packageManager: "npm",
          scripts: { start: "node server.js" },
        };
      },
      async listDirectory() {
        return {
          path: ".",
          entries: ["index.html", "script.js", "package.json"]
            .map((filePath) => ({ path: filePath, type: "file" })),
        };
      },
      async readFile(filePath) {
        return { path: filePath, contents: fs.readFileSync(path.join(root, filePath), "utf8") };
      },
      async patchFile(filePath, oldText, newText) {
        hostPatches += 1;
        const full = path.join(root, filePath);
        const before = fs.readFileSync(full, "utf8");
        assert.ok(before.includes(oldText), `missing patch text in ${filePath}`);
        fs.writeFileSync(full, before.replace(oldText, newText), "utf8");
        return { path: filePath, replacements: 1 };
      },
      async writeFile() { throw new Error("file.write should not be needed"); },
      async createDirectory(dirPath) { return { path: dirPath }; },
      async search() { return { query: "", matches: [] }; },
      async runTerminal() { throw new Error("terminal.run should not be used"); },
      async processStatus() {
        return { found: true, status: "running", command: "npm start", exitCode: null };
      },
      async processLogs() {
        return { found: true, status: "running", command: "npm start", output: "Server running" };
      },
      async startProcess() { throw new Error("process.start should not be used"); },
      async runTests() { throw new Error("no tests"); },
      async gitStatus() { throw new Error("not git"); },
      async gitDiff() { throw new Error("not git"); },
      async diagnostics() { return { items: [] }; },
      async browserCheck(url) {
        return {
          available: true,
          statusCode: 200,
          title: "Conditional edit",
          url,
          assets: [
            { kind: "script", path: "script.js", statusCode: 200, contentType: "text/javascript", ok: true },
          ],
        };
      },
      async browserInteract(args) {
        interactions += 1;
        const script = fs.readFileSync(path.join(root, "script.js"), "utf8");
        if (!script.includes("It works!")) {
          return {
            available: false,
            code: "browser_expectation_failed",
            message: 'Expected "It works!" but observed "Still broken"',
            url: args.url,
            action: "click",
            targetText: args.targetText,
            expectedText: args.expectedText,
            beforeText: "Click Me",
            afterText: "Still broken",
            matched: false,
            consoleErrors: [],
          };
        }
        return {
          available: true,
          url: args.url,
          action: "click",
          targetText: args.targetText,
          expectedText: args.expectedText,
          beforeText: "Click Me",
          afterText: "It works!",
          matched: true,
          consoleErrors: [],
          statusCode: 200,
          title: "Conditional edit fixed",
          assets: [
            { kind: "script", path: "script.js", statusCode: 200, contentType: "text/javascript", ok: true },
          ],
        };
      },
    };

    const provider = new ScriptedModelProvider([
      {
        toolCalls: [
          { name: "file.read", args: { path: "index.html" } },
          { name: "file.read", args: { path: "script.js" } },
        ],
      },
      {
        toolCalls: [{
          name: "file.patch",
          args: { path: "script.js", oldText: "Still broken", newText: "It works!" },
        }],
      },
      { toolCalls: [{ name: "browser.check", args: { url: "index.html" } }] },
      {
        toolCalls: [{
          name: "file.patch",
          args: { path: "script.js", oldText: "Still broken", newText: "It works!" },
        }],
      },
      { toolCalls: [{ name: "file.read", args: { path: "script.js" } }] },
      { toolCalls: [{ name: "browser.check", args: { url: "index.html" } }] },
      { text: "The failed interaction was repaired and verified." },
    ]);

    const { store } = trackedStore(tempDir());
    const run = await startAgentRun({
      goal: 'Fix the "Click Me" button so clicking it changes the button text to "It works!". Use the real browser to verify it. Do not change any files unless the interaction fails.',
      model: MODEL,
      providerName: provider.name,
      provider,
      registry: new ToolRegistry(new ControlledToolProvider(host)),
      store,
      mode: "controlled",
      maxIterations: 9,
    }).done;

    assert.strictEqual(run.lifecycle, "completed", quoteRun(run));
    assert.strictEqual(run.verification.status, "passed");
    assert.strictEqual(hostPatches, 1);
    assert.strictEqual(interactions, 2);

    const patches = run.toolCalls.filter((call) => call.name === "file.patch");
    assert.strictEqual(patches.length, 2);
    assert.strictEqual(patches[0].result.ok, false);
    assert.strictEqual(patches[0].result.error.code, "policy_denied");
    assert.strictEqual(patches[0].ruleDecision.rule, "user.require_failure_before_edit");
    assert.strictEqual(patches[0].ruleDecision.tier, "user");
    assert.strictEqual(patches[1].result.ok, true);

    const deniedIndex = run.toolCalls.indexOf(patches[0]);
    const failedInteractionIndex = run.toolCalls.findIndex((call) => (
      call.name === "browser.interact"
      && call.result
      && call.result.ok === false
      && call.result.error
      && call.result.error.code === "browser_expectation_failed"
    ));
    const allowedPatchIndex = run.toolCalls.indexOf(patches[1]);
    assert.ok(deniedIndex >= 0);
    assert.ok(failedInteractionIndex > deniedIndex);
    assert.ok(allowedPatchIndex > failedInteractionIndex);
    assert.ok(run.ruleDecisions.some((decision) => (
      decision.rule === "user.require_failure_before_edit"
      && decision.action === "deny"
      && decision.requestedTool === "file.patch"
    )));
    assert.ok(fs.readFileSync(path.join(root, "script.js"), "utf8").includes("It works!"));
  });

  await test("broken button is repaired before real-browser completion", async () => {
    const root = tempDir();
    fs.writeFileSync(path.join(root, "index.html"), [
      "<!doctype html>",
      '<button id="actionBtn">Click Me</button>',
      '<script src="script.js"></script>',
      "",
    ].join("\n"), "utf8");
    fs.writeFileSync(
      path.join(root, "script.js"),
      'document.getElementById("actionBtn").addEventListener("click", function () { this.textContent = "Still broken"; });\n',
      "utf8",
    );
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
      name: "broken-button",
      scripts: { start: "node server.js" },
    }, null, 2), "utf8");

    let interactions = 0;
    let processStarts = 0;
    const host = {
      async inspectWorkspace() {
        return {
          state: "project",
          root: path.basename(root),
          entries: 3,
          git: false,
          projectMarkers: ["package.json"],
          languages: ["html", "javascript"],
          frameworks: [],
          packageManager: "npm",
          scripts: { start: "node server.js" },
        };
      },
      async listDirectory() {
        return {
          path: ".",
          entries: ["index.html", "script.js", "package.json"]
            .map((filePath) => ({ path: filePath, type: "file" })),
        };
      },
      async readFile(filePath) {
        return { path: filePath, contents: fs.readFileSync(path.join(root, filePath), "utf8") };
      },
      async patchFile(filePath, oldText, newText) {
        const full = path.join(root, filePath);
        const before = fs.readFileSync(full, "utf8");
        assert.ok(before.includes(oldText), `missing patch text in ${filePath}`);
        fs.writeFileSync(full, before.replace(oldText, newText), "utf8");
        return { path: filePath, replacements: 1 };
      },
      async writeFile() { throw new Error("file.write should not be needed"); },
      async createDirectory(dirPath) { return { path: dirPath }; },
      async search() { return { query: "", matches: [] }; },
      async runTerminal() { throw new Error("terminal.run should not start the preview"); },
      async processStatus() {
        return { found: true, status: "running", command: "npm start", exitCode: null };
      },
      async processLogs() {
        return { found: true, status: "running", command: "npm start", output: "Server running" };
      },
      async startProcess() {
        processStarts += 1;
        return { started: true, status: "running", command: "npm start" };
      },
      async runTests() { throw new Error("no tests"); },
      async gitStatus() { throw new Error("not git"); },
      async gitDiff() { throw new Error("not git"); },
      async diagnostics() { return { items: [] }; },
      async browserCheck(url) {
        return {
          available: true,
          statusCode: 200,
          title: "Broken button",
          url,
          assets: [
            { kind: "script", path: "script.js", statusCode: 200, contentType: "text/javascript", ok: true },
          ],
        };
      },
      async browserInteract(args) {
        interactions += 1;
        const script = fs.readFileSync(path.join(root, "script.js"), "utf8");
        if (!script.includes("It works!")) {
          return {
            available: false,
            code: "browser_expectation_failed",
            message: 'Expected "It works!" but observed "Still broken"',
            url: args.url,
            action: "click",
            targetText: args.targetText,
            expectedText: args.expectedText,
            beforeText: "Click Me",
            afterText: "Still broken",
            matched: false,
            consoleErrors: [],
          };
        }
        return {
          available: true,
          url: args.url,
          action: "click",
          targetText: args.targetText,
          expectedText: args.expectedText,
          beforeText: "Click Me",
          afterText: "It works!",
          matched: true,
          consoleErrors: [],
          statusCode: 200,
          title: "Fixed button",
          assets: [
            { kind: "script", path: "script.js", statusCode: 200, contentType: "text/javascript", ok: true },
          ],
        };
      },
    };

    const provider = new ScriptedModelProvider([
      {
        toolCalls: [
          { name: "file.read", args: { path: "index.html" } },
          { name: "file.read", args: { path: "script.js" } },
        ],
      },
      { toolCalls: [{ name: "browser.check", args: { url: "index.html" } }] },
      {
        toolCalls: [{
          name: "file.patch",
          args: { path: "script.js", oldText: "Still broken", newText: "It works!" },
        }],
      },
      { toolCalls: [{ name: "file.read", args: { path: "script.js" } }] },
      { toolCalls: [{ name: "browser.check", args: { url: "index.html" } }] },
      { text: "This should not be needed because the repaired interaction should auto-complete." },
    ]);

    const { store } = trackedStore(tempDir());
    const run = await startAgentRun({
      goal: 'Fix the "Click Me" button so clicking it changes the button text to "It works!". Use the real browser to verify it, and do not change files unless the interaction fails.',
      model: MODEL,
      providerName: provider.name,
      provider,
      registry: new ToolRegistry(new ControlledToolProvider(host)),
      store,
      mode: "controlled",
      maxIterations: 8,
    }).done;

    assert.strictEqual(run.lifecycle, "completed", quoteRun(run));
    assert.strictEqual(run.verification.status, "passed");
    assert.strictEqual(processStarts, 0);
    assert.strictEqual(interactions, 2);
    assert.ok(run.filesChanged.includes("script.js"));
    assert.ok(fs.readFileSync(path.join(root, "script.js"), "utf8").includes("It works!"));
    assert.ok(run.diagnoses.some((item) => (
      item.tool === "browser.interact"
      && item.class === "bad_code"
      && item.next === "repair"
    )));

    const failedInteractionIndex = run.toolCalls.findIndex((call) => (
      call.name === "browser.interact"
      && call.result
      && call.result.ok === false
      && call.result.error
      && call.result.error.code === "browser_expectation_failed"
    ));
    const patchIndex = run.toolCalls.findIndex((call) => (
      call.name === "file.patch"
      && call.args
      && call.args.path === "script.js"
    ));
    const passedInteractionIndex = run.toolCalls.findIndex((call, index) => (
      index > patchIndex
      && call.name === "browser.interact"
      && call.result
      && call.result.ok
      && call.result.data
      && call.result.data.afterText === "It works!"
    ));

    assert.ok(failedInteractionIndex >= 0);
    assert.ok(patchIndex > failedInteractionIndex);
    assert.ok(passedInteractionIndex > patchIndex);
    assert.ok(run.verification.evidence.includes("file.patch"));
    assert.ok(run.verification.evidence.includes("browser.interact"));
    assert.ok(!run.toolCalls.some((call) => call.name === "process.start"));
    assert.ok(!run.toolCalls.some((call) => call.name === "terminal.run"));
  });

  await test("failed web assets force server repair before completion", async () => {
    const root = tempDir();
    fs.writeFileSync(path.join(root, "index.html"), [
      '<!doctype html>',
      '<link rel="stylesheet" href="styles.css">',
      '<h1>Hello CodeMe</h1>',
      '<button id="demoButton">Click Me</button>',
      '<script src="script.js"></script>',
      "",
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(root, "styles.css"), "body { text-align: center; }\n", "utf8");
    fs.writeFileSync(
      path.join(root, "script.js"),
      'document.getElementById("demoButton").addEventListener("click", function () { this.textContent = "It works!"; });\n',
      "utf8",
    );
    fs.writeFileSync(
      path.join(root, "server.js"),
      'const http = require("http");\nconst server = http.createServer((_req, res) => { res.end("index only"); });\nserver.listen(3000);\n',
      "utf8",
    );
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
      name: "button-demo",
      scripts: { start: "node server.js" },
    }, null, 2), "utf8");

    let previewCalls = 0;
    let processCalls = 0;
    const host = {
      async inspectWorkspace() {
        return {
          state: "project",
          root: path.basename(root),
          entries: 5,
          git: false,
          projectMarkers: ["package.json"],
          languages: ["html", "css", "javascript"],
          frameworks: [],
          packageManager: "npm",
          scripts: { start: "node server.js" },
        };
      },
      async listDirectory() {
        return {
          path: ".",
          entries: ["index.html", "styles.css", "script.js", "server.js", "package.json"]
            .map((filePath) => ({ path: filePath, type: "file" })),
        };
      },
      async readFile(filePath) {
        return { path: filePath, contents: fs.readFileSync(path.join(root, filePath), "utf8") };
      },
      async patchFile(filePath, oldText, newText) {
        const full = path.join(root, filePath);
        const before = fs.readFileSync(full, "utf8");
        assert.ok(before.includes(oldText), `missing patch text in ${filePath}`);
        fs.writeFileSync(full, before.replace(oldText, newText), "utf8");
        return { path: filePath, replacements: 1 };
      },
      async writeFile(filePath, contents) {
        fs.writeFileSync(path.join(root, filePath), contents, "utf8");
        return { path: filePath, bytes: Buffer.byteLength(contents) };
      },
      async createDirectory(dirPath) { return { path: dirPath }; },
      async search() { return { query: "", matches: [] }; },
      async runTerminal() { return { exitCode: 0, output: "" }; },
      async startProcess(command) {
        processCalls += 1;
        return { started: true, command };
      },
      async runTests() { throw new Error("no tests"); },
      async gitStatus() { throw new Error("not git"); },
      async gitDiff() { throw new Error("not git"); },
      async diagnostics() { return { items: [] }; },
      async browserCheck(url) {
        previewCalls += 1;
        if (previewCalls === 1) {
          return {
            available: false,
            code: "asset_status",
            message: "script asset script.js returned HTTP 404",
            url,
            statusCode: 200,
            assets: [
              { kind: "style", path: "styles.css", statusCode: 404, contentType: "text/html", ok: false },
            ],
          };
        }
        return {
          available: true,
          statusCode: 200,
          title: "Button demo",
          url,
          assets: [
            { kind: "style", path: "styles.css", statusCode: 200, contentType: "text/css", ok: true },
            { kind: "script", path: "script.js", statusCode: 200, contentType: "text/javascript", ok: true },
          ],
        };
      },
      async browserInteract(args) {
        return {
          available: true,
          url: args.url,
          action: "click",
          targetText: args.targetText,
          expectedText: args.expectedText,
          beforeText: "Click Me",
          afterText: "It works!",
          matched: true,
          consoleErrors: [],
          statusCode: 200,
          title: "Button demo",
          assets: [
            { kind: "style", path: "styles.css", statusCode: 200, contentType: "text/css", ok: true },
            { kind: "script", path: "script.js", statusCode: 200, contentType: "text/javascript", ok: true },
          ],
        };
      },
    };

    const brokenServer = fs.readFileSync(path.join(root, "server.js"), "utf8");
    const fixedServer = [
      'const http = require("http");',
      'const fs = require("fs");',
      'const path = require("path");',
      'const server = http.createServer((req, res) => {',
      '  const requested = req.url === "/" ? "index.html" : req.url.slice(1);',
      '  const file = path.join(__dirname, requested);',
      '  if (!fs.existsSync(file)) { res.writeHead(404); res.end("Not found"); return; }',
      '  const type = requested.endsWith(".css") ? "text/css" : requested.endsWith(".js") ? "text/javascript" : "text/html";',
      '  res.writeHead(200, { "Content-Type": type });',
      '  res.end(fs.readFileSync(file));',
      '});',
      'server.listen(3000);',
      "",
    ].join("\n");

    const provider = new ScriptedModelProvider([
      {
        toolCalls: [
          { name: "file.read", args: { path: "index.html" } },
          { name: "file.read", args: { path: "styles.css" } },
          { name: "file.read", args: { path: "script.js" } },
        ],
      },
      { toolCalls: [{ name: "browser.check", args: { url: "index.html" } }] },
      { toolCalls: [{ name: "file.read", args: { path: "server.js" } }] },
      {
        toolCalls: [{
          name: "file.patch",
          args: {
            path: "server.js",
            oldText: brokenServer,
            newText: fixedServer,
          },
        }],
      },
      { toolCalls: [{ name: "file.read", args: { path: "server.js" } }] },
      { toolCalls: [{ name: "browser.check", args: { url: "index.html" } }] },
      {
        toolCalls: [{
          name: "browser.interact",
          args: {
            url: "index.html",
            action: "click",
            targetText: "Click Me",
            expectedText: "It works!",
          },
        }],
      },
      { text: "Fixed the server so the page assets load and the button can run its click handler." },
    ]);

    const { store } = trackedStore(tempDir());
    const run = await startAgentRun({
      goal: 'The button does not work when I click it. Fix the button so it changes to "It works!" when clicked.',
      model: MODEL,
      providerName: provider.name,
      provider,
      registry: new ToolRegistry(new ControlledToolProvider(host)),
      store,
      mode: "controlled",
      maxIterations: 4,
    }).done;

    assert.strictEqual(run.lifecycle, "completed", quoteRun(run));
    assert.strictEqual(run.verification.status, "passed");
    assert.strictEqual(run.repairReserveUsed, 4);
    assert.ok(run.events.some((event) => event.type === "repair_reserve" && event.granted === 4));
    assert.strictEqual(previewCalls, 2);
    assert.strictEqual(processCalls, 0);
    assert.ok(run.filesChanged.includes("server.js"));
    assert.ok(fs.readFileSync(path.join(root, "server.js"), "utf8").includes("text/javascript"));

    const failedPreviewIndex = run.toolCalls.findIndex((call) => (
      call.name === "browser.check" && call.result && call.result.ok === false
    ));
    const patchIndex = run.toolCalls.findIndex((call) => call.name === "file.patch" && call.args.path === "server.js");
    const passedPreviewIndex = run.toolCalls.findIndex((call, index) => (
      index > patchIndex && call.name === "browser.check" && call.result && call.result.ok
    ));
    assert.ok(failedPreviewIndex >= 0);
    assert.ok(patchIndex > failedPreviewIndex);
    assert.ok(passedPreviewIndex > patchIndex);
    const interactionIndex = run.toolCalls.findIndex((call, index) => (
      index > passedPreviewIndex
      && call.name === "browser.interact"
      && call.result
      && call.result.ok
    ));
    assert.ok(interactionIndex > passedPreviewIndex);

    for (const modelCall of provider.calls) {
      const names = modelCall.tools.map((tool) => tool.name);
      assert.strictEqual(names.includes("process.start"), false);
    }
  });

  await test("write, terminal, and test tools stay blocked", async () => {
    const host = workspaceHost(FIXTURE);
    const registry = new ToolRegistry(new ReadOnlyToolProvider(host));
    for (const name of ["file.write", "terminal.run", "tests.run"]) {
      const args = name === "file.write" ? { path: "README.md", contents: "changed" } : { command: "echo hi" };
      const result = await registry.call(name, args);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error.code, "mutation_blocked");
    }
    assert.strictEqual(host.state.writes, 0);
  });

  await test("external capability hub is unavailable", async () => {
    const hub = new ExternalCapabilityProvider();
    assert.deepStrictEqual(await hub.listCapabilities(), []);
    const result = await hub.invoke("workflow.run");
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, "capability_unavailable");
  });

  await test("a corrupt checkpoint falls back to the previous run", async () => {
    const { store } = trackedStore(tempDir());
    const run = createRun({ goal: "first goal", model: MODEL, providerName: "scripted" });
    store.save(run);
    run.goal = "second goal";
    store.save(run);
    fs.writeFileSync(store.pathFor(run.id), "{");
    assert.strictEqual(store.load(run.id).goal, "first goal");
  });

  await test("cancellation stops the run before a tool executes", async () => {
    const provider = new ScriptedModelProvider([{ waitForAbort: true }]);
    const host = workspaceHost(FIXTURE);
    const { store } = trackedStore(tempDir());
    const handle = startAgentRun({
      goal: "read README.md",
      model: MODEL,
      providerName: provider.name,
      provider,
      registry: new ToolRegistry(new ReadOnlyToolProvider(host)),
      store,
      capabilities: new ExternalCapabilityProvider(),
    });
    handle.cancel();
    const run = await handle.done;
    assert.strictEqual(run.lifecycle, "cancelled");
    assert.strictEqual(run.outcome.status, "cancelled");
    assert.strictEqual(run.toolCalls.length, 0);
    assert.strictEqual(host.state.reads, 0);
    const callsAfterCancel = provider.calls.length;
    const resumed = await resumeRun(run.id, { provider, registry: new ToolRegistry(new ReadOnlyToolProvider(host)), store });
    assert.strictEqual(resumed.lifecycle, "cancelled");
    assert.strictEqual(provider.calls.length, callsAfterCancel);
  });

  await test("a model timeout becomes a failed run", async () => {
    const server = http.createServer(() => {});
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    try {
      const provider = new OllamaModelProvider({ baseUrl: `http://127.0.0.1:${port}` });
      const { store } = trackedStore(tempDir());
      const handle = startAgentRun({
        goal: "read README.md",
        model: MODEL,
        providerName: provider.name,
        provider,
        registry: new ToolRegistry(new ReadOnlyToolProvider(workspaceHost(FIXTURE))),
        store,
        timeoutMs: 400,
      });
      const run = await handle.done;
      assert.strictEqual(run.lifecycle, "failed");
      assert.strictEqual(run.error.code, "timeout");
      assert.strictEqual(run.outcome.reason, "timeout");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  await test("a refused model connection becomes a failed run", async () => {
    const server = http.createServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    const provider = new OllamaModelProvider({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 2000 });
    const { store } = trackedStore(tempDir());
    const handle = startAgentRun({
      goal: "read README.md",
      model: MODEL,
      providerName: provider.name,
      provider,
      registry: new ToolRegistry(new ReadOnlyToolProvider(workspaceHost(FIXTURE))),
      store,
      timeoutMs: 2000,
    });
    const run = await handle.done;
    assert.strictEqual(run.lifecycle, "failed");
    assert.strictEqual(run.error.code, "model_disconnected");
    assert.strictEqual(run.outcome.status, "failed");
  });

  await test("repeated failing actions stop the run", async () => {
    const call = { name: "file.read", args: { path: "src/missing.txt" } };
    const provider = new ScriptedModelProvider([
      { toolCalls: [call] },
      { toolCalls: [call] },
      { toolCalls: [call] },
    ]);
    const host = workspaceHost(FIXTURE);
    const { store } = trackedStore(tempDir());
    const handle = startAgentRun({
      goal: "read src/missing.txt",
      model: MODEL,
      providerName: provider.name,
      provider,
      registry: new ToolRegistry(new ReadOnlyToolProvider(host)),
      store,
      maxRetries: 2,
      maxIdenticalActions: 10,
      maxIterations: 8,
    });
    const run = await handle.done;
    assert.strictEqual(run.lifecycle, "failed");
    assert.strictEqual(run.outcome.reason, "repeated_action");
    assert.strictEqual(host.state.reads, 2);
    assert.strictEqual(run.toolCalls.length, 2);
    assert.strictEqual(run.filesChanged.length, 0);
  });

  await test("identical actions stop even when they succeed", async () => {
    const call = { name: "file.read", args: { path: "README.md" } };
    const provider = new ScriptedModelProvider([{ toolCalls: [call] }, { toolCalls: [call] }, { toolCalls: [call] }]);
    const host = workspaceHost(FIXTURE);
    const { store } = trackedStore(tempDir());
    const handle = startAgentRun({
      goal: "read README.md",
      model: MODEL,
      providerName: provider.name,
      provider,
      registry: new ToolRegistry(new ReadOnlyToolProvider(host)),
      store,
      maxRetries: 10,
      maxIdenticalActions: 2,
      maxIterations: 8,
    });
    const run = await handle.done;
    assert.strictEqual(run.outcome.reason, "repeated_action");
    assert.strictEqual(host.state.reads, 2);
  });

  await test("iteration limit stops a run that never finishes", async () => {
    const files = ["package.json", "README.md", "src/components/Badge.tsx"];
    const provider = new ScriptedModelProvider(files.map((file) => ({ toolCalls: [{ name: "file.read", args: { path: file } }] })));
    const host = workspaceHost(FIXTURE);
    const { store, lifecycles } = trackedStore(tempDir());
    const handle = startAgentRun({
      goal: "search forever",
      model: MODEL,
      providerName: provider.name,
      provider,
      registry: new ToolRegistry(new ReadOnlyToolProvider(host)),
      store,
      maxIterations: 3,
      maxIdenticalActions: 10,
      maxRetries: 10,
    });
    const run = await handle.done;
    assert.strictEqual(run.lifecycle, "failed");
    assert.strictEqual(run.outcome.reason, "iteration_limit");
    assert.strictEqual(host.state.reads, 3);
    assert.ok(lifecycles.includes("awaiting_model"));
    assert.ok(lifecycles.includes("executing_tool"));
  });

  await test("resume continues after a saved observation and does not replay it", async () => {
    const provider = new ScriptedModelProvider([
      { toolCalls: [{ name: "file.read", args: { path: "package.json" } }] },
      { text: "badge-demo" },
    ]);
    const host = workspaceHost(FIXTURE);
    const { store } = trackedStore(tempDir());
    const registry = new ToolRegistry(new ReadOnlyToolProvider(host));
    const handle = startAgentRun({
      goal: "read package.json and quote the package name",
      model: MODEL,
      providerName: provider.name,
      provider,
      registry,
      store,
      interruptAfterTool: true,
      verify(run, text) {
        const read = run.observations.some((item) => item.ok && item.summary.includes("badge-demo"));
        if (read && text.includes("badge-demo")) {
          return { status: "passed", summary: "Package name is in the observation", evidence: ["file.read"] };
        }
        return { status: "failed", summary: "Need the package name from file.read", evidence: [] };
      },
    });
    await assert.rejects(handle.done, (error) => error.code === "crash");
    const interrupted = store.load(handle.id);
    assert.strictEqual(interrupted.lifecycle, "interrupted");
    assert.strictEqual(interrupted.toolCalls.length, 1);
    assert.strictEqual(interrupted.inFlight, null);
    const resumed = await resumeRun(handle.id, {
      provider,
      registry,
      store,
      verify(run, text) {
        const read = run.observations.some((item) => item.ok && item.summary.includes("badge-demo"));
        if (read && text.includes("badge-demo")) {
          return { status: "passed", summary: "Package name is in the observation", evidence: ["file.read"] };
        }
        return { status: "failed", summary: "Need the package name from file.read", evidence: [] };
      },
    });
    assert.strictEqual(resumed.lifecycle, "completed");
    assert.strictEqual(resumed.outcome.status, "completed");
    assert.strictEqual(host.state.reads, 1);
    assert.strictEqual(resumed.filesChanged.length, 0);
    const callsBefore = provider.calls.length;
    const again = await resumeRun(resumed.id, { provider, registry, store });
    assert.strictEqual(again.lifecycle, "completed");
    assert.strictEqual(provider.calls.length, callsBefore);
  });

  await test("workspace inspection crash is not replayed after resume", async () => {
    const model = new ScriptedModelProvider([{ text: "recovered workspace inspection" }]);
    let inspections = 0;
    const provider = {
      definitions() {
        return [{ name: "workspace.inspect", description: "inspect", parameters: { type: "object", properties: {}, required: [] } }];
      },
      async call(name) {
        assert.strictEqual(name, "workspace.inspect");
        inspections += 1;
        throw Object.assign(new Error("workspace crash"), { code: "crash" });
      },
    };
    const { store } = trackedStore(tempDir());
    const registry = new ToolRegistry(provider);
    const handle = startAgentRun({
      goal: "describe this project",
      model: MODEL,
      providerName: model.name,
      provider: model,
      registry,
      store,
      verify(_run, text) {
        return text.includes("recovered workspace inspection")
          ? { status: "passed", summary: "recovered", evidence: ["recovery"] }
          : { status: "failed", summary: "not recovered", evidence: [] };
      },
    });
    await assert.rejects(handle.done, (error) => error.code === "crash");
    const interrupted = store.load(handle.id);
    assert.strictEqual(interrupted.lifecycle, "interrupted");
    assert.strictEqual(interrupted.workspaceInspected, true);
    assert.strictEqual(interrupted.inFlight.kind, "tool");
    assert.strictEqual(interrupted.inFlight.name, "workspace.inspect");

    const resumed = await resumeRun(handle.id, { provider: model, registry, store, verify(_run, text) {
      return text.includes("recovered workspace inspection")
        ? { status: "passed", summary: "recovered", evidence: ["recovery"] }
        : { status: "failed", summary: "not recovered", evidence: [] };
    } });
    assert.strictEqual(resumed.lifecycle, "completed");
    assert.strictEqual(inspections, 1);
    assert.ok(resumed.observations.some((item) => item.summary.includes("not replayed")));
  });

  await test("sandbox.run is model-visible verification and never counts as a workspace edit", async () => {
    const provider = new ScriptedModelProvider([
      { toolCalls: [{ name: "sandbox.run", args: { command: "node --check src/components/Badge.tsx" } }] },
      { text: "Sandbox verification finished." },
    ]);
    const host = workspaceHost(FIXTURE);
    let sandboxCalls = 0;
    host.runSandbox = async (args) => {
      sandboxCalls += 1;
      return {
        command: args.command,
        exitCode: 0,
        stdout: "",
        stderr: "",
        output: "",
        isolation: "workspace-copy",
        securityBoundary: false,
        network: "best_effort_blocked",
        workspace: "ephemeral_copy",
        discarded: true,
        changedPaths: ["temporary-output.txt"],
      };
    };

    const { store } = trackedStore(tempDir());
    const run = await startAgentRun({
      goal: "Run a disposable sandbox syntax check and report the result.",
      model: MODEL,
      providerName: provider.name,
      provider,
      registry: new ToolRegistry(new ControlledToolProvider(host)),
      store,
      mode: "controlled",
      maxIterations: 4,
      verify(runState, text) {
        const sandboxCall = runState.toolCalls.find((call) => (
          call.name === "sandbox.run" && call.result && call.result.ok
        ));
        if (sandboxCall && text.includes("Sandbox verification finished")) {
          return { status: "passed", summary: "sandbox evidence recorded", evidence: ["sandbox.run"] };
        }
        return { status: "failed", summary: "sandbox evidence missing", evidence: [] };
      },
    }).done;

    assert.strictEqual(run.lifecycle, "completed", quoteRun(run));
    assert.strictEqual(sandboxCalls, 1);
    assert.strictEqual(run.filesChanged.length, 0);
    assert.ok(run.toolCalls.some((call) => (
      call.name === "sandbox.run"
      && call.result
      && call.result.ok
      && call.result.data
      && call.result.data.discarded === true
    )));
    assert.ok(run.progress.progressScore > 0);
    assert.ok(provider.calls[0].tools.some((tool) => tool.name === "sandbox.run"));
    assert.ok(provider.calls.slice(1).some((call) => (
      call.messages.some((message) => (
        message.role === "tool"
        && message.name === "sandbox.run"
        && String(message.content).includes('"discarded":true')
      ))
    )));
  });

  await test("tool registry does not invent definitions for undeclared providers", async () => {
    const provider = {
      async call() {
        throw new Error("not used");
      },
    };
    const registry = new ToolRegistry(provider);
    assert.deepStrictEqual(registry.definitions(), []);
  });

  await test("an in-flight tool is not replayed after recovery", async () => {
    const provider = new ScriptedModelProvider([
      { toolCalls: [{ name: "file.read", args: { path: "README.md" } }] },
      { text: "recovered" },
    ]);
    const host = workspaceHost(FIXTURE);
    const crashing = {
      calls: 0,
      async call() {
        this.calls += 1;
        throw Object.assign(new Error("disk crash"), { code: "crash" });
      },
    };
    const { store } = trackedStore(tempDir());
    const registry = new ToolRegistry(crashing);
    const handle = startAgentRun({
      goal: "read README.md",
      model: MODEL,
      providerName: provider.name,
      provider,
      registry,
      store,
      verify(_run, text) {
        if (text.includes("recovered")) return { status: "passed", summary: "Recovered without replay", evidence: ["interrupted tool"] };
        return { status: "failed", summary: "Still recovering", evidence: [] };
      },
    });
    await assert.rejects(handle.done, (error) => error.code === "crash");
    const interrupted = store.load(handle.id);
    assert.strictEqual(interrupted.lifecycle, "interrupted");
    assert.strictEqual(interrupted.inFlight.kind, "tool");
    assert.strictEqual(interrupted.toolCalls.length, 0);
    const resumed = await resumeRun(handle.id, {
      provider,
      registry,
      store,
      verify(run, text) {
        const skipped = run.observations.some((item) => item.summary.includes("not replayed"));
        if (skipped && text.includes("recovered")) {
          return { status: "passed", summary: "Interrupted tool stayed unreplayed", evidence: ["recovery"] };
        }
        return { status: "failed", summary: "Recovery did not keep the interruption", evidence: [] };
      },
    });
    assert.strictEqual(resumed.lifecycle, "completed");
    assert.strictEqual(crashing.calls, 1);
    assert.strictEqual(host.state.reads, 0);
    assert.ok(resumed.observations.some((item) => item.summary.includes("not replayed")));
  });

  if (!await ollamaAvailable()) {
    console.log("skip Qwen searches, reads, and sees the successful observation — no local Ollama");
    console.log("skip Qwen sees a failed tool observation and does not invent the file — no local Ollama");
    if (process.exitCode) process.exit(process.exitCode);
    return;
  }

  await test("Qwen searches, reads, and sees the successful observation", async () => {
    const provider = new RecordingModelProvider(new OllamaModelProvider({ baseUrl: OLLAMA }));
    const host = workspaceHost(FIXTURE);
    const { store, lifecycles } = trackedStore(tempDir());
    const handle = startAgentRun({
      goal: "Search for Badge, then read src/components/Badge.tsx. After both tool results are visible, reply with exactly src/components/Badge.tsx.",
      model: MODEL,
      providerName: provider.name,
      provider,
      registry: new ToolRegistry(new ReadOnlyToolProvider(host)),
      store,
      capabilities: new ExternalCapabilityProvider(),
      maxIterations: 6,
      timeoutMs: 120000,
      verify(run, text) {
        const searched = run.toolCalls.some((call) => call.name === "repo.search");
        const read = run.toolCalls.some((call) => call.name === "file.read" && call.args.path === "src/components/Badge.tsx" && call.result.ok);
        if (searched && read && text.includes("src/components/Badge.tsx")) {
          return { status: "passed", summary: "Search and read support the path", evidence: ["repo.search", "file.read"] };
        }
        return { status: "failed", summary: "Need repo.search and a successful file.read of src/components/Badge.tsx", evidence: [] };
      },
    });
    const run = await handle.done;
    assert.strictEqual(run.lifecycle, "completed", quoteRun(run));
    assert.ok(run.toolCalls.some((call) => call.name === "repo.search"));
    assert.ok(run.toolCalls.some((call) => call.name === "file.read" && call.result.ok));
    assert.ok(provider.calls.length >= 2);
    const fedBack = provider.calls.slice(1).some((call) => JSON.stringify(call.messages).includes("export function Badge"));
    assert.strictEqual(fedBack, true);
    assert.strictEqual(run.goal.includes("Search for Badge"), true);
    assert.ok(lifecycles.includes("awaiting_model"));
    assert.ok(lifecycles.includes("executing_tool"));
    assert.ok(lifecycles.includes("verifying"));
    assert.strictEqual(run.verification.status, "passed");
    assert.strictEqual(run.filesChanged.length, 0);
    assert.strictEqual(run.outcome.status, "completed");
    assert.ok(run.plan.every((step) => step.status === "completed"));
  });

  await test("Qwen sees a failed tool observation and does not invent the file", async () => {
    const provider = new RecordingModelProvider(new OllamaModelProvider({ baseUrl: OLLAMA }));
    const host = workspaceHost(FIXTURE);
    const { store } = trackedStore(tempDir());
    const handle = startAgentRun({
      goal: "Read src/missing.txt and quote it. If the tool fails, reply exactly TOOL_FAILED.",
      model: MODEL,
      providerName: provider.name,
      provider,
      registry: new ToolRegistry(new ReadOnlyToolProvider(host)),
      store,
      maxIterations: 6,
      maxRetries: 3,
      timeoutMs: 120000,
      verify(run, text) {
        const failed = run.toolCalls.some((call) => call.name === "file.read" && call.args.path === "src/missing.txt" && call.result.ok === false);
        if (failed && text.includes("TOOL_FAILED") && !/export function|badge-demo/.test(text)) {
          return { status: "passed", summary: "The failed read was reported", evidence: ["file.read"] };
        }
        return { status: "failed", summary: "Need a failed file.read of src/missing.txt and the answer TOOL_FAILED", evidence: [] };
      },
    });
    const run = await handle.done;
    assert.strictEqual(run.lifecycle, "completed", quoteRun(run));
    const fedBack = provider.calls.slice(1).some((call) =>
      call.messages.some((message) => message.role === "tool" && String(message.content).includes('"ok":false')),
    );
    assert.strictEqual(fedBack, true, JSON.stringify(provider.calls.map((call) => call.messages.map((message) => message.role))));
    assert.ok(run.outcome.summary.includes("TOOL_FAILED"));
    assert.strictEqual(run.filesChanged.length, 0);
  });

  if (process.exitCode) process.exit(process.exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
