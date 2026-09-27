const crypto = require("crypto");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const { ModelProvider, OllamaModelProvider, ControlledToolProvider, ToolRegistry, ExternalCapabilityProvider, RunStore, startAgentRun } = require("../agent-runtime");
const { createWorkspaceHost } = require("../coding-qualify/host");
const { REQUIREMENTS, loadApp } = require("./acceptance");
const { featureComplete, workspaceChanges } = require("./verify");

const FIXTURE = path.join(__dirname, "fixture");
const REPO = path.resolve(__dirname, "../..");
const MODEL = process.env.CODEME_QWEN_MODEL || "qwen3.5:9b";
const OLLAMA = process.env.CODEME_OLLAMA_URL || "http://127.0.0.1:11434";
const GOAL = "Add a user registration endpoint. Validate name and email, reject invalid input with appropriate errors, prevent duplicate email registration, store valid users through the existing repository layer, and add/repair the necessary tests.";

class RecordingModelProvider extends ModelProvider {
  constructor(inner) {
    super(inner.name);
    this.inner = inner;
    this.calls = [];
  }

  async complete(input) {
    this.calls.push({ messages: input.messages });
    const decision = await this.inner.complete(input);
    const names = (decision.toolCalls || []).map((call) => `${call.name}${call.args && call.args.path ? ` ${call.args.path}` : ""}${call.args && call.args.command ? ` ${call.args.command}` : ""}`).join(", ");
    console.error(`decision ${names || (decision.text || "").slice(0, 140)}`);
    return decision;
  }
}

function prepareWorkspace() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-feature-"));
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
  cp.execFileSync("git", ["commit", "-m", "user service"], { cwd: workspace, env: gitEnv, stdio: "ignore" });
  return { workspace, sentinel };
}

function gitStatus(cwd) {
  return cp.execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" });
}

function fileHash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

async function main() {
  assert.strictEqual(GOAL.includes("src/"), false);
  assert.strictEqual(GOAL.includes("test/"), false);
  const { workspace, sentinel } = prepareWorkspace();
  const statusBefore = gitStatus(REPO);
  const runtimeBefore = fileHash(path.join(REPO, "packages/agent-runtime/agent-run.js"));
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
    capabilities: new ExternalCapabilityProvider(),
    maxIterations: 24,
    maxRetries: 5,
    maxIdenticalActions: 12,
    timeoutMs: 180000,
    verify(run) {
      return featureComplete(run, workspace);
    },
  });

  let run;
  try {
    run = await handle.done;
  } finally {
    const outDir = path.join(__dirname, "out");
    fs.mkdirSync(outDir, { recursive: true });
    if (run || handle.id) fs.writeFileSync(path.join(outDir, "qualification.json"), JSON.stringify(run || store.load(handle.id), null, 2));
  }

  const changes = workspaceChanges(workspace);
  const discovered = run.toolCalls.some((call) => call.name === "repo.search") && run.toolCalls.filter((call) => call.name === "file.read").length >= 2;
  const failed = run.toolCalls.find((call) => call.name === "tests.run" && call.result && call.result.ok === false);
  const fedBack = provider.calls.some((call, index) => index > 0 && call.messages.some((message) => message.role === "tool" && String(message.content).includes('"ok":false') && String(message.content).includes("exit_status")));
  const app = loadApp(workspace);
  const created = app.handle({ method: "POST", path: "/users", body: { name: "Ada", email: "ada@example.com" } });

  assert.strictEqual(run.lifecycle, "completed");
  assert.strictEqual(run.verification.status, "passed");
  assert.ok(run.verificationHistory.some((item) => item.status === "failed"));
  assert.ok(run.verificationHistory.at(-1).status === "passed");
  assert.ok(discovered);
  assert.ok(changes.length >= 2);
  assert.deepStrictEqual([...run.filesChanged].sort(), changes);
  assert.ok(failed);
  assert.strictEqual(fedBack, true);
  assert.ok(run.repairs.length >= 1);
  assert.strictEqual(created.status, 201);
  assert.ok(run.requirements.every((item) => item.status === "satisfied"));
  assert.strictEqual(fs.readFileSync(sentinel, "utf8"), "untouched");
  assert.strictEqual(gitStatus(REPO), statusBefore);
  assert.strictEqual(fileHash(path.join(REPO, "packages/agent-runtime/agent-run.js")), runtimeBefore);
  assert.ok(run.transitions.some((item) => item.to === "verifying"));
  assert.ok(run.transitions.some((item) => item.to === "completed"));
  console.log(JSON.stringify({ id: run.id, filesChanged: run.filesChanged, requirements: run.requirements.map((item) => item.status), repairs: run.repairs.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
