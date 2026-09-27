const crypto = require("crypto");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const { ModelProvider, OllamaModelProvider, ControlledToolProvider, ToolRegistry, ExternalCapabilityProvider, RunStore, startAgentRun } = require("../agent-runtime");
const { CAPABILITY_CATALOG } = require("../agent-runtime/capability-registry");
const { createWorkspaceHost } = require("../coding-qualify/host");
const { N8nCapabilityProvider } = require("../n8n-capability");
const { REQUIREMENTS } = require("./acceptance");
const { localComplete, workspaceChanges } = require("./verify");
const { GOAL } = require("./goal");

const FIXTURE = path.join(__dirname, "fixture");
const REPO = path.resolve(__dirname, "../..");
const MODEL = process.env.CODEME_QWEN_MODEL || "qwen3.5:9b";
const OLLAMA = process.env.CODEME_OLLAMA_URL || "http://127.0.0.1:11434";
const OPERATIONAL = ["hub.health", "knowledge.lookup", "research.problem", "task.decompose"];
const RESERVED_OFF = Object.entries(CAPABILITY_CATALOG).filter(([, record]) => record.operational === false).map(([name]) => name);

class RecordingModelProvider extends ModelProvider {
  constructor(inner) {
    super(inner.name);
    this.inner = inner;
    this.calls = [];
  }

  async complete(input) {
    this.calls.push({ messages: input.messages, tools: input.tools });
    const decision = await this.inner.complete(input);
    const names = (decision.toolCalls || []).map((call) => {
      if (call.name === "capability.invoke") return `capability.invoke ${call.args && call.args.capability}`;
      if (call.args && call.args.path) return `${call.name} ${call.args.path}`;
      if (call.args && call.args.command) return `${call.name} ${call.args.command}`;
      return call.name;
    }).join(", ");
    console.error(`decision ${names || (decision.text || "").slice(0, 160)}`);
    return decision;
  }
}

class TracingHub {
  constructor(inner) {
    this.inner = inner;
    this.invocations = [];
  }

  listCapabilities() {
    return this.inner.listCapabilities();
  }

  async invoke(request, options) {
    this.invocations.push({
      capability: request && request.capability,
      contextKeys: request && request.context && typeof request.context === "object" ? Object.keys(request.context) : [],
      inputKeys: request && request.input && typeof request.input === "object" ? Object.keys(request.input) : [],
    });
    return this.inner.invoke(request, options);
  }
}

function prepareWorkspace() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-research-"));
  const workspace = path.join(parent, "fixture");
  fs.cpSync(FIXTURE, workspace, { recursive: true });
  const sentinel = path.join(parent, "outside.txt");
  fs.writeFileSync(sentinel, "untouched");
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
  cp.execFileSync("git", ["init", "-b", "main"], { cwd: workspace });
  cp.execFileSync("git", ["add", "."], { cwd: workspace });
  cp.execFileSync("git", ["commit", "-m", "id check"], { cwd: workspace, env: gitEnv, stdio: "ignore" });
  return { workspace, sentinel };
}

function gitStatus(cwd) {
  return cp.execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" });
}

function fileHash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function telemetry(label, record) {
  const run = record.run || {};
  const calls = run.toolCalls || [];
  const lastTest = [...calls].reverse().find((call) => call.name === "tests.run" || (call.name === "terminal.run" && call.args && String(call.args.command || "").includes("test")));
  return {
    label,
    outcome: run.lifecycle || "missing",
    modelTurns: (run.decisions || []).length,
    toolCalls: calls.length,
    failedAttempts: calls.filter((call) => call.result && call.result.ok === false).length,
    repairIterations: (run.repairs || []).length,
    externalCapabilityCalls: calls.filter((call) => call.name === "capability.invoke" || call.name === "capability.list").length,
    researchEscalations: (run.progress && run.progress.researchEscalations) || 0,
    elapsedMs: record.elapsedMs,
    finalTestOk: Boolean(lastTest && lastTest.result && lastTest.result.ok),
    error: run.error || null,
    filesChanged: run.filesChanged || [],
    verification: run.verification ? run.verification.status : null,
  };
}

