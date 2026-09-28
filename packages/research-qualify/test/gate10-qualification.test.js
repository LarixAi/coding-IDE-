const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  ModelProvider,
  RunStore,
  startAgentRun,
  ControlledToolProvider,
  ToolRegistry,
} = require("../../agent-runtime");
const { createResearchWorkspaceHost } = require("../host");
const { REQUIREMENTS } = require("../acceptance");
const { GOAL } = require("../goal");
const { researchComplete } = require("../verify");

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

class EvidenceAwareModelProvider extends ModelProvider {
  constructor() {
    super("gate10-scripted");
    this.calls = [];
    this.localStep = 0;
    this.postResearchStep = 0;
    this.repairIssued = false;
    this.repairSawResearch = false;
  }

  async complete(input) {
    this.calls.push(input);
    const messages = input.messages || [];
    const researchSeen = messages.some((message) => {
      const text = String(message && message.content || "");
      return (
        (message.role === "tool" && message.name === "capability.invoke" && text.includes('"trusted":false'))
        || (text.includes("Research observation") && text.includes("Evidence obtained"))
      );
    });

    if (researchSeen) {
      if (this.postResearchStep === 0) {
        this.postResearchStep += 1;
        this.repairIssued = true;
        this.repairSawResearch = true;
        return {
          text: "The new external evidence resolves the missing transformation. I will apply it now.",
          toolCalls: [{ name: "file.write", args: { path: "src/check.js", contents: REPAIR } }],
        };
      }
      if (this.postResearchStep === 1) {
        this.postResearchStep += 1;
        return {
          text: "Running the native tests after the evidence-based repair.",
          toolCalls: [{ name: "tests.run", args: { command: "npm test" } }],
        };
      }
      if (this.postResearchStep === 2) {
        this.postResearchStep += 1;
        return {
          text: "Checking diagnostics after the repair.",
          toolCalls: [{ name: "diagnostics.run", args: {} }],
        };
      }
      if (this.postResearchStep === 3) {
        this.postResearchStep += 1;
        return {
          text: "Inspecting the final diff after tests and diagnostics.",
          toolCalls: [{ name: "git.diff", args: {} }],
        };
      }
      return {
        text: "The identification-number repair is complete and verified from tests, diagnostics, and the final diff.",
        toolCalls: [],
      };
    }

    const steps = [
      {
        text: "Inspecting where the identification-number check is implemented.",
        toolCalls: [{ name: "repo.search", args: { query: "validNumber" } }],
      },
      {
        text: "Reading the repository note before deciding on a repair.",
        toolCalls: [{ name: "file.read", args: { path: "README.md" } }],
      },
      {
        text: "Reading the implementation.",
        toolCalls: [{ name: "file.read", args: { path: "src/check.js" } }],
      },
      {
        text: "Reading the existing tests.",
        toolCalls: [{ name: "file.read", args: { path: "test/check.test.js" } }],
      },
      {
        text: "Running the project tests to keep the failing result as evidence.",
        toolCalls: [{ name: "tests.run", args: { command: "npm test" } }],
      },
      {
        text: "The repository does not define the missing transformation. I need more evidence before editing.",
        toolCalls: [{ name: "repo.search", args: { query: "validNumber" } }],
      },
      {
        text: "The repository does not define the missing transformation. I need more evidence before editing.",
        toolCalls: [{ name: "file.read", args: { path: "src/check.js" } }],
      },
    ];

    const step = steps[Math.min(this.localStep, steps.length - 1)];
    this.localStep += 1;
    return step;
  }
}

function prepareWorkspace() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-gate10-"));
  const workspace = path.join(parent, "fixture");
  fs.cpSync(FIXTURE, workspace, { recursive: true });
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "gate10",
    GIT_AUTHOR_EMAIL: "gate10@example.com",
    GIT_COMMITTER_NAME: "gate10",
    GIT_COMMITTER_EMAIL: "gate10@example.com",
  };
  cp.execFileSync("git", ["init", "-b", "main"], { cwd: workspace, stdio: "ignore" });
  cp.execFileSync("git", ["add", "."], { cwd: workspace, stdio: "ignore" });
  cp.execFileSync("git", ["commit", "-m", "gate10 fixture"], { cwd: workspace, env: gitEnv, stdio: "ignore" });
  return workspace;
}

