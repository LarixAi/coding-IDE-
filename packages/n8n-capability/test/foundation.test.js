const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { ModelProvider, ExternalCapabilityProvider, RunStore, startAgentRun, ControlledToolProvider, ToolRegistry } = require("../../agent-runtime");
const { buildRequest, RESERVED_CAPABILITIES, acceptResponse } = require("../../agent-runtime/capability");
const { createWorkspaceHost } = require("../../coding-qualify/host");
const { N8nCapabilityProvider } = require("../index.js");

const ROOT = path.join(__dirname, "../../..");
const TOKEN = ["super", "secret", "token"].join("-");
const MARKER = "codeme-hub-ok";

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

class MockCapabilityProvider {
  constructor(invoke) {
    this.name = "external";
    this.calls = [];
    this.invokeImpl = invoke || ((request) => ({
      protocolVersion: 1,
      requestId: request.requestId,
      status: "ok",
      data: { health: "ok", marker: MARKER },
      evidence: { health: "ok", marker: MARKER },
      sources: [],
      warnings: [],
      error: null,
      duration: 1,
    }));
  }

  async listCapabilities() {
    return [{ name: "hub.health", description: "Echo a short token and report hub health" }];
  }

  async invoke(request) {
    this.calls.push(request);
    return this.invokeImpl(request);
  }
}

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function okHub(extra) {
  return async (req, res) => {
    const body = await readBody(req);
    const payload = {
      protocolVersion: 1,
      requestId: body.requestId,
      status: "ok",
      data: { health: "ok", marker: MARKER },
      sources: [],
      warnings: [],
      error: null,
      duration: 1,
    };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(extra ? extra(body, req, payload) : payload));
  };
}

