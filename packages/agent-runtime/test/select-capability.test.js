const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ModelProvider, RunStore, startAgentRun, ToolRegistry, ReadOnlyToolProvider, ControlledToolProvider, selectCapability, isSiteLayoutGoal } = require("../index.js");
const { needsOutsideEvidence } = require("../strategy");

const LIVE = [
  { name: "hub.health", category: "hub", risk: "read", permissions: ["evidence"], description: "Echo a short token and report hub health" },
  { name: "research.problem", category: "research", risk: "read", permissions: ["evidence"], description: "Gather short evidence for a problem. Returns sources and excerpts." },
  { name: "knowledge.lookup", category: "knowledge", risk: "read", permissions: ["evidence"], description: "Find a prior note by query, or remember a short note." },
  { name: "task.decompose", category: "task", risk: "read", permissions: ["evidence"], description: "Split a large goal into a bounded task graph." },
];

class ScriptedModelProvider extends ModelProvider {
  constructor(steps) {
    super("scripted");
    this.steps = [...steps];
    this.calls = [];
  }

  async complete(input) {
    this.calls.push(input);
    const step = this.steps.shift();
    if (!step) throw Object.assign(new Error("no scripted decision"), { code: "model_disconnected" });
    return { text: step.text || "", toolCalls: step.toolCalls || [] };
  }
}

function liveHub(state) {
  return {
    async listCapabilities() {
      return LIVE.map((item) => ({ name: item.name, description: item.description }));
    },
    async invoke(request) {
      state.invocations.push(request.capability);
      return {
        protocolVersion: 1,
        requestId: request.requestId,
        status: "ok",
        data: {
          problem: request.input && (request.input.problem || request.input.goal || request.input.query),
          evidence: [{ title: "Published note", url: "https://example.com/note", excerpt: "short evidence", source: "test" }],
        },
        sources: [],
        warnings: [],
        error: null,
        duration: 4,
      };
    },
  };
}

function start(options) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-select-"));
  const workspace = path.join(directory, "ws");
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, "README.md"), "site notes\n");
  const host = {
    async readFile(filePath) {
      return { path: filePath, contents: fs.readFileSync(path.join(workspace, filePath), "utf8") };
    },
    async search() { return { query: "", matches: [] }; },
    async gitStatus() { return { branch: "main", changes: [] }; },
    async gitDiff() { return { diff: "" }; },
    async diagnostics() { return { items: [] }; },
    async browserCheck(url) { return { available: false, code: "browser_unavailable", message: "none", url }; },
  };
  const provider = options.provider;
  return startAgentRun({
    goal: options.goal,
    model: "scripted",
    providerName: "scripted",
    mode: options.mode || "read_only",
    composerMode: options.composerMode,
    taskClass: options.taskClass,
    provider,
    registry: new ToolRegistry(new ReadOnlyToolProvider(host)),
    store: new RunStore(path.join(directory, "runs")),
    capabilities: options.capabilities,
    maxIterations: options.maxIterations ?? 8,
  });
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

