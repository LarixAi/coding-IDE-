const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ModelProvider, RunStore, ToolRegistry, ReadOnlyToolProvider, ControlledToolProvider } = require("../../../packages/agent-runtime");
const { composerKeyAction, composerStage, composerActivity, compactTools, compactRunStream, linePreview, diffsByFile, formatGoal, droppedPaths, droppedPathValue, browserDropFiles, composerVoiceAction, normalizeComposerMode, agentModeFor, looksLikeWorkspaceEdit, isProgressTalk } = require("../composer-client");
const { describeFileRead } = require("../image-meta");
const { ComposerSession, checkAttachment, importAttachment, workspaceRelative, listOllamaModels, finalAssistantText, modelTurnBudget } = require("../composer-session");
const { OllamaModelProvider } = require("../../../packages/agent-runtime/model-provider");
const { renderComposer } = require("../composer-view");
const { ConversationStore } = require("../conversation-store");

const ANCHOR = "codeme-attachment-anchor-not-inlined";

class ScriptedModel extends ModelProvider {
  constructor(steps) {
    super("scripted");
    this.steps = [...steps];
    this.models = [];
    this.calls = [];
  }

  async complete(input) {
    this.calls.push(input);
    this.models.push(input.model);
    if (input.signal && input.signal.aborted) {
      throw Object.assign(new Error("model call cancelled"), { code: "cancelled" });
    }
    const step = this.steps.shift();
    if (!step) throw Object.assign(new Error("no decision"), { code: "model_disconnected" });
    if (step.fail) {
      throw Object.assign(new Error("scripted test failure"), { code: "scripted_failure" });
    }
    if (step.wait) {
      await new Promise((resolve, reject) => {
        const fail = () => reject(Object.assign(new Error("model call cancelled"), { code: "cancelled" }));
        if (input.signal && input.signal.aborted) return fail();
        input.signal.addEventListener("abort", fail, { once: true });
      });
    }
    return { text: step.text || "", toolCalls: step.toolCalls || [] };
  }
}

function workspace(root) {
  return {
    async readFile(file) {
      return { path: file, contents: fs.readFileSync(path.join(root, file), "utf8") };
    },
    async search() { return { query: "", matches: [] }; },
    async gitStatus() { return { branch: "main", changes: [] }; },
    async gitDiff() { return { diff: "diff --git a/README.md b/README.md\n+note\n" }; },
    async diagnostics() { return { items: [] }; },
    async browserCheck(url) { return { available: false, code: "browser_unavailable", message: "none", url }; },
  };
}

function sessionFor(root, steps, models, host, extras = {}) {
  const provider = new ScriptedModel(steps);
  const seen = [];
  const selection = { value: null };
  const session = new ComposerSession({
    store: extras.store || new RunStore(path.join(root, "runs")),
    historyStore: extras.historyStore || null,
    selectionStore: {
      get: () => selection.value,
      set: (value) => { selection.value = value; },
    },
    listModels: async () => models,
    createProvider: () => provider,
    createRegistry: extras.createRegistry || (() => new ToolRegistry(new ReadOnlyToolProvider(host || workspace(root)))),
    capabilities: extras.capabilities || null,
    root,
    onChange: (snapshot) => seen.push(snapshot.stage),
  });
  return { session, provider, seen, selection };
}

