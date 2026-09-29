const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ModelProvider, RunStore, startAgentRun, createRun, ToolRegistry, ControlledToolProvider, lockModel, classifyTask, selectStrategy, diagnose } = require("../index.js");
const { createWorkspaceHost } = require("../../coding-qualify/host");

const FIXTURE = path.join(__dirname, "../../coding-qualify/fixture");

class ScriptedModelProvider extends ModelProvider {
  constructor(steps) {
    super("scripted");
    this.steps = [...steps];
    this.calls = [];
  }

  async complete(input) {
    this.calls.push(input);
    const step = this.steps.shift();
    if (!step) throw Object.assign(new Error("no scripted decision"), { code: "model_disconnected" });
    return { text: step.text || "", toolCalls: step.toolCalls || [] };
  }
}

function start(options) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-hardening-"));
  const workspace = options.workspace || FIXTURE;
  const store = new RunStore(path.join(directory, "runs"));
  const handle = startAgentRun({
    goal: options.goal || "Inspect the repository.",
    model: options.model || "scripted",
    fallbackModel: options.fallbackModel,
    modelProfiles: options.modelProfiles,
    providerName: "scripted",
    mode: options.mode || "read_only",
    inferRequirements: options.inferRequirements,
    requirements: options.requirements,
    provider: options.provider,
    registry: options.registry || new ToolRegistry(new ControlledToolProvider(createWorkspaceHost(workspace))),
    store,
    maxIterations: options.maxIterations ?? 12,
    verify: options.verify,
    capabilities: options.capabilities,
  });
  handle.store = store;
  return handle;
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
  await test("the effective model is locked and a fallback is explicit", async () => {
    const selected = lockModel({
      model: "chat-only",
      fallbackModel: "tool-model",
      modelProfiles: {
        "chat-only": { supportsTools: false },
        "tool-model": { supportsTools: true },
      },
    });
    assert.strictEqual(selected.ok, true);
    assert.strictEqual(selected.requestedModel, "chat-only");
    assert.strictEqual(selected.effectiveModel, "tool-model");
    assert.strictEqual(selected.persistentSelection, "chat-only");
    assert.strictEqual(selected.fallback.from, "chat-only");

    const failed = lockModel({
      model: "chat-only",
      modelProfiles: { "chat-only": { supportsTools: false } },
    });
    assert.strictEqual(failed.ok, false);
    assert.strictEqual(failed.code, "model_not_capable");

    const provider = new ScriptedModelProvider([{ text: "observed", toolCalls: [{ name: "file.read", args: { path: "README.md" } }] }, { text: "readme seen" }]);
    const handle = start({
      provider,
      model: "chat-only",
      fallbackModel: "tool-model",
      modelProfiles: {
        "chat-only": { supportsTools: false },
        "tool-model": { supportsTools: true },
      },
    });
    const run = await handle.done;
    assert.strictEqual(run.requestedModel, "chat-only");
    assert.strictEqual(run.effectiveModel, "tool-model");
    assert.strictEqual(run.persistentSelection, "chat-only");
    assert.ok(provider.calls.every((call) => call.model === "tool-model"));
  });

  await test("strategy selection is deterministic and versioned", async () => {
    assert.strictEqual(classifyTask("find the badge", { mode: "read_only" }), "inspect");
    assert.strictEqual(classifyTask("research the website", { taskClass: "plan", mode: "read_only" }), "plan");
    assert.strictEqual(classifyTask("Fix the failing identification check", { mode: "controlled" }), "bug-fix");
    assert.strictEqual(classifyTask("can you find me a better layout for my website", { mode: "controlled" }), "layout");
    assert.strictEqual(classifyTask("can you create e a folder called website test 2", { mode: "controlled" }), "folder");
    assert.strictEqual(classifyTask("can you create a folder called website test 2", { mode: "read_only" }), "inspect");
    assert.strictEqual(classifyTask("can you check what files are missing from inthe folder", { mode: "controlled" }), "inspect");
    assert.strictEqual(classifyTask("can you read all the files", { mode: "controlled" }), "inspect");
    assert.strictEqual(classifyTask("read server.js and tell me what it does", { mode: "controlled" }), "inspect");
    assert.strictEqual(classifyTask("can you continue working on the files thhat are missing and run the website", { mode: "controlled" }), "build");
    assert.strictEqual(classifyTask("can you create the missing file in the folder", { mode: "controlled" }), "build");
    assert.strictEqual(classifyTask("can you create me a website about a dealership where I can sell cars", { mode: "controlled" }), "build");
    assert.strictEqual(classifyTask("can you create me a website about a dealership where I can sell cars", { mode: "read_only" }), "inspect");
    assert.strictEqual(classifyTask("can you create a folder called ../outside", { mode: "controlled" }), "bug-fix");
    assert.strictEqual(classifyTask("Add registration", { requirements: [{ id: "a" }, { id: "b" }, { id: "c" }] }), "feature");
    const strategy = selectStrategy("Fix the failing test", { mode: "controlled" });
    assert.strictEqual(strategy.id, "bug-fix");
    assert.strictEqual(strategy.version, 1);
    const run = createRun({ goal: "Fix the failing greet test", model: "scripted", providerName: "scripted", mode: "controlled" });
    assert.strictEqual(run.taskClass, "bug-fix");
    assert.strictEqual(run.strategyRecord.version, 1);
    const planned = createRun({ goal: "research the website", model: "scripted", providerName: "scripted", mode: "read_only", taskClass: "plan" });
    assert.strictEqual(planned.taskClass, "plan");
  });

  await test("creating a named folder writes the directory and finishes", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-folder-"));
    fs.writeFileSync(path.join(workspace, "README.md"), "workspace\n");
    const provider = new ScriptedModelProvider([{ text: "this model step must not run" }]);
    const handle = start({
      goal: "can you create e a folder called website test 2",
      mode: "controlled",
      workspace,
      provider,
    });
    const run = await handle.done;
    assert.strictEqual(run.lifecycle, "completed");
    assert.strictEqual(run.taskClass, "folder");
    assert.strictEqual(provider.calls.length, 0);
    assert.ok(fs.statSync(path.join(workspace, "website test 2")).isDirectory());
    assert.ok(run.toolCalls.some((call) => call.name === "dir.create" && call.result && call.result.ok));
  });

  await test("a missing-files question lists the workspace instead of searching the web", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-list-"));
    fs.writeFileSync(path.join(workspace, "package.json"), "{}\n");
    fs.writeFileSync(path.join(workspace, "index.html"), "<html></html>\n");
    const hub = {
      invocations: [],
      async listCapabilities() {
        return [{ name: "research.problem", category: "research", risk: "read", permissions: ["evidence"], description: "Gather evidence" }];
      },
      async invoke() {
        hub.invocations.push("research.problem");
        return { protocolVersion: 1, status: "ok", data: { evidence: [] }, error: null };
      },
    };
    const provider = new ScriptedModelProvider([
      { text: "Listing the folder.", toolCalls: [{ name: "dir.list", args: { path: "." } }] },
      { text: "The folder has package.json and index.html." },
    ]);
    const run = await start({
      goal: "can you check what files are missing from inthe folder",
      mode: "controlled",
      workspace,
      provider,
      capabilities: hub,
    }).done;
    assert.strictEqual(run.taskClass, "inspect");
    assert.strictEqual(run.lifecycle, "completed", `${run.error && run.error.code}: ${run.verification && run.verification.summary}`);
    assert.deepStrictEqual(hub.invocations, []);
    const listed = run.toolCalls.find((call) => call.name === "dir.list");
    assert.ok(listed && listed.result && listed.result.ok);
    assert.ok(listed.result.data.entries.some((entry) => entry.path === "package.json"));
    assert.ok(provider.calls[0].messages.some((message) => String(message.content).includes("dir.list")));
  });

  await test("read-all-files stays inspection-only in Code mode and does not call the hub", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-read-all-"));
    fs.mkdirSync(path.join(workspace, "lib"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "README.md"), "demo workspace\n");
    fs.writeFileSync(path.join(workspace, "server.js"), "console.log('server');\n");
    fs.writeFileSync(path.join(workspace, "lib/util.js"), "module.exports = 1;\n");

    const hub = {
      invocations: [],
      async listCapabilities() {
        return [{ name: "research.problem", category: "research", risk: "read", permissions: ["evidence"], description: "Gather evidence" }];
      },
      async invoke() {
        hub.invocations.push("research.problem");
        return { protocolVersion: 1, status: "ok", data: { evidence: [] }, error: null };
      },
    };

    const provider = new ScriptedModelProvider([
      { toolCalls: [{ name: "dir.list", args: { path: "." } }] },
      { toolCalls: [{ name: "file.read", args: { path: "README.md" } }] },
      { toolCalls: [{ name: "file.read", args: { path: "server.js" } }] },
      { toolCalls: [{ name: "dir.list", args: { path: "lib" } }] },
      { toolCalls: [{ name: "file.read", args: { path: "lib/util.js" } }] },
      { text: "I read README.md, server.js, and lib/util.js." },
    ]);

    const run = await start({
      goal: "can you read all the files",
      mode: "controlled",
      workspace,
      provider,
      capabilities: hub,
      maxIterations: 12,
    }).done;

    assert.strictEqual(run.taskClass, "inspect");
    assert.strictEqual(run.lifecycle, "completed", `${run.error && run.error.code}: ${run.verification && run.verification.summary}`);
    assert.deepStrictEqual(hub.invocations, []);
    assert.ok(run.toolCalls.some((call) => call.name === "dir.list" && call.args.path === "lib"));
    assert.ok(run.toolCalls.some((call) => call.name === "file.read" && call.args.path === "lib/util.js"));
    assert.ok(provider.calls.every((call) => !(call.tools || []).some((tool) => ["file.write", "file.patch", "terminal.run", "capability.invoke"].includes(tool.name))));
  });

  await test("finding a missing site file does not finish until that file is written", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-repair-"));
    fs.mkdirSync(path.join(workspace, "public/css"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "package.json"), "{\"scripts\":{\"start\":\"npx http-server public -p 3000\"}}\n");
    fs.writeFileSync(path.join(workspace, "public/css/style.css"), "body{}\n");
    const host = createWorkspaceHost(workspace);
    host.browserCheck = async (url) => ({ url, statusCode: 200, title: "Dealership", available: true });
    const provider = new ScriptedModelProvider([
      { text: "Listing the folder.", toolCalls: [{ name: "dir.list", args: { path: "." } }] },
      { text: "I can see the public directory is missing index.html. Let me create a proper index.html for the public directory:" },
      { text: "Writing the missing page.", toolCalls: [{ name: "file.write", args: { path: "public/index.html", contents: "<html><body><h1>Dealership</h1></body></html>\n" } }] },
      { text: "Checking the site.", toolCalls: [{ name: "browser.check", args: { url: "http://127.0.0.1:3000/" } }] },
      { text: "The public index is in place and the site responds." },
    ]);
    const run = await start({
      goal: "can you continue working on the files thhat are missing and run the website",
      mode: "controlled",
      workspace,
      provider,
      registry: new ToolRegistry(new ControlledToolProvider(host)),
    }).done;
    assert.strictEqual(run.taskClass, "build");
    assert.strictEqual(run.lifecycle, "completed", `${run.error && run.error.code}: ${run.verification && run.verification.summary}`);
    assert.ok(run.messages.some((message) => String(message.content).includes("Write the missing site file")));
    assert.strictEqual(fs.readFileSync(path.join(workspace, "public/index.html"), "utf8").includes("Dealership"), true);
    assert.ok(run.toolCalls.some((call) => call.name === "browser.check" && call.result && call.result.ok));
    assert.ok(provider.calls[0].messages.some((message) => String(message.content).includes("Workspace files:")));
  });

  await test("a fix request sees the workspace and does not finish on a promised write", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-fix-write-"));
    fs.mkdirSync(path.join(workspace, "public/css"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "package.json"), "{\"scripts\":{\"start\":\"npx http-server public -p 3000\",\"test\":\"node public/index.html\"}}\n");
    fs.writeFileSync(path.join(workspace, "public/css/style.css"), "body{}\n");
    const host = createWorkspaceHost(workspace);
    host.browserCheck = async (url) => ({ url, statusCode: 200, title: "Dealership", available: true });
    host.runTests = async () => ({ command: "npm test", exitCode: 0, stdout: "ok", stderr: "" });
    host.gitDiff = async () => {
      throw Object.assign(new Error("The workspace is not a Git repository"), { code: "not_a_repository" });
    };
    const hub = {
      invocations: [],
      async listCapabilities() {
        return [{ name: "research.problem", category: "research", risk: "read", permissions: ["evidence"], description: "Gather evidence" }];
      },
      async invoke() {
        hub.invocations.push("research.problem");
        return { protocolVersion: 1, status: "ok", data: { evidence: [{ title: "Please proceed", excerpt: "email advice" }] }, error: null };
      },
    };
    const provider = new ScriptedModelProvider([
      { text: "The public directory is missing index.html. Let me create it:" },
      { text: "Writing the page.", toolCalls: [{ name: "file.write", args: { path: "public/index.html", contents: "<html><body><h1>Dealership</h1></body></html>\n" } }] },
      { text: "Checking tests.", toolCalls: [{ name: "tests.run", args: { command: "npm test" } }] },
      { text: "Checking diff.", toolCalls: [{ name: "git.diff", args: {} }] },
      { text: "The missing page is saved." },
    ]);
    const run = await start({
      goal: "okay can you fix the issue",
      mode: "controlled",
      workspace,
      provider,
      capabilities: hub,
      registry: new ToolRegistry(new ControlledToolProvider(host)),
    }).done;
    assert.deepStrictEqual(hub.invocations, []);
    assert.ok(provider.calls[0].messages.some((message) => String(message.content).includes("package.json")));
    assert.ok(provider.calls[0].tools.some((tool) => tool.name === "file.write"));
    assert.ok(provider.calls[1].tools.map((tool) => tool.name).includes("file.write"));
    assert.ok(!provider.calls[1].tools.some((tool) => tool.name === "repo.search"));
    assert.strictEqual(fs.existsSync(path.join(workspace, "public/index.html")), true);
    assert.strictEqual(run.lifecycle, "completed", `${run.error && run.error.code}: ${run.verification && run.verification.summary}`);
  });

  await test("a stalled create-file loop is sent to write instead of stopping", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-stall-write-"));
    fs.mkdirSync(path.join(workspace, "public/css"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "package.json"), "{}\n");
    fs.writeFileSync(path.join(workspace, "website/index.html"), "<html></html>\n");
    fs.writeFileSync(path.join(workspace, "public/css/style.css"), "body{}\n");
    const hub = {
      invocations: [],
      async listCapabilities() {
        return [{ name: "research.problem", category: "research", risk: "read", permissions: ["evidence"], description: "Gather evidence" }];
      },
      async invoke() {
        hub.invocations.push("research.problem");
        return { protocolVersion: 1, status: "ok", data: { evidence: [] }, error: null };
      },
    };
    const list = { name: "dir.list", args: { path: "." } };
    const provider = new ScriptedModelProvider([
      { text: "Looking again.", toolCalls: [list] },
      { text: "Looking again.", toolCalls: [list] },
      { text: "Looking again.", toolCalls: [list] },
      { text: "Writing the missing page.", toolCalls: [{ name: "file.write", args: { path: "public/index.html", contents: "<html><body>Dealership</body></html>\n" } }] },
      { text: "The missing file is in the folder." },
    ]);
    const run = await start({
      goal: "can you create the missing file in the folder",
      mode: "controlled",
      workspace,
      provider,
      capabilities: hub,
    }).done;
    assert.strictEqual(run.taskClass, "build");
    assert.deepStrictEqual(hub.invocations, []);
    assert.ok(run.messages.some((message) => String(message.content).includes("Call file.write now")));
    assert.strictEqual(fs.readFileSync(path.join(workspace, "public/index.html"), "utf8").includes("Dealership"), true);
    assert.strictEqual(run.lifecycle, "completed", `${run.error && run.error.code}: ${run.verification && run.verification.summary}`);
    assert.notStrictEqual(run.outcome && run.outcome.reason, "stagnation");
  });

  await test("a follow-up updates requirements and forces a re-plan", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-hardening-follow-"));
    fs.cpSync(FIXTURE, workspace, { recursive: true });
    const provider = new ScriptedModelProvider([
      { text: "reading", toolCalls: [{ name: "file.read", args: { path: "src/greet.js" } }] },
      { text: "writing", toolCalls: [{ name: "file.write", args: { path: "src/greet.js", contents: "module.exports = { greet(name) { return `Hello, ${name}`; } };\n" } }] },
      { text: "testing", toolCalls: [{ name: "tests.run", args: { command: "npm test" } }] },
      { text: "diffing", toolCalls: [{ name: "git.diff", args: {} }] },
      { text: "also wrote the note", toolCalls: [{ name: "file.write", args: { path: "NOTE.md", contents: "follow-up\n" } }] },
      { text: "retest", toolCalls: [{ name: "tests.run", args: { command: "npm test" } }] },
      { text: "rediff", toolCalls: [{ name: "git.diff", args: {} }] },
      { text: "follow-up complete" },
    ]);
    const handle = start({
      workspace,
      provider,
      mode: "controlled",
      inferRequirements: true,
      goal: "Fix the greet helper so the project tests pass.",
      verify(runState, text) {
        const note = runState.requirements.find((item) => item.id === "follow-up-1");
        if (note) note.status = runState.filesChanged.includes("NOTE.md") ? "satisfied" : "unverified";
        const goal = runState.requirements.find((item) => item.id === "goal");
        if (goal) goal.status = runState.filesChanged.includes("src/greet.js") ? "satisfied" : "unverified";
        if (text.includes("follow-up complete") && (!note || note.status === "satisfied")) {
          return { status: "passed", summary: "follow-up verified", evidence: ["NOTE.md"] };
        }
        return { status: "failed", summary: "follow-up still open", evidence: ["follow-up-1"] };
      },
    });
    handle.followUp("Also write NOTE.md recording the repair.");
    const run = await handle.done;
    assert.strictEqual(run.followUps.length, 1);
    assert.ok(run.requirements.some((item) => item.id === "follow-up-1"));
    assert.ok(run.filesChanged.includes("NOTE.md"));
    assert.strictEqual(run.lifecycle, "completed");
    assert.ok(run.strategyRecord.guidance.includes("Reproduce the failure"));
    assert.ok(provider.calls[0].messages.some((message) => String(message.content).includes("Reproduce the failure")));
  });

  await test("a failing test is diagnosed as bad_code before the repair", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-hardening-repair-"));
    fs.cpSync(FIXTURE, workspace, { recursive: true });
    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    };
    require("child_process").execFileSync("git", ["init", "-b", "main"], { cwd: workspace });
    require("child_process").execFileSync("git", ["add", "."], { cwd: workspace });
    require("child_process").execFileSync("git", ["commit", "-m", "fixture"], { cwd: workspace, env: gitEnv, stdio: "ignore" });
    const provider = new ScriptedModelProvider([
      { text: "test", toolCalls: [{ name: "tests.run", args: { command: "npm test" } }] },
      { text: "repair", toolCalls: [{ name: "file.write", args: { path: "src/greet.js", contents: "module.exports = { greet(name) { return `Hello, ${name}`; } };\n" } }] },
      { text: "retest", toolCalls: [{ name: "tests.run", args: { command: "npm test" } }] },
      { text: "diff", toolCalls: [{ name: "git.diff", args: {} }] },
      { text: "repaired" },
    ]);
    const run = await start({
      workspace,
      provider,
      mode: "controlled",
      goal: "Fix the failing greet test.",
    }).done;
    assert.strictEqual(run.lifecycle, "completed");
    assert.ok(run.diagnoses.some((item) => item.class === "bad_code" && item.next === "repair"));
    assert.strictEqual(diagnose({ name: "tests.run" }, { ok: false, error: { code: "exit_status" } }).class, "bad_code");
    assert.strictEqual(run.repairs.length, 1);
    assert.strictEqual(run.verification.status, "passed");
  });

  await test("a model timeout during active repair retries once with compact evidence", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-timeout-repair-"));
    fs.writeFileSync(path.join(workspace, "README.md"), "repair context\n", "utf8");

    const provider = new ScriptedModelProvider([]);
    let callNumber = 0;
    provider.complete = async function complete(input) {
      this.calls.push(input);
      callNumber += 1;
      if (callNumber === 1) return { text: "not verified yet", toolCalls: [] };
      if (callNumber === 2) throw Object.assign(new Error("model request timed out"), { code: "timeout" });
      if (callNumber === 3) {
        return {
          text: "continuing from compact evidence",
          toolCalls: [{ name: "file.read", args: { path: "README.md" } }],
        };
      }
      return { text: "repair verified", toolCalls: [] };
    };

    const run = await start({
      workspace,
      provider,
      mode: "controlled",
      goal: "Fix the project and verify it.",
      verify(runState, text) {
        const read = runState.toolCalls.some((call) => (
          call.name === "file.read"
          && call.args
          && call.args.path === "README.md"
          && call.result
          && call.result.ok
        ));
        return read && text.includes("repair verified")
          ? { status: "passed", summary: "repair recovered after timeout", evidence: ["file.read"] }
          : { status: "failed", summary: "repair evidence is still missing", evidence: [] };
      },
    }).done;

    assert.strictEqual(run.lifecycle, "completed");
    assert.strictEqual(run.modelTimeoutRetriesUsed, 1);
    assert.strictEqual(run.timeoutRetryPending, false);
    assert.ok(run.events.some((event) => event.type === "model_timeout_retry" && event.attempt === 1));
    assert.strictEqual(provider.calls.length, 4);
    const retryCall = provider.calls[2];
    const retryText = retryCall.messages.map((message) => String(message.content || "")).join("\n");
    assert.ok(retryText.includes("MODEL TIMEOUT RECOVERY TURN"));
    assert.ok(retryText.includes("repair evidence is still missing"));
    assert.ok(retryText.length < 12000);
  });

  await test("a second model timeout after the bounded repair retry fails cleanly", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-timeout-stop-"));
    fs.writeFileSync(path.join(workspace, "README.md"), "repair context\n", "utf8");

    const provider = new ScriptedModelProvider([]);
    let callNumber = 0;
    provider.complete = async function complete(input) {
      this.calls.push(input);
      callNumber += 1;
      if (callNumber === 1) return { text: "not verified yet", toolCalls: [] };
      throw Object.assign(new Error("model request timed out"), { code: "timeout" });
    };

    const run = await start({
      workspace,
      provider,
      mode: "controlled",
      goal: "Fix the project and verify it.",
      verify() {
        return { status: "failed", summary: "repair evidence is still missing", evidence: [] };
      },
    }).done;

    assert.strictEqual(run.lifecycle, "failed");
    assert.strictEqual(run.error.code, "timeout");
    assert.strictEqual(run.modelTimeoutRetriesUsed, 1);
    assert.strictEqual(provider.calls.length, 3);
    assert.strictEqual(run.events.filter((event) => event.type === "model_timeout_retry").length, 1);
  });

  await test("missing credentials pause the run instead of inventing a secret", async () => {
    const host = createWorkspaceHost(FIXTURE);
    const tools = new ControlledToolProvider(host);
    const registry = new ToolRegistry({
      async call(name, args) {
        if (name === "file.write" && args && args.path === ".env") {
          return { ok: false, tool: name, error: { code: "credentials_required", message: "token missing" } };
        }
        return tools.call(name, args);
      },
      definitions() {
        return tools.definitions();
      },
    });
    const provider = new ScriptedModelProvider([
      { text: "need a token", toolCalls: [{ name: "file.write", args: { path: ".env", contents: "TOKEN=\n" } }] },
      { text: "should not run" },
    ]);
    const run = await start({
      provider,
      registry,
      mode: "controlled",
    }).done;
    assert.strictEqual(run.lifecycle, "awaiting_user");
    assert.strictEqual(run.outcome.reason, "credentials");
    assert.strictEqual(run.decisions.length, 1);
    assert.ok(!run.filesChanged.includes(".env"));
  });

  await test("cancellation is an interruption that does not resume", async () => {
    const provider = new ScriptedModelProvider([{
      waitForAbort: true,
    }]);
    provider.complete = async function complete(input) {
      this.calls.push(input);
      await new Promise((resolve, reject) => {
        const fail = () => reject(Object.assign(new Error("model call cancelled"), { code: "cancelled" }));
        if (input.signal && input.signal.aborted) return fail();
        input.signal.addEventListener("abort", fail);
      });
    };
    const handle = start({ provider, goal: "Inspect the repository." });
    handle.cancel();
    const run = await handle.done;
    assert.strictEqual(run.lifecycle, "cancelled");
    const again = await require("../index.js").resumeRun(run.id, {
      provider,
      registry: new ToolRegistry(new ControlledToolProvider(createWorkspaceHost(FIXTURE))),
      store: handle.store,
    });
    assert.strictEqual(again.lifecycle, "cancelled");
  });

  await test("a write without a later test is not complete", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-hardening-evidence-"));
    fs.cpSync(FIXTURE, workspace, { recursive: true });
    const provider = new ScriptedModelProvider([
      { text: "write", toolCalls: [{ name: "file.write", args: { path: "src/greet.js", contents: "module.exports = { greet() { return \"Hi\"; } };\n" } }] },
      { text: "I am done" },
    ]);
    const run = await start({
      workspace,
      provider,
      mode: "controlled",
      maxIterations: 2,
      goal: "Edit greet.",
    }).done;
    assert.strictEqual(run.lifecycle, "failed");
    assert.ok(run.verification.summary.includes("later passing test"));
  });

  if (process.exitCode) process.exit(process.exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
