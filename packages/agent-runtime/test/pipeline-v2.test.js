const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  ModelProvider,
  RunStore,
  startPipelineRun,
} = require("..");
const { recoverTextToolCalls } = require("../pipeline-loop");

class ScriptedProvider extends ModelProvider {
  constructor(steps) {
    super("scripted-pipeline");
    this.steps = steps.slice();
    this.calls = [];
  }

  async complete(input) {
    this.calls.push(input);
    const step = this.steps.shift();
    if (typeof step === "function") return step(input);
    if (!step) return { text: "Done.", toolCalls: [] };
    return step;
  }
}

class FakeRegistry {
  constructor() {
    this.files = new Map([
      ["README.md", "# Demo\n"],
      ["index.html", "<button>Old</button>\n"],
    ]);
    this.calls = [];
    this.process = { status: "none" };
  }

  definitions() {
    return [
      { name: "workspace.inspect", description: "Inspect workspace", parameters: { type: "object", properties: {}, required: [] } },
      { name: "dir.list", description: "List files", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
      { name: "file.read", description: "Read file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
      { name: "file.write", description: "Write file", parameters: { type: "object", properties: { path: { type: "string" }, contents: { type: "string" } }, required: ["path", "contents"] } },
      { name: "file.patch", description: "Patch file", parameters: { type: "object", properties: { path: { type: "string" }, oldText: { type: "string" }, newText: { type: "string" } }, required: ["path", "oldText", "newText"] } },
      { name: "diagnostics.run", description: "Diagnostics", parameters: { type: "object", properties: {}, required: [] } },
      { name: "git.diff", description: "Git diff", parameters: { type: "object", properties: {}, required: [] } },
      { name: "process.start", description: "Start preview", parameters: { type: "object", properties: { command: { type: "string" }, restart: { type: "boolean" } }, required: [] } },
      { name: "process.status", description: "Process status", parameters: { type: "object", properties: {}, required: [] } },
      { name: "process.logs", description: "Process logs", parameters: { type: "object", properties: {}, required: [] } },
      { name: "browser.check", description: "Browser check", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
      { name: "browser.interact", description: "Browser interact", parameters: { type: "object", properties: { url: { type: "string" }, action: { type: "string" } }, required: ["url", "action"] } },
    ];
  }

  async call(name, args) {
    this.calls.push({ name, args });
    if (name === "workspace.inspect") {
      return {
        ok: true,
        tool: name,
        data: {
          state: "project",
          root: "fixture",
          projectMarkers: ["index.html"],
          languages: ["HTML"],
          frameworks: [],
          packageManager: "",
          scripts: {},
          git: true,
        },
      };
    }
    if (name === "dir.list") {
      return {
        ok: true,
        tool: name,
        data: {
          entries: [...this.files.keys()].map((file) => ({ path: file, type: "file" })),
        },
      };
    }
    if (name === "file.read") {
      if (!this.files.has(args.path)) {
        return { ok: false, tool: name, error: { code: "not_found", message: "File not found" } };
      }
      return { ok: true, tool: name, data: { path: args.path, contents: this.files.get(args.path) } };
    }
    if (name === "file.write") {
      this.files.set(args.path, args.contents);
      return { ok: true, tool: name, data: { path: args.path, bytes: args.contents.length } };
    }
    if (name === "file.patch") {
      const current = this.files.get(args.path);
      if (typeof current !== "string" || !current.includes(args.oldText)) {
        return { ok: false, tool: name, error: { code: "patch_not_found", message: "oldText not found" } };
      }
      this.files.set(args.path, current.replace(args.oldText, args.newText));
      return { ok: true, tool: name, data: { path: args.path } };
    }
    if (name === "diagnostics.run") {
      return { ok: true, tool: name, data: { items: [] } };
    }
    if (name === "git.diff") {
      return { ok: true, tool: name, data: { diff: "diff --git a/index.html b/index.html\n+changed\n" } };
    }
    if (name === "process.status") {
      return { ok: true, tool: name, data: { ...this.process } };
    }
    if (name === "process.start") {
      this.process = { status: "running", origin: "http://127.0.0.1:4173/" };
      return { ok: true, tool: name, data: { ...this.process, started: true } };
    }
    if (name === "process.logs") {
      return { ok: true, tool: name, data: { output: "Listening on http://127.0.0.1:4173/" } };
    }
    if (name === "browser.check") {
      return { ok: true, tool: name, data: { url: args.url, statusCode: 200, available: true } };
    }
    if (name === "browser.interact") {
      return { ok: true, tool: name, data: { url: args.url, afterText: "It works!", matched: true } };
    }
    return { ok: false, tool: name, error: { code: "unknown_tool", message: name } };
  }
}

function storeFor(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-pipeline-v2-" + label + "-"));
  return new RunStore(path.join(dir, "runs"));
}

async function testAskLoop() {
  const registry = new FakeRegistry();
  const provider = new ScriptedProvider([
    { text: "", toolCalls: [{ name: "file.read", args: { path: "README.md" } }] },
    { text: "The README says Demo.", toolCalls: [] },
  ]);
  const handle = startPipelineRun({
    goal: "What does the README say?",
    model: "fixture",
    providerName: "fixture-local",
    provider,
    registry,
    store: storeFor("ask"),
    mode: "read_only",
    composerMode: "ask",
    maxIterations: 6,
  });
  const run = await handle.done;
  assert.strictEqual(run.lifecycle, "completed");
  assert.strictEqual(run.pipelineVersion, 2);
  assert.ok(run.toolCalls.some((call) => call.name === "file.read" && call.result.ok));
  assert.strictEqual(run.outcome.summary, "The README says Demo.");
  assert.ok(provider.calls[0].tools.some((tool) => tool.name === "file.read"));
  assert.ok(provider.calls[0].tools.every((tool) => tool.name !== "file.write"));
}

async function testVerificationRepair() {
  const registry = new FakeRegistry();
  const provider = new ScriptedProvider([
    {
      text: "",
      toolCalls: [{
        name: "file.write",
        args: { path: "index.html", contents: "<button id=\\\"demo\\\">Click Me</button>\n" },
      }],
    },
    { text: "Updated the button.", toolCalls: [] },
    { text: "", toolCalls: [{ name: "process.start", args: {} }] },
    { text: "", toolCalls: [{ name: "browser.interact", args: { url: "http://127.0.0.1:4173/", action: "click", targetText: "Click Me", expectedText: "It works!" } }] },
    { text: "Updated and verified the button.", toolCalls: [] },
  ]);
  const handle = startPipelineRun({
    goal: "Fix the website button so clicking Click Me changes it to It works! and verify the real browser interaction.",
    model: "fixture",
    providerName: "fixture-local",
    provider,
    registry,
    store: storeFor("repair"),
    mode: "controlled",
    composerMode: "code",
    maxIterations: 10,
  });
  const run = await handle.done;
  assert.strictEqual(run.lifecycle, "completed");
  assert.strictEqual(run.verification.status, "passed");
  assert.ok(run.repairs.some((item) => item.reason === "verification_failed"));
  assert.ok(run.toolCalls.some((call) => call.name === "browser.interact" && call.result.ok));
  assert.ok(run.verification.evidence.includes("browser.interact"));
  assert.ok(provider.calls.some((call) => call.messages.some((message) => /VERIFICATION FAILED/.test(String(message.content || "")))));
  assert.ok(provider.calls.some((call) => call.messages.some((message) => /next turn must issue the native tool call now/i.test(String(message.content || "")))));
  for (const call of provider.calls) {
    const offered = new Set(call.tools.map((tool) => tool.name));
    assert.ok(offered.has("file.write"), "write tool should remain offered");
    assert.ok(offered.has("process.logs"), "process logs should remain offered");
    assert.ok(offered.has("browser.interact"), "browser interaction should remain offered");
  }
}


async function testExternalToolsStayVisibleAndUntrusted() {
  const registry = new FakeRegistry();
  const externalTools = {
    calls: [],
    async listTools() {
      return [{
        name: "external_lookup",
        description: "Read-only external evidence",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      }];
    },
    async call(name, args) {
      this.calls.push({ name, args });
      return {
        ok: true,
        tool: name,
        trusted: false,
        data: { output: "external answer for " + args.query },
      };
    },
  };
  const provider = new ScriptedProvider([
    (input) => {
      const system = input.messages.map((message) => String(message.content || "")).join("\n");
      assert.match(system, /Do not merely say that you will use a tool/i);
      assert.ok(input.tools.some((tool) => tool.name === "external_lookup"));
      return {
        text: "",
        toolCalls: [{ name: "external_lookup", args: { query: "current docs" } }],
      };
    },
    (input) => {
      assert.ok(input.messages.some((message) => (
        message.role === "tool"
        && message.name === "external_lookup"
        && String(message.content || "").includes("external answer for current docs")
      )));
      return { text: "I checked the external evidence.", toolCalls: [] };
    },
  ]);

  const run = await startPipelineRun({
    goal: "Check the external docs and report back.",
    model: "fixture",
    providerName: "fixture-local",
    provider,
    registry,
    externalTools,
    store: storeFor("external-tools"),
    mode: "read_only",
    composerMode: "ask",
    maxIterations: 5,
  }).done;

  assert.strictEqual(run.lifecycle, "completed");
  assert.strictEqual(externalTools.calls.length, 1);
  const observation = run.observations.find((item) => item.tool === "external_lookup");
  assert.ok(observation);
  assert.strictEqual(observation.trusted, false);
  assert.deepStrictEqual(run.filesChanged, []);
}

async function testLiveFollowUp() {
  const registry = new FakeRegistry();
  const provider = new ScriptedProvider([
    (input) => {
      const text = input.messages.map((message) => String(message.content || "")).join("\n");
      assert.match(text, /also mention the project name/i);
      return { text: "Demo is the project name.", toolCalls: [] };
    },
  ]);
  const handle = startPipelineRun({
    goal: "Give me a short answer.",
    model: "fixture",
    providerName: "fixture-local",
    provider,
    registry,
    store: storeFor("follow-up"),
    mode: "read_only",
    composerMode: "ask",
    maxIterations: 4,
  });
  handle.followUp("Also mention the project name.");
  const run = await handle.done;
  assert.strictEqual(run.lifecycle, "completed");
  assert.ok(run.followUps.some((item) => /project name/i.test(item.text)));
  assert.ok(run.requirements.some((item) => /project name/i.test(item.text)));
}

function testProviderStyleToolRecovery() {
  const calls = recoverTextToolCalls(
    '<tool_call>{"name":"file_write","arguments":{"path":"index.html","content":"ok"}}</tool_call>',
    new Set(["file.write"]),
  );
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].name, "file.write");
  assert.strictEqual(calls[0].args.path, "index.html");
  console.log("ok provider-style qwen tool names");
}

async function main() {
  testProviderStyleToolRecovery();
  await testAskLoop();
  await testVerificationRepair();
  await testExternalToolsStayVisibleAndUntrusted();
  await testLiveFollowUp();
  console.log("ok pipeline v2 cursor-style loop");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
