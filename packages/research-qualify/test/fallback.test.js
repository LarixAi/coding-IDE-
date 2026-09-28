const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ModelProvider, RunStore, startAgentRun, ControlledToolProvider, ToolRegistry } = require("../../agent-runtime");
const { createResearchWorkspaceHost } = require("../host");
const { N8nCapabilityProvider } = require("../../n8n-capability");
const { REQUIREMENTS } = require("../acceptance");

const FIXTURE = path.join(__dirname, "../fixture");

class UnavailableHubModelProvider extends ModelProvider {
  constructor() {
    super("scripted");
    this.localStep = 0;
  }

  async complete() {
    const steps = [
      { text: "Inspecting the identification-number implementation.", toolCalls: [{ name: "repo.search", args: { query: "validNumber" } }] },
      { text: "Reading the implementation before deciding on a repair.", toolCalls: [{ name: "file.read", args: { path: "src/check.js" } }] },
      { text: "Reading the tests before deciding on a repair.", toolCalls: [{ name: "file.read", args: { path: "test/check.test.js" } }] },
      { text: "Keeping the failing test result as local evidence.", toolCalls: [{ name: "tests.run", args: { command: "npm test" } }] },
      { text: "The repository still does not define the missing rule.", toolCalls: [{ name: "repo.search", args: { query: "validNumber" } }] },
      { text: "The repository still does not define the missing rule.", toolCalls: [{ name: "file.read", args: { path: "src/check.js" } }] },
      { text: "Guessing the unpublished rule from model knowledge.", toolCalls: [{ name: "file.write", args: { path: "src/check.js", contents: "module.exports = { validNumber() { return true; } };\n" } }] },
    ];
    const step = steps[Math.min(this.localStep, steps.length - 1)];
    this.localStep += 1;
    return step;
  }
}

function prepareWorkspace() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-research-fallback-"));
  const workspace = path.join(parent, "fixture");
  fs.cpSync(FIXTURE, workspace, { recursive: true });
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
  return workspace;
}

async function refuseGuessWhenHubUnavailable() {
  const source = fs.readFileSync(path.join(FIXTURE, "src/check.js"), "utf8");
  assert.ok(!/subtract 9|from the right|right-to-left/i.test(source));
  const workspace = prepareWorkspace();
  const before = fs.readFileSync(path.join(workspace, "src/check.js"), "utf8");

  const hub = new N8nCapabilityProvider({ baseUrl: "http://127.0.0.1:9", retries: 0, retryDelayMs: 0 });
  hub.listCapabilities = async () => [{ name: "research.problem", description: "Gather short evidence for a problem. Returns sources and excerpts." }];
  const provider = new UnavailableHubModelProvider();
  const store = new RunStore(path.join(path.dirname(workspace), "runs"));
  const run = await startAgentRun({
    goal: "Repair the identification-number check. The missing rule is not documented in the repository.",
    model: "scripted",
    providerName: provider.name,
    mode: "controlled",
    requirements: REQUIREMENTS,
    provider,
    registry: new ToolRegistry(new ControlledToolProvider(createResearchWorkspaceHost(workspace))),
    store,
    capabilities: hub,
    maxIterations: 14,
    maxIdenticalActions: 20,
    maxRetries: 10,
  }).done;

  const capabilityCall = run.toolCalls.find((call) => call.name === "capability.invoke");
  const deniedWrite = run.toolCalls.find((call) => (
    call.name === "file.write"
    && call.result
    && call.result.ok === false
  ));
  assert.strictEqual(run.lifecycle, "failed", JSON.stringify({
    error: run.error,
    outcome: run.outcome,
    tools: (run.toolCalls || []).map((call) => ({
      name: call.name,
      ok: call.result && call.result.ok,
      code: call.result && call.result.error && call.result.error.code,
    })),
  }, null, 2));
  assert.strictEqual(run.error && run.error.code, "evidence_unavailable");
  assert.match(String(run.outcome && run.outcome.summary || ""), /reconnect the hub/i);
  assert.ok(capabilityCall);
  assert.strictEqual(capabilityCall.directedBy, "runtime");
  assert.ok(capabilityCall.result && capabilityCall.result.ok === false);
  assert.ok(!run.toolCalls.some((call) => call.name === "file.write" && call.result && call.result.ok));
  assert.ok(!run.toolCalls.some((call) => call.name === "process.start" && call.result && call.result.ok));
  assert.strictEqual(fs.readFileSync(path.join(workspace, "src/check.js"), "utf8"), before);
  if (deniedWrite) {
    assert.ok(
      deniedWrite.ruleDecision
      && (deniedWrite.ruleDecision.rule === "recovery.external_evidence_required"
        || deniedWrite.ruleDecision.rule === "recovery.evidence_unavailable"),
    );
  }
  const loop = fs.readFileSync(path.join(__dirname, "../../agent-runtime/agent-run.js"), "utf8");
  assert.strictEqual(loop.includes("research.problem"), false);
  assert.strictEqual(loop.includes("webhook"), false);
  console.log("ok fallback refuses to guess when the hub is unavailable");
}

async function emptyDiscoveryStopsWithoutGuessing() {
  const workspace = prepareWorkspace();
  const before = fs.readFileSync(path.join(workspace, "src/check.js"), "utf8");
  const hub = new N8nCapabilityProvider({ baseUrl: "http://127.0.0.1:9", retries: 0, retryDelayMs: 0 });
  const provider = new UnavailableHubModelProvider();
  const store = new RunStore(path.join(path.dirname(workspace), "runs-empty"));
  const run = await startAgentRun({
    goal: "Repair the identification-number check. The missing rule is not documented in the repository.",
    model: "scripted",
    providerName: provider.name,
    mode: "controlled",
    requirements: REQUIREMENTS,
    provider,
    registry: new ToolRegistry(new ControlledToolProvider(createResearchWorkspaceHost(workspace))),
    store,
    capabilities: hub,
    maxIterations: 14,
    maxIdenticalActions: 20,
    maxRetries: 10,
  }).done;

  assert.strictEqual(run.lifecycle, "failed", JSON.stringify({
    error: run.error,
    outcome: run.outcome,
    tools: (run.toolCalls || []).map((call) => ({
      name: call.name,
      ok: call.result && call.result.ok,
    })),
  }, null, 2));
  assert.strictEqual(run.error && run.error.code, "evidence_unavailable");
  assert.match(String(run.outcome && run.outcome.summary || ""), /reconnect the hub/i);
  assert.ok(!run.toolCalls.some((call) => call.name === "file.write" && call.result && call.result.ok));
  assert.strictEqual(fs.readFileSync(path.join(workspace, "src/check.js"), "utf8"), before);
  console.log("ok empty hub discovery refuses to guess");
}

async function main() {
  await refuseGuessWhenHubUnavailable();
  await emptyDiscoveryStopsWithoutGuessing();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