async function waitFor(session, predicate) {
  const started = Date.now();
  while (Date.now() - started < 4000) {
    if (predicate(session)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out at ${session.stage} ${session.error}`);
}

async function main() {
  assert.strictEqual(composerKeyAction({ key: "Enter", shiftKey: false, isComposing: false, keyCode: 13 }), "send");
  assert.strictEqual(composerKeyAction({ key: "Enter", shiftKey: true, isComposing: false, keyCode: 13 }), "newline");
  assert.strictEqual(composerKeyAction({ key: "Enter", shiftKey: false, isComposing: true, keyCode: 13 }), "ignore");
  assert.strictEqual(composerKeyAction({ key: "Enter", shiftKey: false, isComposing: false, keyCode: 229 }), "ignore");
  assert.strictEqual(composerKeyAction({ key: "a", shiftKey: false, isComposing: false, keyCode: 65 }), "ignore");

  assert.strictEqual(composerStage({ lifecycle: "executing_tool", inFlight: { name: "repo.search" } }), "Searching");
  assert.strictEqual(composerStage({ lifecycle: "executing_tool", inFlight: { name: "file.read" } }), "Reading");
  assert.strictEqual(composerStage({ lifecycle: "completed" }), "Complete");
  assert.strictEqual(composerStage({ lifecycle: "failed" }), "Failed");
  assert.strictEqual(composerStage({ lifecycle: "cancelled" }), "Cancelled");
  assert.strictEqual(composerStage({ lifecycle: "awaiting_user" }), "Waiting");
  assert.strictEqual(composerActivity({ lifecycle: "executing_tool", inFlight: { name: "file.read", args: { path: "src/app.js" } } }), "Reading src/app.js");
  assert.strictEqual(composerActivity({ lifecycle: "executing_tool", inFlight: { name: "repo.search", args: { query: "src/" } } }), "Searching src/");
  assert.strictEqual(composerActivity({ lifecycle: "executing_tool", inFlight: { name: "browser.check", args: { url: "http://127.0.0.1:4173/" } } }), "Checking http://127.0.0.1:4173/");
  assert.strictEqual(composerActivity({ lifecycle: "executing_tool", inFlight: { name: "process.start", args: { command: "npm start" } } }), "Starting preview process…");
  assert.strictEqual(composerActivity({ lifecycle: "executing_tool", inFlight: { name: "workspace.inspect", args: {} } }), "Inspecting workspace…");
  assert.strictEqual(composerActivity({ lifecycle: "executing_tool", inFlight: { name: "dir.create", args: { path: "src" } } }), "Creating folder src");
  assert.strictEqual(composerActivity({ lifecycle: "verifying" }), "Verifying");

  const createdPreview = linePreview(null, "<h1>Hello CodeMe</h1>\n");
  assert.strictEqual(createdPreview.additions, 1);
  assert.strictEqual(createdPreview.removals, 0);
  assert.strictEqual(createdPreview.lines[0].type, "add");

  const editedPreview = linePreview("const value = 1;\n", "const value = 2;\n");
  assert.strictEqual(editedPreview.additions, 1);
  assert.strictEqual(editedPreview.removals, 1);
  assert.ok(editedPreview.lines.some((line) => line.type === "remove" && line.text.includes("1")));
  assert.ok(editedPreview.lines.some((line) => line.type === "add" && line.text.includes("2")));

  const liveWrite = compactTools({
    workspace: { state: "empty" },
    toolCalls: [],
    inFlight: {
      kind: "tool",
      name: "file.write",
      args: { path: "index.html", contents: "<h1>Hello CodeMe</h1>\n" },
    },
  });
  assert.strictEqual(liveWrite.length, 1);
  assert.strictEqual(liveWrite[0].status, "running");
  assert.strictEqual(liveWrite[0].operation, "create");
  assert.strictEqual(liveWrite[0].path, "index.html");
  assert.strictEqual(liveWrite[0].preview.additions, 1);

  const patchCard = compactTools({
    workspace: { state: "project" },
    toolCalls: [],
    inFlight: {
      kind: "tool",
      name: "file.patch",
      args: { path: "src/app.js", oldText: "const value = 1;", newText: "const value = 2;" },
    },
  });
  assert.strictEqual(patchCard.length, 1);
  assert.strictEqual(patchCard[0].status, "running");
  assert.strictEqual(patchCard[0].operation, "edit");
  assert.strictEqual(patchCard[0].preview.additions, 1);
  assert.strictEqual(patchCard[0].preview.removals, 1);

  const processCard = compactTools({
    toolCalls: [],
    inFlight: { kind: "tool", name: "process.start", args: { command: "npm start" } },
  });
  assert.strictEqual(processCard[0].name, "process.start");
  assert.strictEqual(processCard[0].status, "running");

  const mixedProtocolStream = compactRunStream({
    decisions: [{
      iteration: 1,
      text: 'First, let\'s check the HTML content.\n{"name":"file_read","arguments":{"path":"public/index.html"}}',
      toolCalls: [{ name: "file.read", args: { path: "public/index.html" } }],
    }],
    toolCalls: [{
      iteration: 1,
      name: "file.read",
      args: { path: "public/index.html" },
      result: { ok: true, data: { path: "public/index.html", contents: "<h1>Test</h1>" } },
    }],
  });
  const mixedNarration = mixedProtocolStream.find((item) => item.type === "narration");
  assert.ok(mixedNarration);
  assert.ok(mixedNarration.text.includes("First, let's check the HTML content."));
  assert.ok(!mixedNarration.text.includes("file_read"));
  assert.ok(!mixedNarration.text.includes('"arguments"'));

  const repeatedWrite = compactTools({
    workspace: { state: "project" },
    toolCalls: [
      {
        name: "file.read",
        args: { path: "src/app.js" },
        result: { ok: true, data: { contents: "const value = 1;\n" } },
      },
      {
        name: "file.write",
        args: { path: "src/app.js", contents: "const value = 2;\n" },
        result: { ok: true, data: { path: "src/app.js" } },
      },
    ],
    inFlight: {
      kind: "tool",
      name: "file.write",
      args: { path: "src/app.js", contents: "const value = 3;\n" },
    },
  });
  const secondEdit = repeatedWrite[repeatedWrite.length - 1];
  assert.strictEqual(secondEdit.operation, "edit");
  assert.ok(secondEdit.preview.lines.some((line) => line.type === "remove" && line.text.includes("2")));
  assert.ok(secondEdit.preview.lines.some((line) => line.type === "add" && line.text.includes("3")));


  const stream = compactRunStream({
    decisions: [{
      iteration: 1,
      text: "I found the button handler. I’ll update the page and verify it.",
      toolCalls: [{ name: "file.patch" }],
    }],
    toolCalls: [{
      iteration: 1,
      directedBy: "model",
      name: "file.patch",
      args: { path: "src/app.js", oldText: "old", newText: "new" },
      result: { ok: true, data: { path: "src/app.js" } },
    }],
  });
  assert.strictEqual(stream[0].type, "narration");
  assert.ok(stream[0].text.includes("update the page"));
  assert.strictEqual(stream[1].type, "tool");
  assert.strictEqual(stream[1].name, "file.patch");

  const quietContextStream = compactRunStream({
    decisions: [],
    toolCalls: [{
      iteration: 0,
      directedBy: "context",
      name: "workspace.inspect",
      args: {},
      result: { ok: true, data: { state: "project" } },
    }],
  });
  assert.deepStrictEqual(quietContextStream, []);

  const files = diffsByFile("diff --git a/src/app.js b/src/app.js\n+ok\n", ["src/app.js"]);
  assert.strictEqual(files[0].path, "src/app.js");
  assert.ok(files[0].diff.includes("+ok"));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-composer-"));
  fs.mkdirSync(path.join(root, "runs"));
  fs.writeFileSync(path.join(root, "README.md"), `${ANCHOR}\n`);
  fs.writeFileSync(path.join(root, "notes.txt"), "notes\n");
  const outside = path.join(os.tmpdir(), "codeme-outside.txt");
  fs.writeFileSync(outside, "secret\n");

  assert.strictEqual(workspaceRelative(root, "../codeme-outside.txt"), "");
  assert.strictEqual(workspaceRelative(root, outside), "");
  assert.strictEqual(workspaceRelative(root, "README.md"), "README.md");
  const escaped = checkAttachment(root, { path: outside, name: "codeme-outside.txt", size: 7 }, []);
  assert.strictEqual(escaped.ok, false);
  assert.strictEqual(escaped.code, "path_escape");
  assert.strictEqual(checkAttachment(root, { path: "README.md", kind: "folder", size: 1 }, []).code, "reserved");
  fs.writeFileSync(path.join(root, "shot.png"), "png");
  const image = checkAttachment(root, { path: "shot.png", name: "shot.png", size: 3, type: "image/png" }, []);
  assert.strictEqual(image.ok, true);
  assert.strictEqual(image.attachment.kind, "image");
  const pdf = checkAttachment(root, { path: "README.md", name: "notes.pdf", size: 12, type: "application/pdf" }, []);
  assert.strictEqual(pdf.ok, true);
  assert.strictEqual(pdf.attachment.kind, "pdf");
  const imported = importAttachment(root, { path: outside, name: "codeme-outside.txt", size: 7, type: "text/plain" }, []);
  assert.strictEqual(imported.ok, true);
  assert.ok(imported.attachment.path.startsWith(".codeme/inbox/"));
  assert.ok(fs.existsSync(path.join(root, imported.attachment.path)));
  const droppedBytes = importAttachment(root, { name: "drop.png", type: "image/png", contents: Buffer.from("png").toString("base64") }, []);
  assert.strictEqual(droppedBytes.ok, true);
  assert.strictEqual(droppedBytes.attachment.kind, "image");
  assert.strictEqual(composerVoiceAction(false, false), "unavailable");
  assert.strictEqual(composerVoiceAction(false, true), "start");
  assert.strictEqual(composerVoiceAction(true, true), "stop");

  const attached = checkAttachment(root, { path: path.join(root, "README.md"), name: "README.md", size: 12, type: "text/markdown" }, []);
  assert.strictEqual(attached.ok, true);
  assert.strictEqual(attached.attachment.path, "README.md");
  const goal = formatGoal("Explain the readme", [attached.attachment]);
  assert.ok(goal.includes("README.md"));
  assert.ok(!goal.includes(ANCHOR));

  const html = renderComposer("nonce-value");
  assert.ok(html.includes("nonce-nonce-value"));
  assert.ok(html.includes("composerKeyAction"));
  assert.ok(html.includes("Ask CodeMe anything, @ files or type /"));
  assert.ok(html.includes("id=\\\"mic\\\"") || html.includes('id="mic"'));
  assert.ok(html.includes("split(/\\r?\\n/)"));
  assert.ok(html.includes("select-mode"));
  assert.ok(html.includes(">Chat<"));
  assert.ok(!html.includes(">Ask<"));
  assert.ok(html.includes(">Plan<"));
  assert.ok(html.includes(">Code<"));
  assert.ok(html.includes(">Debug<"));
  assert.ok(html.includes(">Multitask<"));
  assert.ok(!html.includes("Read-only"));
  assert.ok(html.includes("ResourceURLs"));
  assert.ok(html.includes("browserDropFiles"));
  assert.ok(html.includes("getAsFile"));
  assert.ok(html.includes("Adding dropped files"));
  assert.ok(html.includes("dataset.source"));
  assert.ok(html.includes("code-preview"));
  assert.ok(html.includes("tool-stats"));
  assert.ok(html.includes("work-note"));
  assert.ok(html.includes('id="changed-files"'));
  assert.ok(html.includes("renderChangedFiles"));
  assert.ok(html.includes('send.title = running ? "Add follow-up" : "Send"'));
  assert.ok(!html.includes("if (sending || running) return;"));
  assert.ok(html.includes("project-decision"));
  assert.ok(html.includes("renderProjectDecision"));
  assert.ok(html.includes("No dependencies required"));
  assert.ok(html.includes("Created "));
  assert.ok(html.includes("Edited "));
  assert.ok(html.includes("Preview process"));
  assert.ok(html.includes('id="new-chat"'));
  assert.ok(html.includes('id="history-toggle"'));
  assert.ok(html.includes('id="history-panel"'));
  assert.ok(html.includes("Chat history"));
  assert.ok(html.includes("deferredFinal"));
  assert.ok(html.includes("function renderThread(items, deferLastAssistant)"));
  assert.ok(html.includes("if (deferredFinal)"));
  assert.ok(html.includes("clearSendPending"));
  assert.ok(html.includes('message.type === "submitting"'));
  assert.ok(html.includes('message.type === "accepted" && current(message)'));
  assert.ok(!html.includes("sameRequest("));
  assert.ok(html.includes("Verification issue"));
  assert.ok(!html.includes("qwen3.5:9b"));
  assert.ok(!html.includes("workbench.action.chat.open"));
  assert.ok(html.includes("@media (max-width: 380px)"));
  assert.ok(html.includes("grid-template-columns: 26px 30px 30px minmax(0, 1fr) 24px 24px"));
  assert.ok(html.includes("#model { grid-column: 1 / 6; grid-row: 2;"));
  assert.ok(html.includes("#send { grid-column: 6; grid-row: 1; margin: 0; }"));
  assert.ok(html.includes("#history-toggle::before { content: \"☰\";"));
  assert.ok(html.includes('<details class="changed-files" id="changed-files"></details>'));
  assert.ok(html.includes("changedFiles.open = files.length <= 6"));
  assert.ok(html.includes("changed-body"));
  assert.ok(html.includes("rest = rest.slice(next);"));
  assert.strictEqual(modelTurnBudget("code", "Create this folder and file layout for my website project structure"), 48);
  assert.strictEqual(modelTurnBudget("code", "Fix the button and verify it"), 20);
  assert.strictEqual(modelTurnBudget("ask", "Create this folder and file layout"), 12);

  const explorerDrop = droppedPaths({
    getData(name) {
      if (name === "ResourceURLs") return JSON.stringify(["file:///tmp/ws/README.md", "file:///tmp/ws/notes.txt"]);
      return "";
    },
  });
  assert.strictEqual(explorerDrop.length, 2);
  assert.strictEqual(explorerDrop[0].path, "file:///tmp/ws/README.md");

  const objectPayloadDrop = droppedPaths({
    getData(name) {
      if (name === "ResourceURLs") {
        return JSON.stringify([
          { resourceUri: "file:///tmp/ws/one.png" },
          { uri: "file:///tmp/ws/two.png" },
          { path: "/tmp/ws/three.png" },
        ]);
      }
      return "";
    },
  });
  assert.deepStrictEqual(objectPayloadDrop.map((item) => item.path), [
    "file:///tmp/ws/one.png",
    "file:///tmp/ws/two.png",
    "/tmp/ws/three.png",
  ]);
  assert.strictEqual(droppedPathValue({ fsPath: "/tmp/ws/four.png" }), "/tmp/ws/four.png");

  const itemFiles = [
    { name: "one.png", size: 1, type: "image/png" },
    { name: "two.png", size: 2, type: "image/png" },
    { name: "three.png", size: 3, type: "image/png" },
  ];
  const browserFiles = browserDropFiles({
    items: itemFiles.map((file) => ({ kind: "file", getAsFile: () => file })),
    files: [{ name: "fallback-only.png" }],
  });
  assert.strictEqual(browserFiles.length, 3);
  assert.deepStrictEqual(browserFiles.map((file) => file.name), ["one.png", "two.png", "three.png"]);

  const fileListFallback = browserDropFiles({
    items: [{ kind: "string", getAsFile: () => null }],
    files: [{ name: "a.txt" }, { name: "b.txt" }],
  });
  assert.deepStrictEqual(fileListFallback.map((file) => file.name), ["a.txt", "b.txt"]);

  assert.ok(!droppedPaths({
    getData(name) { return name === "text/plain" ? "/tmp/outside.txt" : ""; },
  }).some((item) => item.path === "file:///tmp/ws/README.md"));

  const fromProvider = await new OllamaModelProvider().listModels();
  const fromShell = await listOllamaModels();
  assert.ok(fromProvider.some((model) => model.id === "qwen3.5:9b"));
  assert.ok(fromProvider.every((model) => model.provider === "ollama" && model.id));
  assert.deepStrictEqual(fromShell.map((model) => model.id).sort(), fromProvider.map((model) => model.id).sort());

  const models = [
    { provider: "ollama", id: "qwen3.5:9b", label: "Qwen 3.5 9B" },
    { provider: "ollama", id: "llama3.2:3b", label: "Llama 3.2 3B" },
  ];
  const first = sessionFor(root, [
    { toolCalls: [{ name: "file.read", args: { path: "README.md" } }] },
    { text: `The file says ${ANCHOR}` },
  ], models);
  await first.session.refreshModels();
  assert.strictEqual(first.session.selected.id, "qwen3.5:9b");
  assert.strictEqual(first.session.selectModel("ollama", "llama3.2:3b").ok, true);
  assert.strictEqual(first.selection.value.id, "llama3.2:3b");
  assert.strictEqual(normalizeComposerMode("read_only"), "ask");
  assert.strictEqual(normalizeComposerMode("chat"), "ask");
  assert.strictEqual(normalizeComposerMode("ask"), "ask");
  assert.strictEqual(normalizeComposerMode("debug"), "debug");
  assert.strictEqual(normalizeComposerMode("multitask"), "multitask");
  assert.strictEqual(agentModeFor("chat"), "read_only");
  assert.strictEqual(agentModeFor("ask"), "read_only");
  assert.strictEqual(agentModeFor("plan"), "read_only");
  assert.strictEqual(agentModeFor("code"), "controlled");
  assert.strictEqual(agentModeFor("debug"), "controlled");
  assert.strictEqual(agentModeFor("multitask"), "read_only");
  assert.strictEqual(first.session.selectMode("plan").ok, true);
  assert.strictEqual(first.session.composerMode, "plan");
  assert.strictEqual(first.session.mode, "read_only");
  assert.strictEqual(first.session.selectMode("code").ok, true);
  assert.strictEqual(first.session.composerMode, "code");
  assert.strictEqual(first.session.mode, "controlled");
  first.session.projectDecision = {
    kind: "static_site",
    label: "Static website",
    workspaceState: "empty",
    framework: null,
    dependenciesRequired: false,
    reason: "No framework is needed.",
  };
  const decisionSnapshot = first.session.snapshot();
  assert.strictEqual(decisionSnapshot.projectDecision.kind, "static_site");
  assert.strictEqual(decisionSnapshot.projectDecision.dependenciesRequired, false);
  const chip = first.session.attach({ path: "README.md", name: "README.md", size: 12, type: "text/markdown" });
  assert.strictEqual(first.session.detach(chip.attachment.id).ok, true);
  assert.strictEqual(first.session.attachments.length, 0);
  assert.strictEqual(first.session.attach({ path: "README.md", name: "README.md", size: 12, type: "text/markdown" }).ok, true);
  assert.strictEqual(first.session.attach({ path: "notes.txt", name: "notes.txt", size: 6, type: "text/plain" }).ok, true);
  assert.strictEqual(first.session.attachments.length, 2);
  const outsideChip = first.session.attach({ path: outside, name: "codeme-outside.txt", size: 7 });
  assert.strictEqual(outsideChip.ok, true);
  assert.ok(outsideChip.attachment.path.startsWith(".codeme/inbox/"));
  assert.strictEqual(first.session.detach(outsideChip.attachment.id).ok, true);
  assert.strictEqual(first.session.detach(first.session.attachments[1].id).ok, true);
  assert.strictEqual(first.session.attachments.length, 1);
  const started = await first.session.submit("Explain the readme", 1);
  assert.strictEqual(started.ok, true);
  assert.strictEqual(first.session.epoch, 1);
  assert.ok(/^run_/.test(started.runId));
  assert.strictEqual(started.model, "llama3.2:3b");
  assert.strictEqual(started.provider, "ollama");
  assert.strictEqual(started.mode, "controlled");
  assert.strictEqual(started.composerMode, "code");
  await waitFor(first.session, (item) => item.stage === "Complete" && !item.running);
  assert.ok(first.seen.includes("Reading"));
  assert.ok(first.provider.models.every((model) => model === "llama3.2:3b"));
  const saved = JSON.parse(fs.readFileSync(path.join(root, "runs", `${started.runId}.json`), "utf8"));
  assert.ok(saved.goal.includes("README.md"));
  assert.ok(!saved.goal.includes(ANCHOR));
  assert.ok(Array.isArray(saved.attachments));
  assert.strictEqual(saved.attachments[0].path, "README.md");
  assert.ok(!JSON.stringify(saved.attachments).includes(ANCHOR));
  assert.ok(saved.observations.some((item) => item.tool === "file.read"));
  assert.strictEqual(saved.mode, "controlled");
  assert.strictEqual(saved.effectiveModel, "llama3.2:3b");
  assert.ok(saved.strategyRecord && saved.strategyRecord.id);
  assert.strictEqual(first.session.detach("missing").ok, false);

  const research = sessionFor(root, [
    { text: "Reading the readme first.", toolCalls: [{ name: "file.read", args: { path: "README.md" } }] },
    { wait: true },
  ], models);
  await research.session.refreshModels();
  const researching = await research.session.submit("research the readme");
  assert.strictEqual(researching.ok, true);
  await waitFor(research.session, (item) => item.tools.some((tool) => tool.name === "file.read"));
  assert.ok(research.session.thread.some((item) => item.role === "user" && item.text.includes("research the readme")));
  assert.ok(research.session.activity.includes("Reading the readme") || research.session.tools.some((tool) => tool.name === "file.read"));
  research.session.cancel();
  await waitFor(research.session, (item) => item.stage === "Cancelled" && !item.running);
  assert.ok(research.session.outcome.summary.includes("README.md"));
  assert.ok(!research.session.verification);

  const hanging = sessionFor(root, [{ wait: true }], models);
  await hanging.session.refreshModels();
  const live = await hanging.session.submit("wait", 2);
  assert.strictEqual(live.ok, true);
  const followUp = await hanging.session.submit("again", 3);
  assert.strictEqual(followUp.ok, true);
  assert.strictEqual(followUp.followUp, true);
  assert.strictEqual(followUp.requestId, live.requestId);
  assert.strictEqual(followUp.runId, live.runId);
  assert.strictEqual(hanging.session.epoch, 3);
  assert.ok(hanging.session.thread.some((item) => item.role === "user" && item.text === "again"));
  const cancelled = hanging.session.cancel();
  assert.strictEqual(cancelled.ok, true);
  await waitFor(hanging.session, (item) => item.stage === "Cancelled" && !item.running);

  const failing = sessionFor(root, [
    { fail: true },
    { fail: true },
  ], models);
  await failing.session.refreshModels();
  const failed = await failing.session.submit("break");
  assert.strictEqual(failed.ok, true);
  await waitFor(failing.session, (item) => item.stage === "Failed" && !item.running);
  assert.strictEqual(failing.session.notice, "");
  const again = await failing.session.submit("recover");
  assert.strictEqual(again.ok, true);
  assert.notStrictEqual(again.requestId, failed.requestId);
  await waitFor(failing.session, (item) => item.requestId === again.requestId && item.stage === "Failed" && !item.running);

  const previewHost = workspace(root);
  previewHost.browserCheck = async (url) => ({ available: true, statusCode: 200, title: "Car Bid Dealership", url });
  const preview = sessionFor(root, [
    { toolCalls: [{ name: "browser.check", args: { url: "http://127.0.0.1:4173/" } }] },
    { text: "The site is running at http://127.0.0.1:4173/" },
  ], models, previewHost);
  await preview.session.refreshModels();
  const previewed = await preview.session.submit("run the website");
  assert.strictEqual(previewed.ok, true);
  await waitFor(preview.session, (item) => item.stage === "Complete" && !item.running);
  assert.ok(preview.seen.includes("Testing"));
  const previewRun = JSON.parse(fs.readFileSync(path.join(root, "runs", `${previewed.runId}.json`), "utf8"));
  assert.ok(previewRun.observations.some((item) => item.tool === "browser.check" && item.ok));

  const recovered = sessionFor(root, [
    { text: "ok after read", toolCalls: [{ name: "file.read", args: { path: "README.md" } }] },
    { text: "done" },
    { text: "second answer", toolCalls: [{ name: "file.read", args: { path: "README.md" } }] },
    { text: "second done" },
    { text: "third answer" },
  ], models);
  await recovered.session.refreshModels();
  const second = await recovered.session.submit("try again");
  assert.strictEqual(second.ok, true);
  await waitFor(recovered.session, (item) => !item.running && item.stage === "Complete");
  assert.ok(recovered.session.thread.some((item) => item.role === "user" && item.text === "try again"));
  assert.ok(recovered.session.thread.some((item) => item.role === "assistant" && item.text === "done"));

  const callsBeforeFollowUp = recovered.provider.calls.length;
  const third = await recovered.session.submit("follow up");
  assert.strictEqual(third.ok, true);
  assert.notStrictEqual(third.runId, second.runId);
  await waitFor(recovered.session, (item) => item.runId === third.runId && !item.running && item.stage === "Complete");

  assert.ok(recovered.session.thread.some((item) => item.role === "user" && item.text === "try again"));
  assert.ok(recovered.session.thread.some((item) => item.role === "assistant" && item.text === "done"));
  assert.ok(recovered.session.thread.some((item) => item.role === "user" && item.text === "follow up"));
  assert.ok(recovered.session.thread.some((item) => item.role === "assistant" && item.text === "second done"));

  const followUpContext = recovered.provider.calls[callsBeforeFollowUp].messages.map((message) => message.content || "").join("\n");
  assert.ok(followUpContext.includes("try again"));
  assert.ok(followUpContext.includes("done"));
  recovered.session.publish(second.requestId, { id: second.runId, lifecycle: "executing_tool", inFlight: { name: "file.read" }, filesChanged: ["stale.md"], toolCalls: [], outcome: null });
  assert.strictEqual(recovered.session.runId, third.runId);
  assert.ok(!recovered.session.filesChanged.includes("stale.md"));

  const historyDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-chat-history-"));
  const historyStore = new ConversationStore(historyDirectory);
  const persistent = sessionFor(root, [
    { toolCalls: [{ name: "file.read", args: { path: "README.md" } }] },
    { text: "First saved answer" },
    { toolCalls: [{ name: "file.read", args: { path: "README.md" } }] },
    { text: "Second saved answer" },
  ], models, null, { historyStore });
  await persistent.session.refreshModels();

  const firstChatRun = await persistent.session.submit("First saved question");
  assert.strictEqual(firstChatRun.ok, true);
  await waitFor(persistent.session, (item) => item.stage === "Complete" && !item.running);
  const firstChatId = persistent.session.conversationId;
  assert.ok(/^chat_/.test(firstChatId));
  assert.ok(persistent.session.thread.some((item) => item.text === "First saved question"));
  assert.ok(persistent.session.thread.some((item) => item.text === "First saved answer"));
  assert.strictEqual(persistent.session.snapshot().conversations.length, 1);

  assert.strictEqual(persistent.session.newChat().ok, true);
  assert.strictEqual(persistent.session.conversationId, "");
  assert.deepStrictEqual(persistent.session.thread, []);

  const secondChatRun = await persistent.session.submit("Second saved question");
  assert.strictEqual(secondChatRun.ok, true);
  await waitFor(persistent.session, (item) => item.stage === "Complete" && !item.running);
  const secondChatId = persistent.session.conversationId;
  assert.notStrictEqual(secondChatId, firstChatId);
  assert.strictEqual(persistent.session.snapshot().conversations.length, 2);

  assert.strictEqual(persistent.session.openChat(firstChatId).ok, true);
  assert.strictEqual(persistent.session.conversationId, firstChatId);
  assert.ok(persistent.session.thread.some((item) => item.text === "First saved question"));
  assert.ok(persistent.session.thread.some((item) => item.text === "First saved answer"));
  assert.ok(!persistent.session.thread.some((item) => item.text === "Second saved question"));

  const restored = sessionFor(root, [], models, null, { historyStore });
  assert.strictEqual(restored.session.conversationId, firstChatId);
  assert.ok(restored.session.thread.some((item) => item.text === "First saved question"));
  assert.strictEqual(restored.session.snapshot().conversations.length, 2);

  const stale = sessionFor(root, [
    { toolCalls: [{ name: "file.read", args: { path: "README.md" } }] },
    { text: "answered" },
    { wait: true },
  ], models);
  await stale.session.refreshModels();
  const old = await stale.session.submit("first", 4);
  await waitFor(stale.session, (item) => item.stage === "Complete");
  const next = await stale.session.submit("second", 5);
  stale.session.publish(old.requestId, { id: old.runId, lifecycle: "executing_tool", inFlight: { name: "file.read" }, filesChanged: ["nope.md"], toolCalls: [], outcome: null });
  assert.strictEqual(stale.session.requestId, next.requestId);
  assert.strictEqual(stale.session.runId, next.runId);
  assert.ok(!stale.session.filesChanged.includes("nope.md"));
  stale.session.cancel();
  await waitFor(stale.session, (item) => item.runId === next.runId && item.stage === "Cancelled" && !item.running);

  assert.strictEqual(isProgressTalk("Let me search for HTML files"), true);
  assert.strictEqual(isProgressTalk("Great! I found your website files."), true);
  assert.strictEqual(isProgressTalk("Great, I found the current pages."), true);
  assert.strictEqual(isProgressTalk("The layout now uses a tighter header and a two-column showroom."), false);
  assert.strictEqual(looksLikeWorkspaceEdit("make a better website layout"), true);
  assert.strictEqual(looksLikeWorkspaceEdit("implement the repair and verify with tests"), true);
  assert.strictEqual(looksLikeWorkspaceEdit("can you fix the website the css is not working on all pages"), true);
  assert.strictEqual(looksLikeWorkspaceEdit("build me a responsive dealership website"), true);
  const inventoryText = finalAssistantText({
    lifecycle: "completed",
    taskClass: "inspect",
    filesChanged: [],
    toolCalls: [{
      name: "dir.list",
      result: {
        ok: true,
        data: {
          entries: [
            { path: "index.html", type: "file" },
            { path: "package.json", type: "file" },
            { path: "server.js", type: "file" },
          ],
        },
      },
    }],
    outcome: {
      summary: "The workspace contains three files.\n\nThe workspace contains three files.",
    },
  });
  assert.strictEqual(
    inventoryText,
    "This project contains 3 files:\n• `index.html`\n• `package.json`\n• `server.js`",
  );

  const editText = finalAssistantText({
    lifecycle: "completed",
    taskClass: "bug-fix",
    filesChanged: ["index.html"],
    verification: {
      status: "passed",
      evidence: ["file.patch", "file.read", "browser.check"],
    },
  });
  assert.strictEqual(
    editText,
    "Done — I applied the requested change to `index.html` and verified the result in the browser.",
  );

  const failedWithProtocolNoise = finalAssistantText({
    lifecycle: "failed",
    taskClass: "bug-fix",
    filesChanged: ["public/script.js"],
    outcome: {
      summary: [
        'Verification is still failing.',
        '',
        '\`\`\`json',
        '{"name":"file_write","arguments":{"path":"public/script.js","content":"ignored"}}',
        '\`\`\`',
      ].join("\n"),
    },
  });
  assert.ok(failedWithProtocolNoise.includes("Verification is still failing."));
  assert.ok(!failedWithProtocolNoise.includes("file_write"));
  assert.ok(!failedWithProtocolNoise.includes('"arguments"'));


  const layout = sessionFor(root, [
    { toolCalls: [{ name: "file.read", args: { path: "README.md" } }] },
    { text: "1. Restyle the header\n2. Tighten the hero\n3. Switch to Code to apply edits" },
  ], models);
  await layout.session.refreshModels();
  assert.strictEqual(layout.session.composerMode, "ask");
  const planned = await layout.session.submit("make a better website layout");
  assert.strictEqual(planned.ok, true);
  assert.strictEqual(layout.session.notice, "Switch to Code to apply file edits");
  assert.strictEqual(layout.session.mode, "read_only");
  await waitFor(layout.session, (item) => item.stage === "Complete" && !item.running);

  const hubState = { invocations: [] };
  const hub = {
    async listCapabilities() {
      return [
        { name: "hub.health", description: "Echo a short token and report hub health" },
        { name: "research.problem", description: "Gather short evidence for a problem. Returns sources and excerpts." },
        { name: "knowledge.lookup", description: "Find a prior note by query, or remember a short note." },
        { name: "task.decompose", description: "Split a large goal into a bounded task graph." },
      ];
    },
    async invoke(request) {
      hubState.invocations.push(request.capability);
      return {
        protocolVersion: 1,
        requestId: request.requestId,
        status: "ok",
        data: {
          problem: request.input && (request.input.problem || request.input.question),
          evidence: [{ title: "Site notes", url: "https://example.com", excerpt: "The workspace site is a dealership preview", source: "test" }],
        },
        sources: [],
        warnings: [],
        error: null,
        duration: 3,
      };
    },
  };
  const researched = sessionFor(root, [
    { text: "Reading the site first.", toolCalls: [{ name: "file.read", args: { path: "README.md" } }] },
    { text: "The workspace site is a dealership preview." },
  ], models, null, { capabilities: hub });
  await researched.session.refreshModels();
  const asked = await researched.session.submit("research the website");
  assert.strictEqual(asked.ok, true);
  await waitFor(researched.session, (item) => item.stage === "Complete" && !item.running);
  const researchRun = JSON.parse(fs.readFileSync(path.join(root, "runs", `${asked.runId}.json`), "utf8"));
  assert.ok(researchRun.observations.some((item) => item.type === "capability" && item.capability === "research.problem"));
  assert.deepStrictEqual(hubState.invocations, ["research.problem"]);

  const reread = sessionFor(root, [
    { toolCalls: [{ name: "file.read", args: { path: "README.md" } }] },
    { toolCalls: [{ name: "file.read", args: { path: "README.md" } }] },
    { text: "The readme describes the project." },
  ], models);
  await reread.session.refreshModels();
  const finished = await reread.session.submit("what does the readme say");
  assert.strictEqual(finished.ok, true);
  await waitFor(reread.session, (item) => item.stage === "Complete" && !item.running);
  const rereadRun = JSON.parse(fs.readFileSync(path.join(root, "runs", `${finished.runId}.json`), "utf8"));
  assert.ok(
    reread.provider.calls.some((call) =>
      call.messages.some((message) =>
        String(message.content).includes("ASK MODE FINAL ANSWER.")
      )
    )
  );
  assert.ok(
    rereadRun.events.some((item) =>
      item.type === "tool_repeat_suppressed"
      && item.call
      && item.call.name === "file.read"
    )
  );
  assert.strictEqual(rereadRun.lifecycle, "completed");

  const png = Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c6360000002000100ffff03000006000557bf0000000049454e44ae426082",
    "hex",
  );
  fs.mkdirSync(path.join(root, "src/styles"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/index.html"), "<html><body>old</body></html>\n");
  fs.writeFileSync(path.join(root, "src/styles/site.css"), "body{margin:0}\n");
  const layoutHost = workspace(root);
  layoutHost.writeFile = async (file, contents) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), contents);
    return { path: file, bytes: Buffer.byteLength(contents) };
  };
  layoutHost.browserCheck = async (url) => ({ url, statusCode: 200, title: "CarBid", available: true });
  const coded = sessionFor(root, [
    { text: "Let me search for HTML files", toolCalls: [{ name: "file.read", args: { path: "src/index.html" } }] },
    { text: "Reading the CSS.", toolCalls: [{ name: "file.read", args: { path: "src/styles/site.css" } }] },
    { text: "Applying a tighter layout.", toolCalls: [{ name: "file.write", args: { path: "src/index.html", contents: "<html><body><header>Showroom</header></body></html>\n" } }] },
    { text: "Checking the preview.", toolCalls: [{ name: "browser.check", args: { url: "http://127.0.0.1:4173/" } }] },
    { text: "The layout is updated on the preview." },
  ], models, layoutHost, {
    createRegistry: (mode) => new ToolRegistry(
      mode === "controlled" ? new ControlledToolProvider(layoutHost) : new ReadOnlyToolProvider(layoutHost),
    ),
  });
  await coded.session.refreshModels();
  assert.strictEqual(coded.session.selectMode("code").ok, true);
  const applied = await coded.session.submit("can you find me a better layout for my website");
  assert.strictEqual(applied.ok, true);
  await waitFor(coded.session, (item) => item.stage === "Complete" && !item.running);
  const layoutRun = JSON.parse(fs.readFileSync(path.join(root, "runs", `${applied.runId}.json`), "utf8"));
  assert.strictEqual(layoutRun.taskClass, "layout");
  assert.ok(layoutRun.toolCalls.some((call) => call.name === "file.write"));
  assert.ok(layoutRun.toolCalls.some((call) => call.name === "browser.check"));
  assert.ok(layoutRun.toolCalls.every((call) => call.name !== "capability.invoke"));
  assert.ok(!coded.session.thread.some((item) => /let me search/i.test(item.text)));
  assert.strictEqual(layoutRun.lifecycle, "completed");
  assert.strictEqual(coded.session.stage, "Complete");
  assert.ok(!coded.session.error);

  const pngRead = describeFileRead("shot.png", png);
  assert.strictEqual(pngRead.kind, "image");
  assert.strictEqual(pngRead.type, "image/png");
  assert.strictEqual(pngRead.width, 1);
  assert.strictEqual(pngRead.height, 1);
  assert.ok(!Object.prototype.hasOwnProperty.call(pngRead, "contents"));

  console.log("ok composer agent run");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
