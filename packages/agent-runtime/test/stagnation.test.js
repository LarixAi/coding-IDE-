const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ModelProvider, RunStore, startAgentRun, ToolRegistry, ControlledToolProvider } = require("../index.js");
const { cycleDetected } = require("../progress");
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

function researchHub(state) {
  return {
    async listCapabilities() {
      return [{ name: "research.problem", description: "Gather short evidence for a problem. Returns sources and excerpts." }];
    },
    async invoke(request) {
      state.invocations += 1;
      return {
        protocolVersion: 1,
        requestId: request.requestId,
        status: "ok",
        data: {
          problem: request.input && request.input.problem,
          confidence: "low",
          evidence: [{ title: "Published rule", url: "https://example.com/rule", excerpt: "double every second digit from the right", source: "test" }],
        },
        sources: [],
        warnings: [],
        error: null,
        duration: 4,
      };
    },
  };
}

function step(text, toolCall) {
  return { usage: { total: 40 }, text, toolCalls: toolCall ? [toolCall] : [] };
}

function loopSteps(count) {
  const search = { name: "repo.search", args: { query: "validNumber" } };
  const read = { name: "file.read", args: { path: "src/check.js" } };
  const steps = [];
  for (let index = 0; index < count; index += 1) {
    const tool = index % 2 === 0 ? search : read;
    const text = index % 2 === 0 ? FIX_TEXT : FIX_AGAIN;
    steps.push(step(text, tool));
  }
  return steps;
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
    maxIterations: options.maxIterations ?? 20,
    maxIdenticalActions: options.maxIdenticalActions ?? 20,
    maxRetries: options.maxRetries ?? 10,
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
  await test("a rolling action cycle is detected", async () => {
    const cycle = ["search:a", "search:b", "read:a", "reason:x"];
    assert.strictEqual(cycleDetected(cycle.concat(cycle)), true);
    assert.strictEqual(cycleDetected(["search:a", "read:b", "write:c"]), false);
  });

  await test("the repeated Luhn reasoning loop escalates once and then stops", async () => {
    const hubState = { invocations: 0 };
    const provider = new ScriptedModelProvider(loopSteps(8));
    const run = await start({ provider, capabilities: researchHub(hubState) }).done;
    const directed = run.toolCalls.find((call) => call.directedBy === "runtime");
    assert.strictEqual(run.lifecycle, "failed");
    assert.strictEqual(run.error.code, "stagnation");
    assert.ok(run.iteration <= 6);
    assert.ok(run.iteration < run.maxIterations);
    assert.strictEqual(directed.iteration, 0);
    assert.ok(run.progress.repeatedIntentCount >= 2);
    assert.strictEqual(hubState.invocations, 1);
    assert.strictEqual(run.progress.researchEscalations, 1);
    assert.ok(directed);
    assert.strictEqual(directed.args.capability, "research.problem");
    assert.strictEqual(directed.result.directedBy, "runtime");
    assert.strictEqual(directed.result.trusted, false);
    assert.ok(run.events.some((event) => event.type === "capability" && event.directedBy === "runtime" && event.trusted === false));
    const toolMessages = run.messages.filter((message) => message.role === "tool");
    const searchMessages = toolMessages.filter((message) => message.name === "repo.search");
    assert.ok(searchMessages.length >= 2);
    assert.ok(searchMessages.slice(0, -1).every((message) => message.compacted === true));
    assert.strictEqual(searchMessages.at(-1).compacted, undefined);
    assert.ok(searchMessages.at(-1).content.includes("matches"));
    const readMessages = toolMessages.filter((message) => message.name === "file.read");
    assert.ok(readMessages.at(-1).content.includes("contents"));
    assert.ok(run.toolCalls.some((call) => call.name === "repo.search" && call.result && call.result.data && call.result.data.matches));
    assert.ok(run.messages.some((message) => message.role === "user" && String(message.content).includes("narrowed the available tools")));
    const consumed = provider.calls.some((call) => call.messages.some((message) => String(message.content).includes("double every second digit from the right")));
    assert.strictEqual(consumed, true);
    assert.strictEqual(run.progress.runtimeDirectedEscalation, true);
    const loop = fs.readFileSync(path.join(__dirname, "../agent-run.js"), "utf8");
    const progress = fs.readFileSync(path.join(__dirname, "../progress.js"), "utf8");
    for (const source of [loop, progress]) {
      assert.strictEqual(source.includes("research.problem"), false);
      assert.strictEqual(source.includes("n8n"), false);
      assert.strictEqual(source.toLowerCase().includes("luhn"), false);
      assert.strictEqual(source.toLowerCase().includes("qwen"), false);
    }
  });

  await test("a repeated read still shows the model the contents", async () => {
    const read = { name: "file.read", args: { path: "src/check.js" } };
    const provider = new ScriptedModelProvider([
      step("Reading the implementation.", read),
      step("Checking the tests.", { name: "file.read", args: { path: "test/check.test.js" } }),
      step("Reading the implementation again before editing.", read),
      step("done"),
    ]);
    const run = await start({ provider, capabilities: researchHub({ invocations: 0 }) }).done;
    const reads = run.messages.filter((message) => message.role === "tool" && message.name === "file.read" && message.observationKey.startsWith("read:src/check.js"));
    assert.strictEqual(reads.length, 2);
    assert.strictEqual(reads[0].compacted, true);
    assert.strictEqual(reads[1].compacted, undefined);
    assert.ok(reads[1].content.includes("validNumber"));
    assert.ok(run.toolCalls.every((call) => call.name !== "file.read" || call.result.data.contents.includes("validNumber")));
  });

  await test("a refused command is not counted as progress", async () => {
    const provider = new ScriptedModelProvider([
      step(FIX_TEXT, { name: "repo.search", args: { query: "validNumber" } }),
      step(FIX_AGAIN, { name: "terminal.run", args: { command: "ls -la" } }),
      step(FIX_TEXT, { name: "terminal.run", args: { command: "cat src/check.js | head" } }),
      step(FIX_AGAIN, { name: "repo.search", args: { query: "validNumber" } }),
      step(FIX_TEXT),
      step(FIX_AGAIN),
    ]);
    const run = await start({ provider, capabilities: researchHub({ invocations: 0 }) }).done;
    const refused = run.toolCalls.filter((call) => call.name === "terminal.run" && call.result.ok === false);
    assert.strictEqual(refused.length, 2);
    assert.ok(run.toolCalls.some((call) => call.directedBy === "runtime" && call.iteration === 0));
  });

  await test("reworded reasoning without any action does not buy more turns", async () => {
    const hubState = { invocations: 0 };
    const provider = new ScriptedModelProvider([
      step("Reading the implementation.", { name: "file.read", args: { path: "src/check.js" } }),
      step("The test is failing on line 4. Let me verify the algorithm implementation."),
      step("Let me analyze the issue more carefully. The current code doubles digits at even indices from the left."),
      step("Let me fix the implementation to double digits at odd positions counted from the right."),
      step("Let me carefully work through the rule once more and then correct the implementation."),
      step("Let me restate the correct procedure before editing."),
    ]);
    const run = await start({ provider, capabilities: researchHub(hubState) }).done;
    const stagnant = run.events.find((event) => event.type === "strategy" && event.to === "stagnant");
    assert.ok(stagnant, "narration must register as stagnation");
    assert.strictEqual(stagnant.iteration, 3);
    assert.strictEqual(hubState.invocations, 1);
    assert.ok(run.toolCalls.some((call) => call.directedBy === "runtime" && call.iteration === 0));
    assert.ok(run.messages.some((message) => message.role === "user" && String(message.content).includes("does not change the file")));
  });

  await test("research evidence must be followed by new progress", async () => {
    const hubState = { invocations: 0 };
    const steps = [
      step("The evidence changes the repair.", { name: "file.write", args: { path: "src/check.js", contents: "module.exports = { validNumber() { return false; } };\n" } }),
      step("repaired after the evidence"),
    ];
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-stagnation-fix-"));
    fs.cpSync(FIXTURE, workspace, { recursive: true });
    const provider = new ScriptedModelProvider(steps);
    const run = await start({
      provider,
      workspace,
      capabilities: researchHub(hubState),
      verify(runState, text) {
        const researched = runState.toolCalls.some((call) => call.directedBy === "runtime" && call.result && call.result.trusted === false);
        const wrote = runState.toolCalls.some((call) => call.name === "file.write" && call.result && call.result.ok && call.directedBy !== "runtime");
        if (researched && wrote && text.includes("repaired")) return { status: "passed", summary: "the repair followed the evidence", evidence: ["file.write"] };
        return { status: "failed", summary: "the repair is not verified", evidence: [] };
      },
    }).done;
    assert.strictEqual(run.lifecycle, "completed");
    assert.strictEqual(run.error, null);
    assert.strictEqual(run.verification.status, "passed");
    assert.strictEqual(hubState.invocations, 1);
    assert.strictEqual(run.progress.researchEscalations, 1);
    assert.ok(provider.calls.some((call) => call.messages.some((message) => String(message.content).includes("double every second digit from the right"))));
  });

  await test("iteration, retry, and cancel protections still stop the run", async () => {
    const hubState = { invocations: 0 };
    const limited = await start({
      provider: new ScriptedModelProvider(Array.from({ length: 6 }, (_, index) => step("", { name: "repo.search", args: { query: `validNumber ${index}` } }))),
      capabilities: { async listCapabilities() { return []; }, async invoke() { return { status: "error" }; } },
      maxIterations: 1,
      maxIdenticalActions: 10,
    }).done;
    assert.strictEqual(limited.outcome.reason, "iteration_limit");

    const missing = { name: "file.read", args: { path: "src/missing.txt" } };
    const retried = await start({
      provider: new ScriptedModelProvider([step("", missing), step("", missing), step("", missing)]),
      capabilities: researchHub(hubState),
      maxRetries: 2,
      maxIdenticalActions: 10,
    }).done;
    assert.strictEqual(retried.outcome.reason, "repeated_action");
    assert.strictEqual(retried.toolCalls.filter((call) => call.name === "file.read").length, 2);

    const cancelling = start({
      provider: new ScriptedModelProvider([{ waitForAbort: true }]),
      capabilities: researchHub(hubState),
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
