const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ModelProvider, RunStore, startAgentRun, ToolRegistry, ControlledToolProvider } = require("../index.js");
const { createWorkspaceHost } = require("../../coding-qualify/host");

const FIXTURE = path.join(__dirname, "../../research-qualify/fixture");
const FIX_TEXT = "I need to fix the implementation. The standard Luhn algorithm doubles every second digit starting from the rightmost digit.";
const FIX_AGAIN = "I need to fix the implementation. The standard Luhn algorithm doubles every second digit starting from the right.";

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
    return { text: step.text || "", toolCalls: step.toolCalls || [], usage: step.usage || null };
  }
}

function researchHub() {
  return {
    async listCapabilities() {
      return [{ name: "research.problem", description: "Gather short evidence for a problem. Returns sources and excerpts." }];
    },
    async invoke(request) {
      return {
        protocolVersion: 1,
        requestId: request.requestId,
        status: "ok",
        data: {
          problem: request.input && request.input.problem,
          confidence: "low",
          likely_cause: null,
          recommended_fix: null,
          evidence: [{ title: "Luhn algorithm", url: "https://example.com/luhn", excerpt: "double every second digit from the right", source: "test" }],
        },
        sources: [],
        warnings: [],
        error: null,
        duration: 4,
      };
    },
  };
}

function stallSteps() {
  const usage = { total: 100 };
  const search = { name: "repo.search", args: { query: "validNumber" } };
  const read = { name: "file.read", args: { path: "src/check.js" } };
  return [
    { usage, toolCalls: [search] },
    { usage, toolCalls: [read] },
    { usage, toolCalls: [{ name: "repo.search", args: { query: "validNumber check" } }] },
    { usage, toolCalls: [read] },
    { usage, toolCalls: [{ name: "repo.search", args: { query: "validNumber algorithm" } }] },
    { usage, text: FIX_TEXT },
    { usage, text: FIX_AGAIN },
    { usage, text: FIX_TEXT },
  ];
}