async function main() {
  await test("selectCapability matches research, decompose, lookup, and skips unpublished names", async () => {
    const research = selectCapability("research the website", LIVE, { composerMode: "ask" });
    assert.strictEqual(research && research.name, "research.problem");

    const decompose = selectCapability("Build a landing page and a cart and a checkout and email receipts", LIVE);
    assert.strictEqual(decompose && decompose.name, "task.decompose");

    const numbered = selectCapability("1. Design the API 2. Write the clients 3. Ship the docs", LIVE);
    assert.strictEqual(numbered && numbered.name, "task.decompose");

    const plan = selectCapability(
      "Map the checkout, inventory, and admin work into a sequenced delivery for the next sprint",
      LIVE,
      { composerMode: "plan", taskClass: "plan" },
    );
    assert.strictEqual(plan && plan.name, "task.decompose");

    const lookup = selectCapability("What did we save in the project notes about the webhook", LIVE);
    assert.strictEqual(lookup && lookup.name, "knowledge.lookup");

    const none = selectCapability("Explain the readme", LIVE);
    assert.strictEqual(none, null);

    const unpublished = selectCapability("research the website", LIVE.filter((item) => item.category !== "research"));
    assert.strictEqual(unpublished, null);

    const empty = selectCapability("research the website", []);
    assert.strictEqual(empty, null);

    const coding = selectCapability("Repair the identification-number check. The doubling rule is not in the repository.", LIVE);
    assert.strictEqual(coding, null);

    assert.strictEqual(needsOutsideEvidence("change this CSS so the header is tighter"), false);
    assert.strictEqual(needsOutsideEvidence("rename the submit button"), false);
    assert.strictEqual(needsOutsideEvidence("read the readme file"), false);
    assert.strictEqual(needsOutsideEvidence("run the project"), false);
    assert.strictEqual(needsOutsideEvidence("create a page from the files already in the folder"), false);
    assert.strictEqual(needsOutsideEvidence("Repair the greeting. The test is failing."), false);
    assert.strictEqual(needsOutsideEvidence("what are the current best practices for storing passwords"), true);
    assert.strictEqual(needsOutsideEvidence("research the website"), true);
    assert.strictEqual(needsOutsideEvidence("Repair the identification-number check. The doubling rule is not in the repository."), true);
    assert.strictEqual(isSiteLayoutGoal("can you find me a better layout for my website"), true);
    assert.strictEqual(selectCapability("can you find me a better layout for my website", LIVE, { composerMode: "code" }), null);
  });

  await test("a local edit skips the hub and a stalled repair can ask for evidence later", async () => {
    const skipped = { invocations: [] };
    const rename = new ScriptedModelProvider([
      { text: "Reading the page.", toolCalls: [{ name: "file.read", args: { path: "README.md" } }] },
      { text: "The submit button is named Send." },
    ]);
    const local = await start({
      goal: "rename the submit button",
      provider: rename,
      capabilities: liveHub(skipped),
      mode: "read_only",
      composerMode: "ask",
    }).done;
    assert.strictEqual(local.lifecycle, "completed");
    assert.deepStrictEqual(skipped.invocations, []);
    assert.ok(!rename.calls[0].messages.some((message) => String(message.content).includes("The hub read this prompt before coding")));

    const stalled = { invocations: [], requests: [] };
    const hub = liveHub(stalled);
    const originalInvoke = hub.invoke.bind(hub);
    hub.invoke = async (request) => {
      stalled.requests.push(request);
      return originalInvoke(request);
    };
    const search = { name: "repo.search", args: { query: "greeting" } };
    const provider = new ScriptedModelProvider(Array.from({ length: 8 }, () => ({ text: "Looking again.", toolCalls: [search] })));
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-preflight-"));
    const goal = "Repair the greeting. The test is failing.";
    const run = await startAgentRun({
      goal,
      model: "scripted",
      providerName: "scripted",
      mode: "controlled",
      composerMode: "code",
      provider,
      registry: new ToolRegistry(new ControlledToolProvider({
        async readFile(filePath) { return { path: filePath, contents: "module.exports = {};\n" }; },
        async writeFile(filePath, contents) { return { path: filePath, bytes: Buffer.byteLength(contents) }; },
        async listDirectory() { return { path: ".", entries: [] }; },
        async search(query) { return { query, matches: [{ path: "src/greet.js", line: 1, text: "function greet" }] }; },
        async runTerminal() { return { exitCode: 0, stdout: "", stderr: "" }; },
        async runTests() { return { exitCode: 1, stdout: "", stderr: "fail" }; },
        async diagnostics() { return { items: [] }; },
        async gitStatus() { return { porcelain: "", exitCode: 0 }; },
        async gitDiff() { return { diff: "", exitCode: 0 }; },
        async browserCheck(url) { return { url, available: true, statusCode: 200 }; },
        async createDirectory(dirPath) { return { path: dirPath }; },
      })),
      store: new RunStore(path.join(directory, "runs")),
      capabilities: hub,
      maxIdenticalActions: 20,
      verify: () => ({ status: "failed", summary: "the greeting is still wrong", evidence: [] }),
    }).done;
    assert.strictEqual(run.goal, goal);
    assert.deepStrictEqual(stalled.invocations, ["research.problem"]);
    assert.ok(run.toolCalls.some((call) => call.directedBy === "runtime" && call.iteration > 0));
    assert.ok(!provider.calls[0].messages.some((message) => String(message.content).includes("The hub read this prompt before coding")));
    assert.ok(provider.calls.some((call) => call.messages.some((message) => String(message.content).startsWith("Goal: ") && String(message.content).includes(goal))));
    const request = stalled.requests[0];
    assert.ok(String(request.input.problem).includes(goal));
    assert.strictEqual(request.context.taskClass, "bug-fix");
    assert.ok(!/files|repository|workspace|filesystem|contents|command|shell/.test(Object.keys(request.context).join(" ")));
  });

  await test("a research-style goal with a live hub list is invoked once when the model does not call it", async () => {
    const state = { invocations: [] };
    const provider = new ScriptedModelProvider([
      { text: "Reading the site.", toolCalls: [{ name: "file.read", args: { path: "README.md" } }] },
      { text: "The workspace site is a dealership preview." },
    ]);
    const run = await start({
      goal: "research the website",
      provider,
      capabilities: liveHub(state),
      composerMode: "ask",
    }).done;
    assert.strictEqual(run.lifecycle, "completed");
    const invoked = run.toolCalls.filter((call) => call.name === "capability.invoke");
    assert.strictEqual(invoked.length, 1);
    assert.strictEqual(invoked[0].args.capability, "research.problem");
    assert.strictEqual(invoked[0].directedBy, "runtime");
    assert.deepStrictEqual(state.invocations, ["research.problem"]);
    const offered = provider.calls[0].tools.map((tool) => tool.name);
    assert.ok(offered.includes("capability.invoke"));
  });

  await test("a new website prompt is researched before the model starts", async () => {
    const state = { invocations: [] };
    const provider = new ScriptedModelProvider([
      { text: "Listing the workspace.", toolCalls: [{ name: "dir.list", args: { path: "." } }] },
      { text: "Writing the project file.", toolCalls: [{ name: "file.write", args: { path: "package.json", contents: "{\"scripts\":{\"start\":\"node server.js --port 4173\"}}\n" } }] },
      { text: "Writing the server.", toolCalls: [{ name: "file.write", args: { path: "server.js", contents: "require(\"http\").createServer((req, res) => res.end(\"ok\")).listen(4173, \"127.0.0.1\");\n" } }] },
      { text: "Writing the page.", toolCalls: [{ name: "file.write", args: { path: "index.html", contents: "<html><body><h1>Dealership</h1></body></html>\n" } }] },
      { text: "Checking the preview.", toolCalls: [{ name: "browser.check", args: { url: "http://127.0.0.1:4173/" } }] },
      { text: "The dealership page can list cars for bid or buy now." },
    ]);
    const goal = "can you create me a website about a dealership where I can sell cars, post them so people can bid or buy now, create an account, and post their own cars for sale";
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-build-"));
    const workspace = path.join(directory, "ws");
    fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(workspace, "README.md"), "site notes\n");
    const host = {
      async readFile(filePath) {
        return { path: filePath, contents: fs.readFileSync(path.join(workspace, filePath), "utf8") };
      },
      async writeFile(filePath, contents) {
        const full = path.join(workspace, filePath);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, contents);
        return { path: filePath, bytes: Buffer.byteLength(contents) };
      },
      async listDirectory() {
        return { path: ".", entries: [{ path: "README.md", type: "file" }] };
      },
      async search() { return { query: "", matches: [] }; },
      async gitStatus() { return { branch: "main", changes: [] }; },
      async gitDiff() { return { diff: "" }; },
      async diagnostics() { return { items: [] }; },
      async browserCheck(url) { return { url, statusCode: 200, title: "Dealership", available: true }; },
    };
    const run = await startAgentRun({
      goal,
      model: "scripted",
      providerName: "scripted",
      mode: "controlled",
      composerMode: "code",
      provider,
      registry: new ToolRegistry(new ControlledToolProvider(host)),
      store: new RunStore(path.join(directory, "runs")),
      capabilities: liveHub(state),
      maxIterations: 8,
    }).done;
    assert.strictEqual(run.taskClass, "build");
    assert.strictEqual(run.lifecycle, "completed", `${run.error && run.error.code}: ${run.verification && run.verification.summary}`);
    assert.deepStrictEqual(state.invocations, ["research.problem"]);
    const directed = run.toolCalls.find((call) => call.directedBy === "runtime");
    assert.ok(directed);
    assert.strictEqual(directed.iteration, 0);
    assert.strictEqual(directed.args.input.problem, goal);
    assert.ok(provider.calls[0].messages.some((message) => String(message.content).includes("The hub read this prompt before coding")));
    assert.ok(provider.calls[0].messages.some((message) => String(message.content).includes("short evidence")));
  });

  await test("a multi-part goal selects the listed decompose capability", async () => {
    const state = { invocations: [] };
    const provider = new ScriptedModelProvider([
      { text: "Inspecting first.", toolCalls: [{ name: "file.read", args: { path: "README.md" } }] },
      { text: "1. Landing page\n2. Cart\n3. Checkout\n4. Receipts" },
    ]);
    const run = await start({
      goal: "Build a landing page and a cart and a checkout and email receipts",
      provider,
      capabilities: liveHub(state),
      composerMode: "ask",
    }).done;
    assert.strictEqual(run.lifecycle, "completed");
    const invoked = run.toolCalls.find((call) => call.name === "capability.invoke" && call.args && call.args.capability === "task.decompose");
    assert.ok(invoked);
    assert.strictEqual(invoked.directedBy, "runtime");
    assert.deepStrictEqual(state.invocations, ["research.problem", "task.decompose"]);
  });

  await test("empty discovery offers no capability tools and never invokes", async () => {
    const state = { invocations: [] };
    const provider = new ScriptedModelProvider([
      { text: "Reading.", toolCalls: [{ name: "file.read", args: { path: "README.md" } }] },
      { text: "The readme describes the project." },
    ]);
    const run = await start({
      goal: "research the website",
      provider,
      capabilities: {
        async listCapabilities() { return []; },
        async invoke(request) {
          state.invocations.push(request.capability);
          return { protocolVersion: 1, requestId: request.requestId, status: "ok", data: {}, sources: [], warnings: [], error: null, duration: 1 };
        },
      },
    }).done;
    assert.strictEqual(run.lifecycle, "completed");
    assert.ok(run.toolCalls.every((call) => call.name !== "capability.invoke" && call.name !== "capability.list"));
    assert.deepStrictEqual(state.invocations, []);
    const names = provider.calls[0].tools.map((tool) => tool.name);
    assert.ok(!names.includes("capability.invoke"));
    assert.ok(!names.includes("capability.list"));
    assert.strictEqual(run.progress.recommendedName, null);
  });

  await test("a Code layout goal writes HTML and previews without calling the hub", async () => {
    const state = { invocations: [] };
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-layout-"));
    const workspace = path.join(directory, "ws");
    fs.mkdirSync(path.join(workspace, "src/styles"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "src/index.html"), "<html><body>old</body></html>\n");
    fs.writeFileSync(path.join(workspace, "src/styles/site.css"), "body{margin:0}\n");
    const host = {
      async readFile(filePath) {
        return { path: filePath, contents: fs.readFileSync(path.join(workspace, filePath), "utf8") };
      },
      async writeFile(filePath, contents) {
        fs.writeFileSync(path.join(workspace, filePath), contents);
        return { path: filePath, bytes: Buffer.byteLength(contents) };
      },
      async search() { return { query: "html", matches: [{ path: "src/index.html", line: 1, text: "<html>" }] }; },
      async gitStatus() { return { branch: "main", changes: [] }; },
      async gitDiff() { return { diff: "" }; },
      async diagnostics() { return { items: [] }; },
      async browserCheck(url) { return { url, statusCode: 200, title: "CarBid", available: true }; },
    };
    const provider = new ScriptedModelProvider([
      { text: "Reading the page.", toolCalls: [{ name: "file.read", args: { path: "src/index.html" } }] },
      { text: "Reading the CSS.", toolCalls: [{ name: "file.read", args: { path: "src/styles/site.css" } }] },
      { text: "Applying a tighter layout.", toolCalls: [{ name: "file.write", args: { path: "src/index.html", contents: "<html><body><header>Showroom</header></body></html>\n" } }] },
      { text: "Checking the preview.", toolCalls: [{ name: "browser.check", args: { url: "http://127.0.0.1:4173/" } }] },
      { text: "" },
    ]);
    const run = await startAgentRun({
      goal: "can you find me a better layout for my website",
      model: "scripted",
      providerName: "scripted",
      mode: "controlled",
      composerMode: "code",
      provider,
      registry: new ToolRegistry(new ControlledToolProvider(host)),
      store: new RunStore(path.join(directory, "runs")),
      capabilities: liveHub(state),
      maxIterations: 8,
    }).done;
    assert.strictEqual(run.taskClass, "layout");
    assert.strictEqual(run.progress.inspectSatisfied, true);
    assert.strictEqual(run.plan.find((step) => step.id === "inspect").status, "completed");
    assert.strictEqual(run.progress.recommendedName, null);
    assert.strictEqual(run.progress.selectedName, null);
    assert.deepStrictEqual(state.invocations, []);
    assert.ok(run.toolCalls.every((call) => call.name !== "capability.invoke"));
    assert.ok(provider.calls.some((call) => call.messages.some((message) => String(message.content).includes("Change") && String(message.content).includes("file.patch"))));
    const writeTools = (provider.calls[2] && provider.calls[2].tools || []).map((item) => item.name).sort();
    assert.deepStrictEqual(writeTools, ["browser.check", "file.patch", "file.write"]);
    assert.ok(run.toolCalls.some((call) => call.name === "file.write" && call.args.path === "src/index.html"));
    assert.ok(run.toolCalls.some((call) => call.name === "browser.check" && call.result && call.result.ok));
    assert.strictEqual(run.lifecycle, "completed", `${run.error && run.error.code}: ${run.verification && run.verification.summary}`);
  });

  await test("a Code layout goal cannot finish until it writes and previews", async () => {
    const state = { invocations: [] };
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-layout-verify-"));
    const workspace = path.join(directory, "ws");
    fs.mkdirSync(path.join(workspace, "src/styles"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "src/index.html"), "<html><body>old</body></html>\n");
    fs.writeFileSync(path.join(workspace, "src/styles/site.css"), "body{margin:0}\n");
    const host = {
      async readFile(filePath) {
        return { path: filePath, contents: fs.readFileSync(path.join(workspace, filePath), "utf8") };
      },
      async writeFile(filePath, contents) {
        fs.writeFileSync(path.join(workspace, filePath), contents);
        return { path: filePath, bytes: Buffer.byteLength(contents) };
      },
      async search() { return { query: "html", matches: [{ path: "src/index.html", line: 1, text: "<html>" }] }; },
      async gitStatus() { return { branch: "main", changes: [] }; },
      async gitDiff() { return { diff: "" }; },
      async diagnostics() { return { items: [] }; },
      async browserCheck(url) { return { url, statusCode: 200, title: "CarBid", available: true }; },
    };
    const provider = new ScriptedModelProvider([
      { text: "Reading the page.", toolCalls: [{ name: "file.read", args: { path: "src/index.html" } }] },
      { text: "Reading the CSS.", toolCalls: [{ name: "file.read", args: { path: "src/styles/site.css" } }] },
      { text: "I'll apply a better layout to the HTML and CSS files." },
      { text: "Applying a tighter layout.", toolCalls: [{ name: "file.write", args: { path: "src/index.html", contents: "<html><body><header>Showroom</header></body></html>\n" } }] },
      { text: "Checking the preview.", toolCalls: [{ name: "browser.check", args: { url: "http://127.0.0.1:4173/" } }] },
      { text: "The layout is updated on the preview." },
    ]);
    const run = await startAgentRun({
      goal: "can you find me a better layout for my website",
      model: "scripted",
      providerName: "scripted",
      mode: "controlled",
      composerMode: "code",
      provider,
      registry: new ToolRegistry(new ControlledToolProvider(host)),
      store: new RunStore(path.join(directory, "runs")),
      capabilities: liveHub(state),
      maxIterations: 8,
    }).done;
    assert.ok(provider.calls.some((call) => call.messages.some((message) => String(message.content).includes("file.patch"))));
    assert.ok(run.toolCalls.some((call) => call.name === "file.write"));
    assert.ok(run.toolCalls.some((call) => call.name === "browser.check"));
    assert.strictEqual(run.verification.summary, "The layout change is visible in the preview");
    assert.strictEqual(run.lifecycle, "completed", `${run.error && run.error.code}: ${run.verification && run.verification.summary}`);
  });

  await test("a layout goal skips a repeated search and replans locally", async () => {
    const state = { invocations: [] };
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-layout-repeat-"));
    const workspace = path.join(directory, "ws");
    fs.mkdirSync(path.join(workspace, "src/styles"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "src/index.html"), "<html><body>old</body></html>\n");
    fs.writeFileSync(path.join(workspace, "src/styles/site.css"), "body{margin:0}\n");
    const host = {
      async readFile(filePath) {
        return { path: filePath, contents: fs.readFileSync(path.join(workspace, filePath), "utf8") };
      },
      async writeFile(filePath, contents) {
        fs.writeFileSync(path.join(workspace, filePath), contents);
        return { path: filePath, bytes: Buffer.byteLength(contents) };
      },
      async search() { return { query: "CarBidDealership", matches: [{ path: "src/index.html", line: 1, text: "<html>" }] }; },
      async gitStatus() { return { branch: "main", changes: [] }; },
      async gitDiff() { return { diff: "" }; },
      async diagnostics() { return { items: [] }; },
      async browserCheck(url) { return { url, statusCode: 200, title: "CarBid", available: true }; },
    };
    const provider = new ScriptedModelProvider([
      { text: "Let me search for HTML files", toolCalls: [{ name: "repo.search", args: { query: "CarBidDealership" } }] },
      { text: "I need to inspect the current HTML", toolCalls: [{ name: "file.read", args: { path: "src/index.html" } }] },
      { text: "Let me also read the CSS", toolCalls: [{ name: "file.read", args: { path: "src/styles/site.css" } }] },
      { text: "Let me search for HTML files", toolCalls: [{ name: "repo.search", args: { query: "CarBidDealership" } }] },
      { text: "Applying a tighter layout.", toolCalls: [{ name: "file.write", args: { path: "src/index.html", contents: "<html><body><header>Showroom</header></body></html>\n" } }] },
      { text: "Checking the preview.", toolCalls: [{ name: "browser.check", args: { url: "http://127.0.0.1:4173/" } }] },
      { text: "The layout is updated on the preview." },
    ]);
    const run = await startAgentRun({
      goal: "can you find me a better layout for my website",
      model: "scripted",
      providerName: "scripted",
      mode: "controlled",
      composerMode: "code",
      provider,
      registry: new ToolRegistry(new ControlledToolProvider(host)),
      store: new RunStore(path.join(directory, "runs")),
      capabilities: liveHub(state),
      maxIterations: 8,
    }).done;
    const searches = run.toolCalls.filter((call) => call.name === "repo.search");
    assert.strictEqual(searches.length, 2);
    assert.strictEqual(searches[1].result.data.repeated, true);
    assert.ok(searches[0].result.data.matches.length > 0);
    assert.deepStrictEqual(state.invocations, []);
    assert.ok(run.toolCalls.every((call) => call.name !== "capability.invoke"));
    assert.ok(run.progress.inspectSatisfied);
    assert.ok(run.progress.replanned || provider.calls.some((call) => call.messages.some((message) => String(message.content).includes("Do not search the same query"))));
    assert.strictEqual(run.lifecycle, "completed", `${run.error && run.error.code}: ${run.verification && run.verification.summary}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
