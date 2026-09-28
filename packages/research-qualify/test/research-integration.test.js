const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ModelProvider, RunStore, startAgentRun, ControlledToolProvider, ToolRegistry } = require("../../agent-runtime");
const { createWorkspaceHost } = require("../../coding-qualify/host");
const { REQUIREMENTS } = require("../acceptance");
const { GOAL } = require("../goal");
const { localComplete } = require("../verify");

const FIXTURE = path.join(__dirname, "../fixture");
const FIX_TEXT = "I need to fix the implementation. The standard Luhn algorithm doubles every second digit starting from the rightmost digit.";
const FIX_AGAIN = "I need to fix the implementation. The standard Luhn algorithm doubles every second digit starting from the right.";
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
    if (!step) throw Object.assign(new Error("no scripted decision"), { code: "model_disconnected" });
    return { text: step.text || "", toolCalls: step.toolCalls || [] };
  }
}

function prepareWorkspace() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-research-integration-"));
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

async function main() {
  assert.strictEqual(GOAL.includes("research.problem"), false);
  assert.strictEqual(GOAL.includes("capability.invoke"), false);
  assert.strictEqual(/do not edit/i.test(GOAL), false);
  const source = fs.readFileSync(path.join(__dirname, "../run.js"), "utf8");
  assert.ok(source.includes("researchComplete"));
  assert.ok(source.includes('execute("baseline", new ExternalCapabilityProvider(), localComplete)'));
  assert.ok(source.includes('execute("assisted", hub, researchComplete)'));

  const workspace = prepareWorkspace();
  const hub = { invocations: 0 };
  const provider = new ScriptedModelProvider([
    { text: "Inspecting the repository.", toolCalls: [{ name: "repo.search", args: { query: "validNumber" } }] },
    { text: "Reading the implementation.", toolCalls: [{ name: "file.read", args: { path: "src/check.js" } }] },
    { text: "Reading the tests.", toolCalls: [{ name: "file.read", args: { path: "test/check.test.js" } }] },
    { text: "The tests fail.", toolCalls: [{ name: "tests.run", args: { command: "npm test" } }] },
    { text: FIX_TEXT, toolCalls: [{ name: "repo.search", args: { query: "validNumber" } }] },
    { text: FIX_AGAIN, toolCalls: [{ name: "repo.search", args: { query: "validNumber" } }] },
    { text: FIX_TEXT, toolCalls: [{ name: "file.read", args: { path: "src/check.js" } }] },
    { text: "The evidence changes the repair.", toolCalls: [{ name: "file.write", args: { path: "src/check.js", contents: REPAIR } }] },
    { text: "Retesting.", toolCalls: [{ name: "tests.run", args: { command: "npm test" } }] },
    { text: "Checking diagnostics.", toolCalls: [{ name: "diagnostics.run", args: {} }] },
    { text: "Inspecting the diff.", toolCalls: [{ name: "git.diff", args: {} }] },
    { text: "The repair is verified." },
  ]);
  const run = await startAgentRun({
    goal: GOAL,
    model: "scripted",
    providerName: "scripted",
    mode: "controlled",
    requirements: REQUIREMENTS.map((item) => ({ ...item })),
    provider,
    registry: new ToolRegistry(new ControlledToolProvider(createWorkspaceHost(workspace))),
    store: new RunStore(fs.mkdtempSync(path.join(os.tmpdir(), "codeme-research-integration-runs-"))),
    capabilities: {
      async listCapabilities() {
        return [{ name: "research.problem", description: "Gather short evidence for a problem. Returns sources and excerpts." }];
      },
      async invoke(request) {
        hub.invocations += 1;
        return {
          protocolVersion: 1,
          requestId: request.requestId,
          status: "ok",
          data: {
            problem: request.input && request.input.problem,
            confidence: "low",
            likely_cause: null,
            recommended_fix: null,
            evidence: [{ title: "Published rule", url: "https://example.com/rule", excerpt: "double every second digit from the right and subtract 9", source: "test" }],
          },
          sources: [],
          warnings: [],
          error: null,
          duration: 4,
        };
      },
    },
    maxIterations: 16,
    verify(runState) {
      return localComplete(runState, workspace);
    },
  }).done;

  const research = run.toolCalls.find((call) => call.name === "capability.invoke" && call.directedBy === "runtime");
  const write = run.toolCalls.find((call) => call.name === "file.write" && call.result && call.result.ok);
  assert.strictEqual(run.lifecycle, "completed", `${run.error && run.error.code}: ${run.verification && run.verification.summary}`);
  assert.strictEqual(run.verification.status, "passed");
  assert.ok(research);
  assert.strictEqual(research.result.trusted, false);
  assert.strictEqual(research.result.data.recommended_fix, null);
  assert.strictEqual(hub.invocations, 1);
  assert.strictEqual(run.progress.researchEscalations, 1);
  assert.ok(write);
  assert.ok(write.iteration > research.iteration);
  assert.notStrictEqual(write.directedBy, "runtime");
  assert.ok(run.messages.some((message) => String(message.content).includes("untrusted") && String(message.content).includes("Evidence obtained")));
  console.log("ok research integration stays outside the baseline goal");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