function start(options) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-stagnation-"));
  const store = new RunStore(path.join(directory, "runs"));
  return startAgentRun({
    goal: "Repair the identification-number check. The doubling rule is not in the repository.",
    model: "scripted",
    providerName: "scripted",
    mode: "controlled",
    provider: options.provider,
    registry: new ToolRegistry(new ControlledToolProvider(createWorkspaceHost(options.workspace || FIXTURE))),
    store,
    capabilities: options.capabilities,
    maxIterations: options.maxIterations ?? 30,
    maxIdenticalActions: options.maxIdenticalActions ?? 20,
    maxRetries: options.maxRetries ?? 10,
    stagnationThreshold: options.stagnationThreshold,
    stagnationBudget: options.stagnationBudget,
    verify: options.verify || (() => ({ status: "failed", summary: "the check is still wrong", evidence: [] })),
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
  await test("the Luhn stall is detected and cannot continue", async () => {
    const provider = new ScriptedModelProvider(stallSteps());
    const run = await start({ provider, capabilities: researchHub() }).done;
    assert.strictEqual(run.lifecycle, "failed");
    assert.strictEqual(run.error.code, "stagnation");
    assert.ok(run.iteration < 12);
    assert.ok(run.iteration < run.maxIterations);
    assert.strictEqual(run.progress.filesRead.length, 1);
    assert.ok(run.progress.filesDiscovered.includes("src/check.js"));
    assert.strictEqual(run.progress.progressScore, run.progress.filesDiscovered.length + run.progress.filesRead.length);
    assert.ok(run.progress.repeatedIntentCount >= 1);
    assert.ok(run.progress.stagnantTurns >= run.progress.threshold);
    const detected = run.events.find((event) => event.type === "stagnation_detected");
    assert.ok(detected);
    assert.ok(detected.iteration <= 6);
    assert.strictEqual(detected.capability, "research.problem");
    assert.strictEqual(run.progress.researchEscalations, 1);
    assert.strictEqual(run.progress.modelTurnsBeforeEscalation, detected.iteration);
    assert.strictEqual(run.progress.tokensBeforeEscalation, detected.iteration * 100);
    assert.ok(run.messages.some((message) => message.role === "user" && message.content.includes("research.problem") && message.content.includes("untrusted evidence")));
    assert.ok(!run.toolCalls.some((call) => call.name === "capability.invoke"));
    const policy = run.events.find((event) => event.type === "escalation_policy");
    assert.ok(policy);
    assert.strictEqual(policy.runtimeDirectedEscalation, false);
    assert.strictEqual(run.progress.runtimeDirectedEscalation, false);
    assert.strictEqual(run.progress.escalationAcceptedBy, null);
    const loop = fs.readFileSync(path.join(__dirname, "../agent-run.js"), "utf8");
    assert.strictEqual(loop.includes("research.problem"), false);
  });

  await test("a model-selected research call is the only escalation that runs", async () => {
    const usage = { total: 20 };
    const steps = stallSteps().slice(0, 6);
    steps.push({
      usage,
      toolCalls: [{ name: "capability.invoke", args: { capability: "research.problem", input: { problem: "Luhn algorithm which digits are doubled" } } }],
    });
    steps.push({
      usage,
      toolCalls: [{ name: "file.write", args: { path: "src/check.js", contents: "module.exports = { validNumber() { return false; } };\n" } }],
    });
    steps.push({ usage, text: "repaired from the evidence" });
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-stagnation-fix-"));
    fs.cpSync(FIXTURE, workspace, { recursive: true });
    const provider = new ScriptedModelProvider(steps);
    const run = await start({
      provider,
      workspace,
      capabilities: researchHub(),
      verify(runState, text) {
        const researched = runState.toolCalls.some((call) => call.name === "capability.invoke" && call.result && call.result.ok && call.result.trusted === false);
        const wrote = runState.toolCalls.some((call) => call.name === "file.write" && call.result && call.result.ok);
        if (researched && wrote && text.includes("repaired")) return { status: "passed", summary: "model used the evidence", evidence: ["capability.invoke"] };
        return { status: "failed", summary: "still stalled", evidence: [] };
      },
    }).done;
    assert.strictEqual(run.lifecycle, "completed");
    assert.strictEqual(run.error, null);
    assert.strictEqual(run.progress.escalationAcceptedBy, "model");
    assert.strictEqual(run.progress.runtimeDirectedEscalation, false);
    assert.ok(!run.events.some((event) => event.type === "escalation_policy"));
    assert.ok(run.observations.some((item) => item.type === "capability" && item.trusted === false && item.capability === "research.problem"));
    assert.ok(run.progress.stagnantTurns < run.progress.budget);
  });

  await test("iteration, retry, and cancel protections still stop the run", async () => {
    const limited = await start({
      provider: new ScriptedModelProvider(Array.from({ length: 6 }, (_, index) => ({ toolCalls: [{ name: "repo.search", args: { query: `validNumber ${index}` } }] }))),
      capabilities: researchHub(),
      maxIterations: 3,
      maxIdenticalActions: 10,
    }).done;
    assert.strictEqual(limited.outcome.reason, "iteration_limit");

    const missing = { name: "file.read", args: { path: "src/missing.txt" } };
    const retried = await start({
      provider: new ScriptedModelProvider([{ toolCalls: [missing] }, { toolCalls: [missing] }, { toolCalls: [missing] }]),
      capabilities: researchHub(),
      maxRetries: 2,
      maxIdenticalActions: 10,
    }).done;
    assert.strictEqual(retried.outcome.reason, "repeated_action");
    assert.strictEqual(retried.toolCalls.length, 2);

    const cancelling = start({
      provider: new ScriptedModelProvider([{ waitForAbort: true }]),
      capabilities: researchHub(),
    });
    cancelling.cancel();
    const cancelled = await cancelling.done;
    assert.strictEqual(cancelled.lifecycle, "cancelled");
    assert.strictEqual(cancelled.toolCalls.length, 0);
  });

  if (process.exitCode) process.exit(process.exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