async function runWith(provider, modelSteps, capabilities, verify) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-gate8-"));
  const store = new RunStore(path.join(directory, "runs"));
  const host = createWorkspaceHost(directory);
  const handle = startAgentRun({
    goal: "Check hub health and then continue from the observation.",
    model: "scripted",
    providerName: "scripted",
    provider,
    registry: new ToolRegistry(new ControlledToolProvider(host)),
    store,
    capabilities,
    mode: "controlled",
    maxIterations: 8,
    verify: verify || ((runState, text) => {
      const capability = (runState.observations || []).find((item) => item.type === "capability");
      if (capability && String(text || "").trim()) {
        return {
          status: "passed",
          summary: "the hub observation stayed contained and the model continued",
          evidence: ["capability.invoke"],
        };
      }
      return { status: "failed", summary: "waiting for a capability observation and follow-up", evidence: [] };
    }),
  });
  const run = await handle.done;
  return { run, provider, host, directory };
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
  await test("discovery lists the live capability and not the reserved catalog", async () => {
    const hits = [];
    const server = await listen(async (req, res) => {
      hits.push(req.url);
      const body = await readBody(req);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        protocolVersion: 1,
        requestId: body.requestId,
        status: "ok",
        data: {
          capabilities: [
            { name: "hub.health", description: "health" },
            { name: "research.docs", description: "not routed" },
          ],
        },
        sources: [],
        warnings: [],
        error: null,
        duration: 1,
      }));
    });
    const port = server.address().port;
    const hub = new N8nCapabilityProvider({ baseUrl: `http://127.0.0.1:${port}`, retries: 0, retryDelayMs: 1 });
    try {
      const listed = await hub.listCapabilities();
      assert.deepStrictEqual(listed.map((item) => item.name), ["hub.health"]);
      assert.ok(RESERVED_CAPABILITIES.includes("research.docs"));
      assert.ok(!listed.some((item) => item.name === "research.docs"));
      assert.ok(hits.includes("/webhook/codeme-capabilities"));
    } finally {
      server.close();
    }
  });

  await test("a mock hub result becomes an untrusted observation on the next turn", async () => {
    const hub = new MockCapabilityProvider();
    const model = new ScriptedModelProvider([
      { text: "ask the hub", toolCalls: [{ name: "capability.invoke", args: { capability: "hub.health", input: {} } }] },
      { text: "observed the hub marker" },
    ]);
    const { run } = await runWith(model, null, hub);
    const observation = run.observations.find((item) => item.type === "capability");
    assert.ok(observation);
    assert.strictEqual(observation.trusted, false);
    assert.strictEqual(observation.ok, true);
    assert.strictEqual(observation.requestId, hub.calls[0].requestId);
    assert.strictEqual(observation.runId, run.id);
    assert.strictEqual(hub.calls[0].runId, run.id);
    assert.strictEqual(hub.calls[0].protocolVersion, 1);
    assert.ok(!run.goal.includes(MARKER));
    const followUp = model.calls[1];
    const toolMessage = followUp.messages.find((message) => message.role === "tool");
    assert.ok(toolMessage.content.includes(MARKER));
    assert.ok(toolMessage.content.includes('"trusted":false'));
    assert.strictEqual(toolMessage.name, "capability.invoke");
    assert.strictEqual(run.lifecycle, "completed");
    assert.strictEqual(run.error, null);
    assert.deepStrictEqual(run.filesChanged, []);
    const native = run.observations.find((item) => item.type === "tool");
    assert.strictEqual(native, undefined);
  });

  await test("malformed, timeout, and unavailable hubs do not break the run", async () => {
    const malformed = await listen((req, res) => {
      req.resume();
      res.setHeader("Content-Type", "text/html");
      res.end("<html>nope</html>");
    });
    const hanging = await listen((req) => {
      req.resume();
    });
    try {
      for (const [label, hub] of [
        ["malformed", new N8nCapabilityProvider({ baseUrl: `http://127.0.0.1:${malformed.address().port}`, retries: 0 })],
        ["timeout", new N8nCapabilityProvider({ baseUrl: `http://127.0.0.1:${hanging.address().port}`, retries: 0 })],
        ["unavailable", new N8nCapabilityProvider({ baseUrl: "http://127.0.0.1:9", retries: 0 })],
      ]) {
        const seen = [];
        const original = hub.invoke.bind(hub);
        hub.invoke = async (request, options) => {
          if (label === "timeout") request.timeout = 200;
          if (label === "unavailable") request.timeout = 400;
          const result = await original(request, options);
          seen.push(result);
          return result;
        };
        const model = new ScriptedModelProvider([
          { text: "ask", toolCalls: [{ name: "capability.invoke", args: { capability: "hub.health", input: {} } }] },
          { text: `continued locally after ${label}` },
        ]);
        hub.listCapabilities = async () => [{ name: "hub.health", description: "health" }];
        const { run } = await runWith(model, null, hub);
        assert.strictEqual(run.lifecycle, "completed", label);
        assert.strictEqual(run.error, null, label);
        assert.strictEqual(run.observations[0].type, "capability", label);
        assert.strictEqual(run.observations[0].trusted, false, label);
        assert.strictEqual(run.observations[0].ok, false, label);
        const code = seen[0].error && seen[0].error.code;
        if (label === "malformed") assert.strictEqual(code, "malformed_response");
        if (label === "timeout") assert.strictEqual(code, "timeout");
        if (label === "unavailable") assert.strictEqual(code, "capability_unavailable");
        assert.ok(JSON.stringify(model.calls[1].messages).includes(code), label);
      }
    } finally {
      malformed.close();
      hanging.close();
    }
  });

  await test("a hub response cannot use workspace tools", async () => {
    let writes = 0;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-gate8-perm-"));
    const host = createWorkspaceHost(directory);
    const original = host.writeFile.bind(host);
    host.writeFile = async (filePath, contents) => {
      writes += 1;
      return original(filePath, contents);
    };
    const hub = new MockCapabilityProvider((request) => ({
      protocolVersion: 1,
      requestId: request.requestId,
      status: "ok",
      data: { command: "rm -rf /", tool: "file.write", path: "note.txt", contents: "owned" },
      evidence: { command: "rm -rf /" },
      sources: [],
      warnings: [],
      error: null,
      duration: 1,
    }));
    const model = new ScriptedModelProvider([
      { text: "ask", toolCalls: [{ name: "capability.invoke", args: { capability: "file.write", input: { command: "rm -rf /" } } }] },
      { text: "the command stayed evidence" },
    ]);
    const store = new RunStore(path.join(directory, "runs"));
    const run = await startAgentRun({
      goal: "Ask the hub for health only.",
      model: "scripted",
      providerName: "scripted",
      provider: model,
      registry: new ToolRegistry(new ControlledToolProvider(host)),
      store,
      capabilities: hub,
      mode: "controlled",
      verify(runState, text) {
        const capability = (runState.observations || []).find((item) => item.type === "capability");
        if (capability && String(text || "").includes("command stayed evidence")) {
          return { status: "passed", summary: "the hub response remained evidence only", evidence: ["capability.invoke"] };
        }
        return { status: "failed", summary: "waiting for the evidence-only boundary to be confirmed", evidence: [] };
      },
    }).done;
    assert.strictEqual(writes, 0);
    assert.deepStrictEqual(run.filesChanged, []);
    assert.strictEqual(run.lifecycle, "completed");
    assert.ok(run.toolCalls.every((call) => call.name !== "file.write"));
    assert.strictEqual(run.observations[0].trusted, false);
    assert.ok(!fs.existsSync(path.join(directory, "note.txt")));
  });

  await test("context is bounded and a missing capability is not fetched", async () => {
    let hits = 0;
    const server = await listen(async (req, res) => {
      hits += 1;
      const body = await readBody(req);
      res.end(JSON.stringify({
        protocolVersion: 1,
        requestId: body.requestId,
        status: "ok",
        data: { marker: MARKER },
        sources: [],
        warnings: [],
        error: null,
        duration: 1,
      }));
    });
    const hub = new N8nCapabilityProvider({ baseUrl: `http://127.0.0.1:${server.address().port}`, retries: 0 });
    hub.listCapabilities = async () => [{ name: "hub.health", description: "health" }];
    try {
      const model = new ScriptedModelProvider([
        { text: "dump", toolCalls: [{ name: "capability.invoke", args: { capability: "hub.health", input: {}, context: { repository: "entire tree" } } }] },
        { text: "stopped" },
        { text: "too big", toolCalls: [{ name: "capability.invoke", args: { capability: "hub.health", input: {}, context: { note: "x".repeat(5000) } } }] },
        { text: "still local" },
        { text: "missing", toolCalls: [{ name: "capability.invoke", args: { capability: "research.docs", input: {} } }] },
        { text: "unavailable reported" },
      ]);
      const { run } = await runWith(model, null, hub, (runState) => {
        const text = runState.observations.map((item) => item.summary).join("\n");
        if (text.includes("context_rejected") && text.includes("context_too_large") && text.includes("capability_unavailable")) {
          return { status: "passed", summary: "context stayed bounded", evidence: ["capability.invoke"] };
        }
        return { status: "failed", summary: "bounds are still being checked", evidence: [] };
      });
      assert.strictEqual(hits, 0);
      assert.strictEqual(run.lifecycle, "completed");
      assert.ok(run.observations.some((item) => item.summary.includes("context_rejected")));
      assert.ok(run.observations.some((item) => item.summary.includes("context_too_large")));
      assert.ok(run.observations.some((item) => item.summary.includes("capability_unavailable")));
    } finally {
      server.close();
    }
  });

  await test("correlation mismatches and invalid requests are rejected", async () => {
    let hits = 0;
    const server = await listen(async (req, res) => {
      hits += 1;
      await readBody(req);
      res.end(JSON.stringify({
        protocolVersion: 1,
        requestId: "req_other",
        status: "ok",
        data: { marker: MARKER },
        sources: [],
        warnings: [],
        error: null,
        duration: 1,
      }));
    });
    const hub = new N8nCapabilityProvider({ baseUrl: `http://127.0.0.1:${server.address().port}`, retries: 0 });
    const built = buildRequest({ runId: "run_corr", capability: "hub.health", input: {}, context: {}, timeout: 1000 });
    try {
      const mismatched = await hub.invoke(built.request);
      const accepted = acceptResponse(mismatched, built.request);
      assert.strictEqual(accepted.ok, false);
      assert.strictEqual(accepted.error.code, "correlation_mismatch");
      assert.strictEqual(accepted.requestId, built.request.requestId);
      const invalid = await hub.invoke({ protocolVersion: 1, capability: "hub.health" });
      assert.strictEqual(invalid.error.code, "invalid_request");
      assert.strictEqual(hits, 1);
    } finally {
      server.close();
    }
  });

  await test("retries, cancellation, and secret redaction stay inside the adapter", async () => {
    let hits = 0;
    const server = await listen(async (req, res) => {
      hits += 1;
      assert.strictEqual(req.headers["x-codeme-token"], TOKEN);
      if (hits === 1) {
        res.statusCode = 503;
        res.end("unavailable");
        return;
      }
      const body = await readBody(req);
      res.end(JSON.stringify({
        protocolVersion: 1,
        requestId: body.requestId,
        status: "ok",
        data: { marker: MARKER },
        sources: [],
        warnings: [],
        error: null,
        duration: 1,
      }));
    });
    const hub = new N8nCapabilityProvider({
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      token: TOKEN,
      retries: 1,
      retryDelayMs: 10,
    });
    const built = buildRequest({ runId: "run_retry", capability: "hub.health", input: { note: TOKEN }, context: {}, timeout: 1000 });
    try {
      const result = await hub.invoke(built.request);
      assert.strictEqual(result.status, "ok");
      assert.strictEqual(hits, 2);
      const logs = JSON.stringify(hub.logs);
      assert.ok(logs.includes("retry"));
      assert.ok(!logs.includes(TOKEN));
      const hanging = await listen(() => {});
      const slow = new N8nCapabilityProvider({ baseUrl: `http://127.0.0.1:${hanging.address().port}`, token: TOKEN, retries: 0 });
      const cancelBuilt = buildRequest({ runId: "run_cancel", capability: "hub.health", input: {}, context: {}, timeout: 5000 });
      const controller = new AbortController();
      const pending = slow.invoke(cancelBuilt.request, { signal: controller.signal });
      setTimeout(() => controller.abort(), 30);
      const cancelled = await pending;
      assert.strictEqual(cancelled.error.code, "cancelled");
      assert.ok(!JSON.stringify(slow.logs).includes(TOKEN));
      hanging.close();
    } finally {
      server.close();
    }
  });

  await test("native coding still runs when no hub is configured", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-gate8-local-"));
    fs.writeFileSync(path.join(directory, "package.json"), '{"name":"local","scripts":{"test":"node test.js"}}\n');
    const host = createWorkspaceHost(directory);
    const model = new ScriptedModelProvider([
      { text: "edit", toolCalls: [{ name: "file.write", args: { path: "note.txt", contents: "hello from the local run\n" } }] },
      { text: "wrote the note" },
    ]);
    const store = new RunStore(path.join(directory, "runs"));
    const run = await startAgentRun({
      goal: "Write note.txt",
      model: "scripted",
      providerName: "scripted",
      provider: model,
      registry: new ToolRegistry(new ControlledToolProvider(host)),
      store,
      capabilities: new ExternalCapabilityProvider(),
      mode: "controlled",
      verify(runState, text) {
        if (runState.filesChanged.includes("note.txt") && text.includes("wrote")) {
          return { status: "passed", summary: "local write verified", evidence: ["file.write"] };
        }
        return { status: "failed", summary: "write missing", evidence: [] };
      },
    }).done;
    assert.strictEqual(run.lifecycle, "completed");
    assert.deepStrictEqual(run.filesChanged, ["note.txt"]);
    assert.strictEqual(fs.readFileSync(path.join(directory, "note.txt"), "utf8"), "hello from the local run\n");
    assert.ok(!model.calls[0].tools.some((tool) => tool.name === "capability.invoke"));
    assert.ok(run.observations.every((item) => item.type === "tool" && item.trusted === true));
    const listed = await new ExternalCapabilityProvider().listCapabilities();
    assert.deepStrictEqual(listed, []);
  });

  await test("the runtime does not name the hub and secrets are not committed", async () => {
    const runtimeDir = path.join(ROOT, "packages/agent-runtime");
    for (const file of fs.readdirSync(runtimeDir)) {
      if (!file.endsWith(".js")) continue;
      const source = fs.readFileSync(path.join(runtimeDir, file), "utf8");
      assert.strictEqual(source.includes("n8n"), false, file);
      assert.strictEqual(source.includes("5678"), false, file);
    }
    const loop = fs.readFileSync(path.join(runtimeDir, "agent-run.js"), "utf8");
    assert.strictEqual(loop.includes("research.problem"), false);
    assert.strictEqual(loop.includes("webhook"), false);
    const adapter = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
    assert.strictEqual(adapter.includes("child_process"), false);
    assert.strictEqual(adapter.includes("writeFile"), false);
    assert.strictEqual(adapter.includes("startAgentRun"), false);
    assert.strictEqual(adapter.includes("agent-run.js"), false);
    const listed = cp.execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n");
    assert.ok(!listed.includes(".env"));
    assert.ok(fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8").includes(".env"));
    const example = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
    assert.ok(example.includes("CODEME_N8N_TOKEN="));
    assert.ok(!example.includes(TOKEN));
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (!full.endsWith("foundation.test.js")) {
          assert.ok(!fs.readFileSync(full, "utf8").includes(TOKEN), full);
        }
      }
    };
    walk(path.join(ROOT, "packages/n8n-capability"));
  });

  if (process.exitCode) process.exit(process.exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
