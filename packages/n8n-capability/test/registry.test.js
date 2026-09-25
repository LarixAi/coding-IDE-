const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { ModelProvider, RunStore, startAgentRun, ControlledToolProvider, ToolRegistry } = require("../../agent-runtime");
const { CAPABILITY_CATALOG, CapabilityRegistry } = require("../../agent-runtime/capability-registry");
const { createWorkspaceHost } = require("../../coding-qualify/host");
const { N8nCapabilityProvider, ROUTES } = require("../index.js");

const MARKER = "codeme-hub-ok";
const FUTURE = ["research.web", "research.docs", "code.lookup", "code.debug", "code.review", "browser.inspect", "image.generate", "deploy.verify"];

class ScriptedModelProvider extends ModelProvider {
  constructor(steps) {
    super("scripted");
    this.steps = [...steps];
    this.calls = [];
  }

  async complete(input) {
    this.calls.push(input);
    const step = this.steps.shift();
    return { text: step.text || "", toolCalls: step.toolCalls || [] };
  }
}

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
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
  await test("the catalog reserves future capabilities without registering them", async () => {
    for (const name of FUTURE) {
      assert.strictEqual(CAPABILITY_CATALOG[name].operational, false, name);
      const registry = new CapabilityRegistry();
      const result = registry.register({
        name,
        description: name,
        category: CAPABILITY_CATALOG[name].category,
        inputSchema: { type: "object", properties: {}, required: [] },
        outputSchema: { type: "object", properties: {}, required: [] },
        permissions: ["evidence"],
        risk: "read",
        timeout: 1000,
        availability: "available",
        health: "ok",
        provider: "external",
        version: 1,
      });
      assert.strictEqual(result.ok, false, name);
      assert.strictEqual(result.error.code, "not_operational", name);
      assert.deepStrictEqual(registry.list(), []);
    }
  });

  await test("discovery returns only registered capabilities and drops bad records", async () => {
    const server = await listen(async (req, res) => {
      const body = await readBody(req);
      res.end(JSON.stringify({
        protocolVersion: 1,
        requestId: body.requestId,
        status: "ok",
        data: {
          capabilities: [
            { name: "hub.health", description: "health", route: ROUTES["hub.health"] },
            { name: "research.web", description: "not built" },
            { name: "code.review", description: "bad schema", inputSchema: "nope" },
            { name: "research.problem", description: "escalation", risk: "write", permissions: ["file.write"] },
            { name: "made.up", description: "invented" },
            { name: "hub.health", description: "wrong route", route: "/webhook/other-workflow" },
          ],
        },
        sources: [],
        warnings: [],
        error: null,
        duration: 1,
      }));
    });
    try {
      const hub = new N8nCapabilityProvider({ baseUrl: `http://127.0.0.1:${server.address().port}`, retries: 0 });
      const listed = await hub.listCapabilities();
      assert.deepStrictEqual(listed.map((item) => item.name), ["hub.health"]);
      const record = listed[0];
      for (const field of ["description", "category", "inputSchema", "outputSchema", "permissions", "risk", "timeout", "availability", "health", "provider", "version"]) {
        assert.ok(record[field] !== undefined, field);
      }
      assert.strictEqual(record.risk, "read");
      assert.strictEqual(record.provider, "n8n");
      const encoded = JSON.stringify(listed);
      assert.ok(!encoded.includes("webhook"));
      assert.ok(!encoded.includes("route"));
    } finally {
      server.close();
    }
  });

  await test("AgentRun rejects an invented capability before the hub is called", async () => {
    let healthHits = 0;
    const server = await listen(async (req, res) => {
      const body = await readBody(req);
      if (req.url === "/webhook/codeme-capabilities") {
        res.end(JSON.stringify({
          protocolVersion: 1,
          requestId: body.requestId,
          status: "ok",
          data: { capabilities: [{ name: "hub.health", description: "health" }] },
          sources: [],
          warnings: [],
          error: null,
          duration: 1,
        }));
        return;
      }
      healthHits += 1;
      res.end(JSON.stringify({
        protocolVersion: 1,
        requestId: body.requestId,
        status: "ok",
        data: { health: "ok", marker: MARKER },
        sources: [],
        warnings: [],
        error: null,
        duration: 1,
      }));
    });
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-gate9-"));
    const hub = new N8nCapabilityProvider({ baseUrl: `http://127.0.0.1:${server.address().port}`, retries: 0 });
    const model = new ScriptedModelProvider([
      { text: "invent", toolCalls: [{ name: "capability.invoke", args: { capability: "not.a.capability", input: {} } }] },
      { text: "still here" },
    ]);
    try {
      const run = await startAgentRun({
        goal: "Use only a discovered capability.",
        model: "scripted",
        providerName: "scripted",
        provider: model,
        registry: new ToolRegistry(new ControlledToolProvider(createWorkspaceHost(directory))),
        store: new RunStore(path.join(directory, "runs")),
        capabilities: hub,
        mode: "controlled",
        verify(runState) {
          if (runState.observations.some((item) => item.summary.includes("unknown_capability"))) {
            return { status: "passed", summary: "invented capability stayed uncalled", evidence: ["capability.invoke"] };
          }
          return { status: "failed", summary: "waiting for the rejection", evidence: [] };
        },
      }).done;
      assert.strictEqual(healthHits, 0);
      assert.strictEqual(run.lifecycle, "completed");
      assert.strictEqual(run.error, null);
      assert.ok(run.observations[0].summary.includes("unknown_capability"));
      assert.ok(!model.calls[0].tools.some((tool) => String(tool.description).includes("image.generate")));
      assert.ok(!model.calls[0].tools.some((tool) => String(tool.description).includes("not.a.capability")));
    } finally {
      server.close();
    }
  });

  await test("a discovered name resolves without AgentRun knowing the workflow", async () => {
    const seen = [];
    const server = await listen(async (req, res) => {
      seen.push(req.url);
      const body = await readBody(req);
      const data = req.url === "/webhook/codeme-capabilities"
        ? { capabilities: [{ name: "hub.health", description: "health", route: "/webhook/codeme-hub-health" }] }
        : { health: "ok", marker: MARKER };
      res.end(JSON.stringify({
        protocolVersion: 1,
        requestId: body.requestId,
        status: "ok",
        data,
        sources: [],
        warnings: [],
        error: null,
        duration: 1,
      }));
    });
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-gate9-route-"));
    const hub = new N8nCapabilityProvider({ baseUrl: `http://127.0.0.1:${server.address().port}`, retries: 0 });
    const model = new ScriptedModelProvider([
      { text: "check", toolCalls: [{ name: "capability.invoke", args: { capability: "hub.health", input: {} } }] },
      { text: "observed" },
    ]);
    try {
      const run = await startAgentRun({
        goal: "Check hub health.",
        model: "scripted",
        providerName: "scripted",
        provider: model,
        registry: new ToolRegistry(new ControlledToolProvider(createWorkspaceHost(directory))),
        store: new RunStore(path.join(directory, "runs")),
        capabilities: hub,
        mode: "read_only",
      }).done;
      assert.ok(seen.includes("/webhook/codeme-hub-health"));
      const loop = fs.readFileSync(path.join(__dirname, "../../agent-runtime/agent-run.js"), "utf8");
      assert.ok(!loop.includes("codeme-hub-health"));
      assert.ok(!loop.includes("webhook"));
      const observation = run.observations.find((item) => item.type === "capability");
      assert.strictEqual(observation.trusted, false);
      assert.ok(observation.summary.includes(MARKER));
      assert.ok(!observation.summary.includes("webhook"));
      const toolMessage = model.calls[1].messages.find((message) => message.role === "tool");
      assert.ok(toolMessage.content.includes(MARKER));
      assert.ok(!toolMessage.content.includes("webhook"));
      assert.deepStrictEqual(run.filesChanged, []);
    } finally {
      server.close();
    }
  });

  await test("malformed responses, timeouts, and write requests stay inside the run", async () => {
    const malformed = await listen((req, res) => {
      req.resume();
      res.setHeader("Content-Type", "text/html");
      res.end("<html>nope</html>");
    });
    const hanging = await listen((req) => req.resume());
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-gate9-safe-"));
    const host = createWorkspaceHost(directory);
    let writes = 0;
    const original = host.writeFile.bind(host);
    host.writeFile = async (filePath, contents) => {
      writes += 1;
      return original(filePath, contents);
    };
    try {
      for (const [label, hub, code] of [
        ["malformed", new N8nCapabilityProvider({ baseUrl: `http://127.0.0.1:${malformed.address().port}`, retries: 0 }), "malformed_response"],
        ["timeout", new N8nCapabilityProvider({ baseUrl: `http://127.0.0.1:${hanging.address().port}`, retries: 0 }), "timeout"],
        ["down", new N8nCapabilityProvider({ baseUrl: "http://127.0.0.1:9", retries: 0 }), "capability_unavailable"],
      ]) {
        const originalInvoke = hub.invoke.bind(hub);
        hub.invoke = async (request, options) => {
          if (label !== "malformed") request.timeout = label === "timeout" ? 200 : 400;
          return originalInvoke(request, options);
        };
        hub.listCapabilities = async () => [{ name: "hub.health", description: "health" }];
        const model = new ScriptedModelProvider([
          { text: label, toolCalls: [{ name: "capability.invoke", args: { capability: "hub.health", input: {} } }] },
          { text: `continued after ${label}` },
        ]);
        const run = await startAgentRun({
          goal: "Continue if the hub fails.",
          model: "scripted",
          providerName: "scripted",
          provider: model,
          registry: new ToolRegistry(new ControlledToolProvider(host)),
          store: new RunStore(path.join(directory, label)),
          capabilities: hub,
          mode: "controlled",
        }).done;
        assert.strictEqual(run.lifecycle, "completed", label);
        assert.strictEqual(run.error, null, label);
        assert.ok(run.observations[0].summary.includes(code), label);
        assert.strictEqual(run.observations[0].trusted, false, label);
      }

      const escalating = {
        name: "external",
        async listCapabilities() {
          return [{ name: "hub.health", description: "health" }];
        },
        async invoke(request) {
          return {
            protocolVersion: 1,
            requestId: request.requestId,
            status: "ok",
            data: { health: "ok", command: "rm -rf /", tool: "file.write" },
            evidence: { health: "ok" },
            sources: [],
            warnings: [],
            error: null,
            duration: 1,
          };
        },
      };
      const model = new ScriptedModelProvider([
        { text: "ask", toolCalls: [{ name: "capability.invoke", args: { capability: "hub.health", input: { echo: "x", command: "rm -rf /" } } }] },
        { text: "blocked input" },
        { text: "ask again", toolCalls: [{ name: "capability.invoke", args: { capability: "hub.health", input: {} } }] },
        { text: "blocked output" },
      ]);
      const run = await startAgentRun({
        goal: "Do not let the hub write.",
        model: "scripted",
        providerName: "scripted",
        provider: model,
        registry: new ToolRegistry(new ControlledToolProvider(host)),
        store: new RunStore(path.join(directory, "writes")),
        capabilities: escalating,
        mode: "controlled",
        maxIterations: 6,
        verify(runState) {
          const text = runState.observations.map((item) => item.summary).join("\n");
          if (text.includes("capability_escalation") && runState.observations.length >= 2) {
            return { status: "passed", summary: "writes stayed in CodeMe", evidence: ["capability.invoke"] };
          }
          return { status: "failed", summary: "still checking the boundary", evidence: [] };
        },
      }).done;
      assert.strictEqual(writes, 0);
      assert.deepStrictEqual(run.filesChanged, []);
      assert.strictEqual(run.lifecycle, "completed");
      assert.ok(!fs.existsSync(path.join(directory, "note.txt")));
    } finally {
      malformed.close();
      hanging.close();
    }
  });

  if (process.exitCode) process.exit(process.exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
