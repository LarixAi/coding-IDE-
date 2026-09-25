const crypto = require("crypto");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const { ModelProvider, OllamaModelProvider, ControlledToolProvider, ToolRegistry, ExternalCapabilityProvider, RunStore, startAgentRun } = require("../agent-runtime");
const { createWorkspaceHost } = require("./host");
const { codingComplete, failedTest } = require("./verify");

const FIXTURE = path.join(__dirname, "fixture");
const REPO = path.resolve(__dirname, "../..");
const MODEL = process.env.CODEME_QWEN_MODEL || "qwen3.5:9b";
const OLLAMA = process.env.CODEME_OLLAMA_URL || "http://127.0.0.1:11434";

const GOAL = [
  "Fix src/greet.js so the tests pass. Do not change test/greet.test.js, package.json, or README.md.",
  "Search the repository for greet.",
  "Read src/greet.js and test/greet.test.js.",
  "Run npm test with the test tool before editing, and use the failing output.",
  "Repair only src/greet.js.",
  "Run diagnostics.",
  "Run npm test again. If it fails, diagnose that output and repair the source again.",
  "After npm test exits 0, inspect the git diff.",
  "Do not say the task is finished until those results are in the conversation.",
].join(" ");

class RecordingModelProvider extends ModelProvider {
  constructor(inner) {
    super(inner.name);
    this.inner = inner;
    this.calls = [];
  }

  async complete(input) {
    this.calls.push({ messages: input.messages });
    const decision = await this.inner.complete(input);
    const names = (decision.toolCalls || []).map((call) => call.name).join(", ");
    console.error(`decision ${names || (decision.text || "").slice(0, 120)}`);
    return decision;
  }
}

function prepareWorkspace() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-coding-"));
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
  cp.execFileSync("git", ["commit", "-m", "broken greet"], { cwd: workspace, env: gitEnv, stdio: "ignore" });
  return { parent, workspace, sentinel };
}

function gitStatus(cwd) {
  return cp.execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" });
}

function fileHash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

async function main() {
  const { workspace, sentinel } = prepareWorkspace();
  const originalSource = fs.readFileSync(path.join(workspace, "src/greet.js"), "utf8");
  const originalTest = fs.readFileSync(path.join(workspace, "test/greet.test.js"), "utf8");
  const originalPackage = fs.readFileSync(path.join(workspace, "package.json"), "utf8");
  const statusBefore = gitStatus(REPO);
  const runtimeBefore = fileHash(path.join(REPO, "packages/agent-runtime/agent-run.js"));
  const provider = new RecordingModelProvider(new OllamaModelProvider({ baseUrl: OLLAMA }));
  const store = new RunStore(path.join(path.dirname(workspace), "runs"));
  const handle = startAgentRun({
    goal: GOAL,
    model: MODEL,
    providerName: provider.name,
    mode: "controlled",
    provider,
    registry: new ToolRegistry(new ControlledToolProvider(createWorkspaceHost(workspace))),
    store,
    capabilities: new ExternalCapabilityProvider(),
    maxIterations: 16,
    maxRetries: 4,
    maxIdenticalActions: 10,
    timeoutMs: 180000,
    verify(run) {
      const testFile = path.join(workspace, "test/greet.test.js");
      if (fs.existsSync(testFile) && fs.readFileSync(testFile, "utf8") !== originalTest) {
        return { status: "failed", summary: "test/greet.test.js changed. Restore it and repair only src/greet.js.", evidence: ["test file"] };
      }
      return codingComplete(run);
    },
  });

  let run;
  try {
    run = await handle.done;
  } catch (error) {
    run = store.load(handle.id) || { error: error.message };
    throw error;
  } finally {
    const outDir = path.join(__dirname, "out");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "qualification.json"), JSON.stringify(run, null, 2));
  }

  const source = fs.readFileSync(path.join(workspace, "src/greet.js"), "utf8");
  const diff = cp.execFileSync("git", ["diff"], { cwd: workspace, encoding: "utf8" });
  const recordedDiff = [...run.toolCalls].reverse().find((call) => call.name === "git.diff" && call.result && call.result.ok);
  const firstFail = run.toolCalls.find((call) => failedTest(call));
  const failText = JSON.stringify(firstFail && firstFail.result);
  const fedBack = provider.calls.slice(1).some((call) => call.messages.some((message) => message.role === "tool" && String(message.content).includes("Hello, Ada") && String(message.content).includes('"ok":false')));
  const repair = run.repairs.find((item) => item.path === "src/greet.js");
  const repairCall = run.toolCalls.find((call, index) => index > run.toolCalls.indexOf(firstFail) && call.name === "file.write" && call.args && call.args.path === "src/greet.js" && call.result && call.result.ok);
  const repairAt = run.toolCalls.indexOf(repairCall);
  delete require.cache[require.resolve(path.join(workspace, "src/greet.js"))];
  const { greet } = require(path.join(workspace, "src/greet.js"));

  assert.notStrictEqual(source, originalSource);
  assert.strictEqual(greet("Ada"), "Hello, Ada");
  assert.ok(firstFail, "first test run should fail");
  assert.strictEqual(fedBack, true);
  assert.ok(repair, "a repair write should follow the failing test");
  assert.ok(repairCall);
  assert.ok(run.toolCalls.some((call, index) => index > repairAt && (call.name === "tests.run" || call.name === "terminal.run") && call.result && call.result.ok));
  assert.ok(run.filesChanged.includes("src/greet.js"));
  assert.ok(recordedDiff);
  assert.strictEqual(String(recordedDiff.result.data.diff).trim(), diff.trim());
  assert.ok(diff.includes("src/greet.js"));
  assert.strictEqual(run.lifecycle, "completed");
  assert.strictEqual(run.verification.status, "passed");
  assert.strictEqual(run.outcome.status, "completed");
  assert.ok(run.verificationHistory.some((item) => item.status === "failed"));
  assert.ok(run.transitions.some((item) => item.to === "awaiting_model"));
  assert.ok(run.transitions.some((item) => item.to === "executing_tool"));
  assert.ok(run.transitions.some((item) => item.to === "verifying"));
  assert.ok(run.transitions.some((item) => item.to === "completed"));
  assert.ok(run.decisions.length >= 2);
  assert.strictEqual(fs.readFileSync(path.join(workspace, "test/greet.test.js"), "utf8"), originalTest);
  assert.strictEqual(fs.readFileSync(path.join(workspace, "package.json"), "utf8"), originalPackage);
  assert.strictEqual(fs.readFileSync(sentinel, "utf8"), "untouched");
  assert.strictEqual(gitStatus(REPO), statusBefore);
  assert.strictEqual(fileHash(path.join(REPO, "packages/agent-runtime/agent-run.js")), runtimeBefore);
  assert.ok(failText.includes("exit_status"));
  console.log(JSON.stringify({ id: run.id, lifecycle: run.lifecycle, filesChanged: run.filesChanged, repairs: run.repairs.length, outcome: run.outcome.status }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
