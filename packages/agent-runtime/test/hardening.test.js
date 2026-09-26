const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ModelProvider, RunStore, startAgentRun, createRun, ToolRegistry, ControlledToolProvider, lockModel, classifyTask, selectStrategy, diagnose } = require("../index.js");
const { createWorkspaceHost } = require("../../coding-qualify/host");

const FIXTURE = path.join(__dirname, "../../coding-qualify/fixture");

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

function start(options) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-hardening-"));
  const workspace = options.workspace || FIXTURE;
  const store = new RunStore(path.join(directory, "runs"));
  const handle = startAgentRun({
    goal: options.goal || "Inspect the repository.",
    model: options.model || "scripted",
    fallbackModel: options.fallbackModel,
    modelProfiles: options.modelProfiles,
    providerName: "scripted",
    mode: options.mode || "read_only",
    inferRequirements: options.inferRequirements,
    requirements: options.requirements,
    provider: options.provider,
    registry: options.registry || new ToolRegistry(new ControlledToolProvider(createWorkspaceHost(workspace))),
    store,
    maxIterations: options.maxIterations ?? 12,
    verify: options.verify,
    capabilities: options.capabilities,
  });
  handle.store = store;
  return handle;
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
  await test("the effective model is locked and a fallback is explicit", async () => {
    const selected = lockModel({
      model: "chat-only",
      fallbackModel: "tool-model",
      modelProfiles: {
        "chat-only": { supportsTools: false },
        "tool-model": { supportsTools: true },
      },
    });
    assert.strictEqual(selected.ok, true);
    assert.strictEqual(selected.requestedModel, "chat-only");
    assert.strictEqual(selected.effectiveModel, "tool-model");
    assert.strictEqual(selected.persistentSelection, "chat-only");
    assert.strictEqual(selected.fallback.from, "chat-only");

    const failed = lockModel({
      model: "chat-only",
      modelProfiles: { "chat-only": { supportsTools: false } },
    });
    assert.strictEqual(failed.ok, false);
    assert.strictEqual(failed.code, "model_not_capable");

    const provider = new ScriptedModelProvider([{ text: "observed", toolCalls: [{ name: "file.read", args: { path: "README.md" } }] }, { text: "readme seen" }]);
    const handle = start({
      provider,
      model: "chat-only",
      fallbackModel: "tool-model",
      modelProfiles: {
        "chat-only": { supportsTools: false },
        "tool-model": { supportsTools: true },
      },
    });
    const run = await handle.done;
    assert.strictEqual(run.requestedModel, "chat-only");
    assert.strictEqual(run.effectiveModel, "tool-model");
    assert.strictEqual(run.persistentSelection, "chat-only");
    assert.ok(provider.calls.every((call) => call.model === "tool-model"));
  });

  await test("strategy selection is deterministic and versioned", async () => {
    assert.strictEqual(classifyTask("find the badge", { mode: "read_only" }), "inspect");
    assert.strictEqual(classifyTask("Fix the failing identification check", { mode: "controlled" }), "bug-fix");
    assert.strictEqual(classifyTask("Add registration", { requirements: [{ id: "a" }, { id: "b" }, { id: "c" }] }), "feature");
    const strategy = selectStrategy("Fix the failing test", { mode: "controlled" });
    assert.strictEqual(strategy.id, "bug-fix");
    assert.strictEqual(strategy.version, 1);
    const run = createRun({ goal: "Fix the failing greet test", model: "scripted", providerName: "scripted", mode: "controlled" });
    assert.strictEqual(run.taskClass, "bug-fix");
    assert.strictEqual(run.strategyRecord.version, 1);
  });

  await test("a follow-up updates requirements and forces a re-plan", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-hardening-follow-"));
    fs.cpSync(FIXTURE, workspace, { recursive: true });
    const provider = new ScriptedModelProvider([
      { text: "reading", toolCalls: [{ name: "file.read", args: { path: "src/greet.js" } }] },
      { text: "writing", toolCalls: [{ name: "file.write", args: { path: "src/greet.js", contents: "module.exports = { greet(name) { return `Hello, ${name}`; } };\n" } }] },
      { text: "testing", toolCalls: [{ name: "tests.run", args: { command: "npm test" } }] },
      { text: "diffing", toolCalls: [{ name: "git.diff", args: {} }] },
      { text: "also wrote the note", toolCalls: [{ name: "file.write", args: { path: "NOTE.md", contents: "follow-up\n" } }] },
      { text: "retest", toolCalls: [{ name: "tests.run", args: { command: "npm test" } }] },
      { text: "rediff", toolCalls: [{ name: "git.diff", args: {} }] },
      { text: "follow-up complete" },
    ]);
    const handle = start({
      workspace,
      provider,
      mode: "controlled",
      inferRequirements: true,
      goal: "Fix the greet helper so the project tests pass.",
      verify(runState, text) {
        const note = runState.requirements.find((item) => item.id === "follow-up-1");
        if (note) note.status = runState.filesChanged.includes("NOTE.md") ? "satisfied" : "unverified";
        const goal = runState.requirements.find((item) => item.id === "goal");
        if (goal) goal.status = runState.filesChanged.includes("src/greet.js") ? "satisfied" : "unverified";
        if (text.includes("follow-up complete") && (!note || note.status === "satisfied")) {
          return { status: "passed", summary: "follow-up verified", evidence: ["NOTE.md"] };
        }
        return { status: "failed", summary: "follow-up still open", evidence: ["follow-up-1"] };
      },
    });
    handle.followUp("Also write NOTE.md recording the repair.");
    const run = await handle.done;
    assert.strictEqual(run.followUps.length, 1);
    assert.ok(run.requirements.some((item) => item.id === "follow-up-1"));
    assert.ok(run.filesChanged.includes("NOTE.md"));
    assert.strictEqual(run.lifecycle, "completed");
    assert.ok(run.strategyRecord.guidance.includes("Reproduce the failure"));
    assert.ok(provider.calls[0].messages.some((message) => String(message.content).includes("Reproduce the failure")));
  });

  await test("a failing test is diagnosed as bad_code before the repair", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-hardening-repair-"));
    fs.cpSync(FIXTURE, workspace, { recursive: true });
    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    };
    require("child_process").execFileSync("git", ["init", "-b", "main"], { cwd: workspace });
    require("child_process").execFileSync("git", ["add", "."], { cwd: workspace });
    require("child_process").execFileSync("git", ["commit", "-m", "fixture"], { cwd: workspace, env: gitEnv, stdio: "ignore" });
    const provider = new ScriptedModelProvider([
      { text: "test", toolCalls: [{ name: "tests.run", args: { command: "npm test" } }] },
      { text: "repair", toolCalls: [{ name: "file.write", args: { path: "src/greet.js", contents: "module.exports = { greet(name) { return `Hello, ${name}`; } };\n" } }] },
      { text: "retest", toolCalls: [{ name: "tests.run", args: { command: "npm test" } }] },
      { text: "diff", toolCalls: [{ name: "git.diff", args: {} }] },
      { text: "repaired" },
    ]);
    const run = await start({
      workspace,
      provider,
      mode: "controlled",
      goal: "Fix the failing greet test.",
    }).done;
    assert.strictEqual(run.lifecycle, "completed");
    assert.ok(run.diagnoses.some((item) => item.class === "bad_code" && item.next === "repair"));
    assert.strictEqual(diagnose({ name: "tests.run" }, { ok: false, error: { code: "exit_status" } }).class, "bad_code");
    assert.strictEqual(run.repairs.length, 1);
    assert.strictEqual(run.verification.status, "passed");
  });

  await test("missing credentials pause the run instead of inventing a secret", async () => {
    const host = createWorkspaceHost(FIXTURE);
    const tools = new ControlledToolProvider(host);
    const registry = new ToolRegistry({
      async call(name, args) {
        if (name === "file.write" && args && args.path === ".env") {
          return { ok: false, tool: name, error: { code: "credentials_required", message: "token missing" } };
        }
        return tools.call(name, args);
      },
      definitions() {
        return tools.definitions();
      },
    });
    const provider = new ScriptedModelProvider([
      { text: "need a token", toolCalls: [{ name: "file.write", args: { path: ".env", contents: "TOKEN=\n" } }] },
      { text: "should not run" },
    ]);
    const run = await start({
      provider,
      registry,
      mode: "controlled",
    }).done;
    assert.strictEqual(run.lifecycle, "awaiting_user");
    assert.strictEqual(run.outcome.reason, "credentials");
    assert.strictEqual(run.decisions.length, 1);
    assert.ok(!run.filesChanged.includes(".env"));
  });

  await test("cancellation is an interruption that does not resume", async () => {
    const provider = new ScriptedModelProvider([{
      waitForAbort: true,
    }]);
    provider.complete = async function complete(input) {
      this.calls.push(input);
      await new Promise((resolve, reject) => {
        const fail = () => reject(Object.assign(new Error("model call cancelled"), { code: "cancelled" }));
        if (input.signal && input.signal.aborted) return fail();
        input.signal.addEventListener("abort", fail);
      });
    };
    const handle = start({ provider, goal: "Inspect the repository." });
    handle.cancel();
    const run = await handle.done;
    assert.strictEqual(run.lifecycle, "cancelled");
    const again = await require("../index.js").resumeRun(run.id, {
      provider,
      registry: new ToolRegistry(new ControlledToolProvider(createWorkspaceHost(FIXTURE))),
      store: handle.store,
    });
    assert.strictEqual(again.lifecycle, "cancelled");
  });

  await test("a write without a later test is not complete", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-hardening-evidence-"));
    fs.cpSync(FIXTURE, workspace, { recursive: true });
    const provider = new ScriptedModelProvider([
      { text: "write", toolCalls: [{ name: "file.write", args: { path: "src/greet.js", contents: "module.exports = { greet() { return \"Hi\"; } };\n" } }] },
      { text: "I am done" },
    ]);
    const run = await start({
      workspace,
      provider,
      mode: "controlled",
      maxIterations: 2,
      goal: "Edit greet.",
    }).done;
    assert.strictEqual(run.lifecycle, "failed");
    assert.ok(run.verification.summary.includes("later passing test"));
  });

  if (process.exitCode) process.exit(process.exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
