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

class ScriptedModelProvider extends ModelProvider {
  constructor(steps) {
    super("scripted");
    this.steps = [...steps];
  }

  async complete() {
    const step = this.steps.shift();
    return { text: step.text || "", toolCalls: step.toolCalls || [] };
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
  const provider = new ScriptedModelProvider([
    { toolCalls: [{ name: "capability.invoke", args: { capability: "research.problem", input: { problem: "Luhn algorithm which digits are doubled" } } }] },
    { toolCalls: [{ name: "file.write", args: { path: "src/check.js", contents: REPAIR } }] },
    { toolCalls: [{ name: "tests.run", args: { command: "npm test" } }] },
    { toolCalls: [{ name: "diagnostics.run", args: {} }] },
    { toolCalls: [{ name: "git.diff", args: {} }] },
    { text: "The hub was unavailable, so the repair was decided locally." },
  ]);
  const store = new RunStore(path.join(path.dirname(workspace), "runs"));
  const run = await startAgentRun({
    goal: "Repair the identification-number check after the external capability fails.",
    model: "scripted",
    providerName: provider.name,
    mode: "controlled",
    requirements: REQUIREMENTS,
    provider,
    registry: new ToolRegistry(new ControlledToolProvider(createWorkspaceHost(workspace))),
    store,
    capabilities: hub,
    maxIterations: 8,
    verify(runState) {
      return fallbackComplete(runState, workspace);
    },
  }).done;

  const observation = run.observations.find((item) => item.type === "capability");
  const event = run.events.find((item) => item.type === "capability");
  assert.strictEqual(run.lifecycle, "completed");
  assert.strictEqual(run.error, null);
  assert.strictEqual(run.verification.status, "passed");
  assert.ok(run.requirements.every((item) => item.status === "satisfied"));
  assert.ok(observation);
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
