const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { ModelProvider, OllamaModelProvider, ReadOnlyToolProvider, ToolRegistry, ExternalCapabilityProvider, RunStore, createRun, startAgentRun, resumeRun } = require("../index.js");

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
