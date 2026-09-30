const assert = require("assert");
const { TerminalObserver, redactSecrets } = require("../terminal-observer");
const { ExternalToolRouter } = require("../external-tool-router");

function emitter() {
  const listeners = new Set();
  return {
    event(listener) {
      listeners.add(listener);
      return { dispose() { listeners.delete(listener); } };
    },
    fire(value) {
      for (const listener of [...listeners]) listener(value);
    },
    size() { return listeners.size; },
  };
}

function fakeVscode() {
  const started = emitter();
  const ended = emitter();
  return {
    api: {
      window: {
        onDidStartTerminalShellExecution: (listener) => started.event(listener),
        onDidEndTerminalShellExecution: (listener) => ended.event(listener),
      },
      workspace: {
        workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
      },
    },
    started,
    ended,
  };
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function main() {
  const secret = "sk-proj-abcdefghijklmnopqrstuvwxyz";
  const fake = fakeVscode();
  let clock = 0;
  const observer = new TerminalObserver(fake.api, {
    now: () => "2026-09-30T18:00:0" + clock++ + "Z",
  }).start();

  assert.strictEqual(fake.started.size(), 1);
  assert.strictEqual(fake.ended.size(), 1);

  const execution = {
    cwd: { fsPath: "/workspace/app" },
    commandLine: {
      value: "OPENAI_API_KEY=" + secret + " npm test",
      confidence: 2,
      isTrusted: true,
    },
    read() {
      return (async function* stream() {
        yield "\u001b[31mError: test failed\u001b[0m\r\n";
        yield "Authorization: Bearer abcdefghijklmnopqrstuvwxyz\n";
        yield "OPENAI_API_KEY=" + secret + "\n";
        yield "src/app.js:12 expected true but got false\n";
      }());
    },
  };

  fake.started.fire({ terminal: { name: "zsh" }, execution });
  await tick();
  fake.ended.fire({ terminal: { name: "zsh" }, execution, exitCode: 1 });
  await tick();

  const last = await observer.call("terminal.last", {});
  assert.strictEqual(last.ok, true);
  assert.strictEqual(last.data.status, "failed");
  assert.strictEqual(last.data.exitCode, 1);
  assert.strictEqual(last.data.cwd, "app");
  assert.strictEqual(last.data.commandTrusted, true);
  assert.ok(last.data.command.includes("[REDACTED]"));
  assert.ok(!JSON.stringify(last).includes(secret));
  assert.ok(last.data.output.includes("Error: test failed"));
  assert.ok(last.data.output.includes("src/app.js:12"));
  assert.ok(!last.data.output.includes("abcdefghijklmnopqrstuvwxyz"));
  assert.ok(!last.data.output.includes("\u001b[31m"));

  const failures = await observer.call("terminal.failures", { limit: 5 });
  assert.strictEqual(failures.ok, true);
  assert.strictEqual(failures.data.count, 1);

  const bundle = await observer.call("terminal.debug_bundle", {});
  assert.strictEqual(bundle.ok, true);
  assert.strictEqual(bundle.data.safeForExternalResearch, true);
  assert.ok(bundle.data.debugText.includes("CodeMe integrated-terminal failure"));
  assert.ok(bundle.data.debugText.includes("src/app.js:12"));
  assert.ok(!bundle.data.debugText.includes(secret));

  const definitions = observer.listTools();
  assert.deepStrictEqual(
    definitions.map((item) => item.name),
    ["terminal.last", "terminal.failures", "terminal.debug_bundle"],
  );

  const local = {
    async listTools() {
      return [{ name: "local.tool", description: "local", parameters: { type: "object", properties: {} } }];
    },
    async call(name) {
      return { ok: true, tool: name, data: { source: "local" } };
    },
  };
  const unavailable = {
    async listTools() {
      throw new Error("n8n offline");
    },
    async call() {
      throw new Error("should not run");
    },
  };

  const resilientRouter = new ExternalToolRouter([local, unavailable]);
  const resilientTools = await resilientRouter.listTools();
  assert.deepStrictEqual(resilientTools.map((item) => item.name), ["local.tool"]);
  const localResult = await resilientRouter.call("local.tool", {});
  assert.strictEqual(localResult.ok, true);
  assert.strictEqual(localResult.data.source, "local");
  assert.deepStrictEqual(resilientRouter.errors, ["n8n offline"]);

  const remote = {
    async listTools() {
      return [{ name: "mcp_n8n_research_problem", description: "research", parameters: { type: "object", properties: {} } }];
    },
    async call(name, args) {
      return { ok: true, tool: name, trusted: false, data: { args } };
    },
  };
  const router = new ExternalToolRouter([observer, remote]);
  const tools = await router.listTools();
  assert.ok(tools.some((item) => item.name === "terminal.debug_bundle"));
  assert.ok(tools.some((item) => item.name === "mcp_n8n_research_problem"));
  const routed = await router.call("mcp_n8n_research_problem", { problem: bundle.data.debugText });
  assert.strictEqual(routed.ok, true);
  assert.strictEqual(routed.data.args.problem, bundle.data.debugText);

  assert.ok(redactSecrets("token=super-secret").includes("[REDACTED]"));

  observer.dispose();
  assert.strictEqual(fake.started.size(), 0);
  assert.strictEqual(fake.ended.size(), 0);

  console.log("terminal observation and external tool routing passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
