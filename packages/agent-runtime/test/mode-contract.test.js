const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ModelProvider, RunStore, startAgentRun } = require("..");
const { resolveRuleDecision } = require("../rule-decision");

class CaptureModel extends ModelProvider {
  constructor(responses) {
    super("capture");
    this.responses = responses.slice();
    this.calls = [];
  }

  async complete(input) {
    this.calls.push({
      tools: (input.tools || []).map((tool) => tool.name),
      messages: (input.messages || []).map((message) => ({ role: message.role, content: message.content })),
    });
    return this.responses.shift() || { text: "Done.", toolCalls: [] };
  }
}

class FakeRegistry {
  constructor() {
    this.calls = [];
  }

  definitions() {
    return [
      { name: "workspace.inspect", description: "inspect", parameters: { type: "object", properties: {} } },
      { name: "file.read", description: "read", parameters: { type: "object", properties: {} } },
      { name: "file.write", description: "write", parameters: { type: "object", properties: {} } },
      { name: "terminal.run", description: "terminal", parameters: { type: "object", properties: {} } },
      { name: "browser.check", description: "browser", parameters: { type: "object", properties: {} } },
      { name: "dir.list", description: "list", parameters: { type: "object", properties: {} } },
    ];
  }

  async call(name) {
    this.calls.push(name);
    if (name === "workspace.inspect") {
      return {
        ok: true,
        tool: name,
        data: {
          state: "project",
          root: "fixture",
          projectMarkers: ["package.json"],
          languages: ["JavaScript"],
          frameworks: [],
          packageManager: "npm",
          scripts: {},
          git: false,
        },
      };
    }
    return { ok: true, tool: name, data: {} };
  }
}

async function runChatContract() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-mode-chat-"));
  const store = new RunStore(path.join(dir, "runs"));
  const registry = new FakeRegistry();
  const model = new CaptureModel([{ text: "Hello from chat.", toolCalls: [] }]);

  const run = await startAgentRun({
    goal: "Read server.js and tell me what it does. Do not change anything.",
    model: "fixture",
    providerName: "capture",
    provider: model,
    registry,
    store,
    mode: "chat_only",
    composerMode: "chat",
    taskClass: "chat",
    maxIterations: 2,
  }).done;

  assert.strictEqual(run.lifecycle, "completed");
  assert.strictEqual(run.mode, "chat_only", "A no-edit directive must not turn Chat into read-only workspace mode");
  assert.strictEqual(run.requestedMode, "chat_only");
  assert.strictEqual(run.taskClass, "chat");
  assert.deepStrictEqual(registry.calls, [], "Chat must not auto-inspect or call workspace tools");
  assert.deepStrictEqual(model.calls[0].tools, [], "Chat must expose zero tools");
  assert.ok(model.calls[0].messages[0].content.includes("Chat mode"));
  assert.ok(model.calls[0].messages[0].content.includes("CodeMe canonical gate contract v1"));
  assert.ok(model.calls[0].messages[0].content.includes("G11 Autonomous agent hardening"));
  assert.strictEqual(run.filesChanged.length, 0);
}

async function runAskContract() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-mode-ask-"));
  const store = new RunStore(path.join(dir, "runs"));
  const registry = new FakeRegistry();
  const model = new CaptureModel([{ text: "The project contains a JavaScript package.", toolCalls: [] }]);

  const run = await startAgentRun({
    goal: "What kind of project is this?",
    model: "fixture",
    providerName: "capture",
    provider: model,
    registry,
    store,
    mode: "read_only",
    composerMode: "ask",
    maxIterations: 2,
  }).done;

  assert.strictEqual(run.lifecycle, "completed");
  assert.ok(registry.calls.includes("workspace.inspect"), "Ask should be allowed to inspect");
  const offered = new Set(model.calls[0].tools);
  assert.ok(offered.has("file.read"));
  assert.ok(offered.has("dir.list"));
  assert.ok(!offered.has("file.write"));
  assert.ok(!offered.has("terminal.run"));
  assert.ok(!offered.has("browser.check"));
  assert.ok(model.calls[0].messages[0].content.includes("CodeMe canonical gate contract v1"));
  assert.ok(model.calls[0].messages[0].content.includes("CodeMe runtime owns workspace state"));
}

async function runProjectUnderstandingContract() {
  const { isReadAllFilesGoal } = require("../strategy");
  assert.strictEqual(
    isReadAllFilesGoal("Read this project and tell me what it does. Do not change anything."),
    true,
  );
}

async function runPlanContract() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-mode-plan-"));
  const store = new RunStore(path.join(dir, "runs"));
  const registry = new FakeRegistry();
  const model = new CaptureModel([
    { text: "I would update the project.", toolCalls: [] },
    { text: "1. Read the relevant files.\n2. Update the implementation in Code mode.\n3. Run verification and review the diff.", toolCalls: [] },
  ]);

  const run = await startAgentRun({
    goal: "Plan how to improve this project.",
    model: "fixture",
    providerName: "capture",
    provider: model,
    registry,
    store,
    mode: "read_only",
    composerMode: "plan",
    taskClass: "plan",
    maxIterations: 3,
  }).done;

  assert.strictEqual(run.lifecycle, "completed");
  assert.strictEqual(run.taskClass, "plan");
  assert.ok(run.verificationHistory.some((item) => item.status === "failed"), "Plan must reject a prose-only non-sequenced answer");
  const offered = new Set(model.calls[0].tools);
  assert.ok(!offered.has("file.write"));
  assert.ok(!offered.has("terminal.run"));
  assert.ok(!offered.has("browser.check"));
  assert.strictEqual(run.filesChanged.length, 0);
  assert.ok(model.calls[0].messages[0].content.includes("CodeMe canonical gate contract v1"));
}

async function runCodeGateContract() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-mode-code-contract-"));
  const store = new RunStore(path.join(dir, "runs"));
  const registry = new FakeRegistry();
  const model = new CaptureModel([{ text: "The workspace is a JavaScript project.", toolCalls: [] }]);

  const run = await startAgentRun({
    goal: "Inspect this project and tell me what it is.",
    model: "fixture",
    providerName: "capture",
    provider: model,
    registry,
    store,
    mode: "controlled",
    composerMode: "code",
    taskClass: "inspect",
    maxIterations: 2,
  }).done;

  assert.strictEqual(run.lifecycle, "completed");
  assert.ok(model.calls[0].messages[0].content.includes("You are a CodeMe agent run with workspace-scoped tools."));
  assert.ok(model.calls[0].messages[0].content.includes("CodeMe canonical gate contract v1"));
  assert.ok(model.calls[0].messages[0].content.includes("G6 Controlled coding"));
  assert.ok(model.calls[0].messages[0].content.includes("G11 Autonomous agent hardening"));
}

function runChatRule() {
  const decision = resolveRuleDecision({
    call: { name: "file.read", args: { path: "README.md" } },
    facts: { mode: "chat_only", registeredToolNames: ["file.read"] },
  });
  assert.strictEqual(decision.action, "deny");
  assert.strictEqual(decision.code, "chat_mode_tool_denied");
  assert.strictEqual(decision.rule, "safety.chat_only");
}

async function main() {
  await runChatContract();
  await runAskContract();
  await runProjectUnderstandingContract();
  await runPlanContract();
  await runCodeGateContract();
  runChatRule();
  console.log("mode contracts passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