function decisionLog(run) {
  return (run.decisions || []).map((decision) => ({
    iteration: decision.iteration,
    tools: (decision.toolCalls || []).map((call) => (
      call.name === "capability.invoke" ? `capability.invoke ${call.args && call.args.capability}` : call.name
    )),
    text: String(decision.text || "").replace(/\s+/g, " ").trim().slice(0, 180),
  }));
}

function redact(value, workspaces) {
  let text = JSON.stringify(value);
  for (const workspace of workspaces) text = text.split(workspace).join("[workspace]");
  text = text.split(REPO).join("[repo]");
  text = text.replace(/\/Users\/[^"\\]+/g, "[path]");
  return JSON.parse(text);
}

async function execute(label, capabilities, verify) {
  const started = Date.now();
  const { workspace, sentinel } = prepareWorkspace();
  const provider = new RecordingModelProvider(new OllamaModelProvider({ baseUrl: OLLAMA }));
  const store = new RunStore(path.join(path.dirname(workspace), "runs"));
  const handle = startAgentRun({
    goal: GOAL,
    model: MODEL,
    providerName: provider.name,
    mode: "controlled",
    requirements: REQUIREMENTS,
    provider,
    registry: new ToolRegistry(new ControlledToolProvider(createWorkspaceHost(workspace))),
    store,
    capabilities,
    maxIterations: 40,
    maxRetries: 5,
    maxIdenticalActions: 12,
    timeoutMs: 180000,
    verify(run) {
      return verify(run, workspace);
    },
  });
  let run;
  let failure = null;
  try {
    run = await handle.done;
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    run = store.load(handle.id);
  }
  return { label, run, workspace, sentinel, provider, capabilities, elapsedMs: Date.now() - started, failure };
}

async function main() {
  assert.strictEqual(GOAL.includes("src/"), false);
  assert.strictEqual(GOAL.includes("test/"), false);
  assert.strictEqual(GOAL.includes("research.problem"), false);
  assert.strictEqual(GOAL.includes("capability.invoke"), false);
  assert.strictEqual(GOAL.includes("webhook"), false);
  assert.strictEqual(/do not edit/i.test(GOAL), false);
  const statusBefore = gitStatus(REPO);
  const runtimeBefore = fileHash(path.join(REPO, "packages/agent-runtime/agent-run.js"));
  const sample = prepareWorkspace();
  const failing = cp.spawnSync(process.execPath, ["test/check.test.js"], { cwd: sample.workspace, encoding: "utf8" });
  assert.notStrictEqual(failing.status, 0);

  const hub = new TracingHub(new N8nCapabilityProvider());
  const discovered = await hub.listCapabilities();
  const discoveredNames = discovered.map((item) => item.name).sort();
  assert.deepStrictEqual(discoveredNames, [...OPERATIONAL].sort());
  assert.ok(RESERVED_OFF.every((name) => !discoveredNames.includes(name)));
  assert.ok(discovered.every((item) => item.risk === "read" && !("route" in item) && !("webhook" in item)));

  console.error("baseline");
  const baseline = await execute("baseline", new ExternalCapabilityProvider(), localComplete);
  console.error("assisted");
  const assisted = await execute("assisted", hub, localComplete);

  const assistedRun = assisted.run || { toolCalls: [], observations: [], events: [], decisions: [], requirements: [], verificationHistory: [] };
  const researchCall = (assistedRun.toolCalls || []).find((call) => (
    call.name === "capability.invoke" && call.args && call.args.capability === "research.problem" && call.result && call.result.ok
  ));
  const researchObservation = (assistedRun.observations || []).find((item) => item.type === "capability" && item.capability === "research.problem" && item.ok);
  const researchEvent = (assistedRun.events || []).find((item) => item.type === "capability" && item.capability === "research.problem" && item.status === "ok");
  const laterWrite = researchCall
    ? (assistedRun.toolCalls || []).find((call) => call.name === "file.write" && call.result && call.result.ok && call.iteration > researchCall.iteration)
    : null;
  const sawResearchObservation = (messages) => messages.some((message) => {
    const content = String(message.content || "");
    const toolObservation = message.role === "tool"
      && message.name === "capability.invoke"
      && content.includes('"trusted":false')
      && content.includes("research.problem");
    const runtimeObservation = content.includes("Research observation")
      && content.includes("untrusted")
      && content.includes("Evidence obtained");
    return toolObservation || runtimeObservation;
  });
  const researchTurn = assisted.provider.calls.findIndex((call) => sawResearchObservation(call.messages));
  const consumed = researchTurn >= 0 && assisted.provider.calls.length > researchTurn + 1
    && sawResearchObservation(assisted.provider.calls[researchTurn + 1].messages);
  const offered = assisted.provider.calls[0] && assisted.provider.calls[0].tools.find((tool) => tool.name === "capability.invoke");
  const baselineTools = baseline.provider.calls[0] ? baseline.provider.calls[0].tools.map((tool) => tool.name) : [];
  const evidenceText = researchCall && researchCall.result && researchCall.result.data ? JSON.stringify(researchCall.result.data.evidence || []) : "";
  const summary = {
    discovered: discoveredNames,
    reservedAbsent: RESERVED_OFF.filter((name) => !discoveredNames.includes(name)),
    baseline: telemetry("baseline", baseline),
    assisted: telemetry("assisted", assisted),
    baselineDecisions: decisionLog(baseline.run || {}),
    assistedDecisions: decisionLog(assistedRun || {}),
    research: researchEvent ? {
      runId: researchEvent.runId,
      requestId: researchEvent.requestId,
      capability: researchEvent.capability,
      duration: researchEvent.duration,
      status: researchEvent.status,
      trusted: researchEvent.trusted,
      problem: researchCall && researchCall.args && researchCall.args.input ? researchCall.args.input.problem : null,
      evidence: researchEvent.evidence,
    } : null,
    invocations: hub.invocations,
    evidenceMentionsProcedure: /subtract 9|from the right|right-to-left/i.test(evidenceText),
    consumed,
    laterWrite: Boolean(laterWrite),
    recommendedFix: researchCall && researchCall.result && researchCall.result.data ? researchCall.result.data.recommended_fix : null,
    orchestration: {
      runId: assistedRun.id || null,
      lifecycle: assistedRun.lifecycle || null,
      finalStrategy: assistedRun.strategy || null,
      error: assistedRun.error || null,
      verification: assistedRun.verification || null,
      modelTurns: (assistedRun.decisions || []).length,
      elapsedMs: assisted.elapsedMs,
      progress: assistedRun.progress ? {
        strategy: assistedRun.progress.strategy,
        stagnantTurns: assistedRun.progress.stagnantTurns,
        semanticStagnation: assistedRun.progress.semanticStagnation,
        repeatedIntentCount: assistedRun.progress.repeatedIntentCount,
        researchEscalations: assistedRun.progress.researchEscalations,
        modelTurnsBeforeEscalation: assistedRun.progress.modelTurnsBeforeEscalation,
        runtimeDirectedEscalation: assistedRun.progress.runtimeDirectedEscalation,
        hypothesis: assistedRun.progress.hypothesis,
        window: assistedRun.progress.window,
        seenQuestions: (assistedRun.progress.seenQuestions || []).length,
      } : null,
      strategyEvents: (assistedRun.events || []).filter((event) => event.type === "strategy"),
      researchDirectedBy: researchCall ? researchCall.directedBy || "model" : null,
      researchCount: (assistedRun.toolCalls || []).filter((call) => call.name === "capability.invoke" && call.args && call.args.capability === "research.problem").length,
      firstDecisionAfterResearch: researchCall
        ? decisionLog(assistedRun).find((decision) => decision.iteration > researchCall.iteration) || null
        : null,
    },
  };

  const evidencePath = path.join(__dirname, "out", "qualification.json");
  let failed = null;
  try {
  assert.strictEqual(assisted.failure, null);
  assert.strictEqual(assistedRun.lifecycle, "completed");
  assert.strictEqual(assistedRun.error, null);
  assert.strictEqual(assistedRun.verification.status, "passed");
  assert.ok(assistedRun.verificationHistory.some((item) => item.status === "failed"));
  assert.strictEqual(assistedRun.verificationHistory.at(-1).status, "passed");
  assert.ok(assistedRun.requirements.every((item) => item.status === "satisfied"));
  assert.ok(offered);
  assert.ok(offered.description.includes("research.problem"));
  assert.ok(!offered.description.includes("image.generate"));
  assert.ok(!offered.description.includes("webhook"));
  assert.ok(!baselineTools.includes("capability.invoke"));
  assert.strictEqual(baseline.run.goal, GOAL);
  assert.strictEqual(assistedRun.goal, GOAL);
  assert.strictEqual(baseline.run.lifecycle, "completed");
  assert.strictEqual(baseline.run.verification.status, "passed");
  assert.ok(hub.invocations.every((item) => !item.contextKeys.some((key) => ["files", "repository", "workspace", "command", "shell"].includes(key))));
  if (researchCall) {
    assert.ok(!JSON.stringify(researchCall.args).includes("webhook"));
    assert.strictEqual(researchCall.result.data.recommended_fix, null);
    assert.strictEqual(researchCall.result.data.likely_cause, null);
    assert.strictEqual(researchObservation.trusted, false);
    assert.strictEqual(researchObservation.runId, assistedRun.id);
    assert.ok(researchObservation.requestId);
    assert.strictEqual(typeof researchObservation.duration, "number");
    assert.ok(researchEvent);
    assert.strictEqual(consumed, true);
    assert.ok(laterWrite);
    assert.ok(laterWrite.directedBy !== "runtime");
    assert.ok(laterWrite.args && typeof laterWrite.args.contents === "string" && laterWrite.args.contents.includes("function"));
    assert.ok(!evidenceText.includes(laterWrite.args.contents));
    assert.ok(hub.invocations.some((item) => item.capability === "research.problem"));
    assert.ok((assistedRun.progress.researchEscalations || 0) <= 1);
  }
  assert.deepStrictEqual([...assistedRun.filesChanged].sort(), workspaceChanges(assisted.workspace));
  assert.ok(assistedRun.filesChanged.includes("src/check.js"));
  assert.strictEqual(fs.readFileSync(assisted.sentinel, "utf8"), "untouched");
  assert.strictEqual(fs.readFileSync(baseline.sentinel, "utf8"), "untouched");
  assert.strictEqual(gitStatus(REPO), statusBefore);
  assert.strictEqual(fileHash(path.join(REPO, "packages/agent-runtime/agent-run.js")), runtimeBefore);
  const loop = fs.readFileSync(path.join(REPO, "packages/agent-runtime/agent-run.js"), "utf8");
  assert.strictEqual(loop.includes("research.problem"), false);
  assert.strictEqual(loop.includes("webhook"), false);
  console.log(JSON.stringify({ baseline: summary.baseline, assisted: summary.assisted, research: summary.research && { requestId: summary.research.requestId, runId: summary.research.runId, status: summary.research.status } }, null, 2));
  } catch (error) {
    failed = error;
  }
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify(redact(summary, [baseline.workspace, assisted.workspace, sample.workspace]), null, 2));
  if (failed) throw failed;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
