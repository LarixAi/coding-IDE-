const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ModelProvider, RunStore, startAgentRun, ControlledToolProvider, ToolRegistry } = require("../../agent-runtime");
const { createWorkspaceHost } = require("../../coding-qualify/host");
const { N8nCapabilityProvider } = require("../../n8n-capability");
const { REQUIREMENTS } = require("../acceptance");
const { fallbackComplete, workspaceChanges } = require("../verify");

const FIXTURE = path.join(__dirname, "../fixture");

const REPAIR = `function validNumber(value) {
  if (typeof value !== "string" || !/^[0-9]{2,}$/.test(value)) return false;
  let sum = 0;
  const digits = value.split("").reverse();
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

module.exports = { validNumber };
`;

class FallbackAwareModelProvider extends ModelProvider {
  constructor() {
    super("scripted");
    this.localStep = 0;
    this.afterFailureStep = 0;
  }

  async complete(input) {
    const messages = input.messages || [];
    const capabilityFailed = messages.some((message) => {
      const text = String(message && message.content || "");
      return (
        (message.role === "tool" && message.name === "capability.invoke" && text.includes('"trusted":false') && text.includes('"ok":false'))
        || (text.includes("Research observation") && text.includes("untrusted") && /unavailable|refused|failed/i.test(text))
      );
    });

    if (capabilityFailed) {
      if (this.afterFailureStep === 0) {
        this.afterFailureStep += 1;
        return { text: "The evidence hub is unavailable, so I will make the bounded local repair now.", toolCalls: [{ name: "file.write", args: { path: "src/check.js", contents: REPAIR } }] };
      }
      if (this.afterFailureStep === 1) {
        this.afterFailureStep += 1;
        return { text: "Retesting the local fallback repair.", toolCalls: [{ name: "tests.run", args: { command: "npm test" } }] };
      }
      if (this.afterFailureStep === 2) {
        this.afterFailureStep += 1;
        return { text: "Checking diagnostics after the local fallback.", toolCalls: [{ name: "diagnostics.run", args: {} }] };
      }
      return { text: "The hub was unavailable, so the repair was decided and verified locally.", toolCalls: [] };
    }

    const steps = [
      { text: "Inspecting the identification-number implementation.", toolCalls: [{ name: "repo.search", args: { query: "validNumber" } }] },
      { text: "Reading the implementation before deciding on a repair.", toolCalls: [{ name: "file.read", args: { path: "src/check.js" } }] },
      { text: "Reading the tests before deciding on a repair.", toolCalls: [{ name: "file.read", args: { path: "test/check.test.js" } }] },
      { text: "Keeping the failing test result as local evidence.", toolCalls: [{ name: "tests.run", args: { command: "npm test" } }] },
      { text: "The repository still does not define the missing rule.", toolCalls: [{ name: "repo.search", args: { query: "validNumber" } }] },
      { text: "The repository still does not define the missing rule.", toolCalls: [{ name: "file.read", args: { path: "src/check.js" } }] },
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

async function main() {
  const source = fs.readFileSync(path.join(FIXTURE, "src/check.js"), "utf8");
  const readme = fs.readFileSync(path.join(FIXTURE, "README.md"), "utf8");
  assert.ok(!/subtract 9|from the right|right-to-left/i.test(source));
  assert.ok(!/subtract 9|from the right|right-to-left/i.test(readme));
  const { workspace, sentinel } = prepareWorkspace();
  const before = cp.spawnSync(process.execPath, ["test/check.test.js"], { cwd: workspace, encoding: "utf8" });
  assert.notStrictEqual(before.status, 0);

  const hub = new N8nCapabilityProvider({ baseUrl: "http://127.0.0.1:9", retries: 0, retryDelayMs: 0 });
  hub.listCapabilities = async () => [{ name: "research.problem", description: "Gather short evidence for a problem. Returns sources and excerpts." }];
  const provider = new FallbackAwareModelProvider();
  const store = new RunStore(path.join(path.dirname(workspace), "runs"));
  const run = await startAgentRun({
    goal: "Repair the identification-number check. The missing rule is not documented in the repository.",
    model: "scripted",
    providerName: provider.name,
    mode: "controlled",
    requirements: REQUIREMENTS,
    provider,
    registry: new ToolRegistry(new ControlledToolProvider(createWorkspaceHost(workspace))),
    store,
    capabilities: hub,
    maxIterations: 14,
    maxIdenticalActions: 20,
    maxRetries: 10,
    verify(runState) {
      return fallbackComplete(runState, workspace);
    },
  }).done;

  const observation = run.observations.find((item) => item.type === "capability");
  const event = run.events.find((item) => item.type === "capability");
  assert.strictEqual(run.lifecycle, "completed", JSON.stringify({
    error: run.error,
    outcome: run.outcome,
    verification: run.verification,
    tools: (run.toolCalls || []).map((call) => ({
      iteration: call.iteration,
      name: call.name,
      ok: call.result && call.result.ok,
      status: call.result && call.result.status,
      code: call.result && call.result.error && call.result.error.code,
    })),
    messages: (run.messages || []).slice(-6).map((message) => String(message.content || "").slice(0, 260)),
  }, null, 2));
  assert.strictEqual(run.error, null);
  assert.strictEqual(run.verification.status, "passed");
  assert.ok(run.requirements.every((item) => item.status === "satisfied"));
  assert.ok(observation);
  assert.ok(observation.iteration > 0, "fallback research must be runtime-directed after local stagnation");
  assert.strictEqual(observation.trusted, false);
  assert.strictEqual(observation.ok, false);
  assert.strictEqual(observation.capability, "research.problem");
  assert.strictEqual(observation.status, "unavailable");
  assert.strictEqual(observation.runId, run.id);
  assert.ok(observation.requestId);
  assert.strictEqual(typeof observation.duration, "number");
  assert.ok(event);
  assert.strictEqual(event.capability, "research.problem");
  assert.strictEqual(event.status, "unavailable");
  assert.strictEqual(event.trusted, false);
  assert.deepStrictEqual(event.evidence, []);
  assert.ok(run.toolCalls.some((call) => call.name === "file.write" && call.result && call.result.ok));
  assert.deepStrictEqual(run.filesChanged, workspaceChanges(workspace));
  assert.ok(run.filesChanged.includes("src/check.js"));
  assert.strictEqual(fs.readFileSync(sentinel, "utf8"), "untouched");
  const loop = fs.readFileSync(path.join(__dirname, "../../agent-runtime/agent-run.js"), "utf8");
  assert.strictEqual(loop.includes("research.problem"), false);
  assert.strictEqual(loop.includes("webhook"), false);
  console.log("ok fallback");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