async function main() {
  assert.strictEqual(/subtract 9|from the right|right-to-left/i.test(GOAL), false);
  const workspace = prepareWorkspace();
  const before = cp.spawnSync(process.execPath, ["test/check.test.js"], { cwd: workspace, encoding: "utf8" });
  assert.notStrictEqual(before.status, 0, "fixture must start broken");

  const hub = { invocations: 0 };
  const provider = new EvidenceAwareModelProvider();
  const run = await startAgentRun({
    goal: GOAL,
    model: "gate10-scripted",
    providerName: provider.name,
    mode: "controlled",
    requirements: REQUIREMENTS.map((item) => ({ ...item })),
    provider,
    registry: new ToolRegistry(new ControlledToolProvider(createResearchWorkspaceHost(workspace))),
    store: new RunStore(fs.mkdtempSync(path.join(os.tmpdir(), "codeme-gate10-runs-"))),
    capabilities: {
      async listCapabilities() {
        return [{
          name: "research.problem",
          description: "Gather short evidence for a problem. Returns sources and excerpts.",
        }];
      },
      async invoke(request) {
        hub.invocations += 1;
        return {
          protocolVersion: 1,
          requestId: request.requestId,
          status: "ok",
          data: {
            problem: request.input && request.input.problem,
            confidence: "high",
            likely_cause: null,
            recommended_fix: null,
            evidence: [{
              title: "Published rule",
              url: "https://example.com/published-rule",
              excerpt: "Process digits from the right; double every second digit and subtract 9 when the doubled value exceeds 9.",
              source: "test",
            }],
          },
          sources: [],
          warnings: [],
          error: null,
          duration: 5,
        };
      },
    },
    maxIterations: 14,
    maxIdenticalActions: 20,
    maxRetries: 10,
    recoveryReserve: 2,
    verify(runState) {
      return researchComplete(runState, workspace);
    },
  }).done;

  const calls = run.toolCalls || [];
  const researchCalls = calls.filter((call) => (
    call.name === "capability.invoke"
    && call.args
    && call.args.capability === "research.problem"
  ));
  const research = researchCalls[0];
  const researchIndex = calls.indexOf(research);
  const writeIndex = calls.findIndex((call) => (
    call.name === "file.write"
    && call.result
    && call.result.ok
  ));
  const failedTestIndex = calls.findIndex((call) => (
    call.name === "tests.run"
    && call.result
    && call.result.ok === false
  ));
  const passedTestIndex = calls.findIndex((call, index) => (
    index > writeIndex
    && call.name === "tests.run"
    && call.result
    && call.result.ok
  ));
  const diagnosticsIndex = calls.findIndex((call, index) => (
    index > writeIndex
    && call.name === "diagnostics.run"
    && call.result
    && call.result.ok
  ));
  const diffIndex = calls.findIndex((call, index) => (
    index > writeIndex
    && call.name === "git.diff"
    && call.result
    && call.result.ok
  ));

  assert.strictEqual(run.lifecycle, "completed", JSON.stringify({
    error: run.error,
    verification: run.verification,
    tools: calls.map((call) => call.name),
  }, null, 2));
  assert.strictEqual(run.error, null);
  assert.strictEqual(run.verification.status, "passed");
  assert.ok(run.requirements.every((item) => item.status === "satisfied"));
  assert.strictEqual(hub.invocations, 1);
  assert.strictEqual(researchCalls.length, 1);
  assert.ok(research);
  assert.ok(research.iteration > 0, "research must happen after local inspection, not at turn zero");
  assert.strictEqual(research.directedBy, "runtime");
  assert.strictEqual(research.result.trusted, false);
  assert.strictEqual(run.progress.researchEscalations, 1);
  assert.ok(failedTestIndex >= 0);
  assert.ok(researchIndex > failedTestIndex, "research must follow the captured local test failure");
  assert.ok(writeIndex > researchIndex, "workspace edits must follow the untrusted research observation");
  assert.ok(passedTestIndex > writeIndex);
  assert.ok(diagnosticsIndex > writeIndex);
  assert.ok(diffIndex > writeIndex);
  assert.strictEqual(provider.repairIssued, true);
  assert.strictEqual(provider.repairSawResearch, true);
  assert.ok(!calls.slice(0, researchIndex).some((call) => (
    (call.name === "file.write" || call.name === "file.patch")
    && call.result
    && call.result.ok
  )));
  assert.ok(run.events.some((event) => (
    event.type === "capability"
    && event.capability === "research.problem"
    && event.trusted === false
  )));
  assert.ok(run.events.some((event) => (
    event.type === "strategy"
    && (event.to === "stagnant" || event.to === "research_needed" || event.to === "researching")
  )));
  assert.notStrictEqual(run.outcome && run.outcome.reason, "iteration_limit");

  const final = cp.spawnSync(process.execPath, ["test/check.test.js"], { cwd: workspace, encoding: "utf8" });
  assert.strictEqual(final.status, 0, final.stderr || final.stdout);
  console.log("ok gate 10 research-assisted coding qualification");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
