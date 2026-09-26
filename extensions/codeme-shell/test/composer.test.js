const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ModelProvider, RunStore, ToolRegistry, ReadOnlyToolProvider } = require("../../../packages/agent-runtime");
const { composerKeyAction, composerStage, formatGoal } = require("../composer-client");
const { ComposerSession, checkAttachment, workspaceRelative } = require("../composer-session");
const { renderComposer } = require("../composer-view");

const ANCHOR = "codeme-attachment-anchor-not-inlined";

class ScriptedModel extends ModelProvider {
  constructor(steps) {
    super("scripted");
    this.steps = [...steps];
    this.models = [];
  }

  async complete(input) {
    this.models.push(input.model);
    if (input.signal && input.signal.aborted) {
      throw Object.assign(new Error("model call cancelled"), { code: "cancelled" });
    }
    const step = this.steps.shift();
    if (!step) throw Object.assign(new Error("no decision"), { code: "model_disconnected" });
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

function sessionFor(root, steps, models) {
  const provider = new ScriptedModel(steps);
  const seen = [];
  const selection = { value: null };
  const session = new ComposerSession({
    store: new RunStore(path.join(root, "runs")),
    selectionStore: {
      get: () => selection.value,
      set: (value) => { selection.value = value; },
    },
    listModels: async () => models,
    createProvider: () => provider,
    createRegistry: () => new ToolRegistry(new ReadOnlyToolProvider(workspace(root))),
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

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-composer-"));
  fs.mkdirSync(path.join(root, "runs"));
  fs.writeFileSync(path.join(root, "README.md"), `${ANCHOR}\n`);
  const outside = path.join(os.tmpdir(), "codeme-outside.txt");
  fs.writeFileSync(outside, "secret\n");

  assert.strictEqual(workspaceRelative(root, "../codeme-outside.txt"), "");
  assert.strictEqual(workspaceRelative(root, outside), "");
  assert.strictEqual(workspaceRelative(root, "README.md"), "README.md");
  const escaped = checkAttachment(root, { path: outside, name: "codeme-outside.txt", size: 7 }, []);
  assert.strictEqual(escaped.ok, false);
  assert.strictEqual(escaped.code, "path_escape");
  assert.strictEqual(checkAttachment(root, { path: "README.md", kind: "folder", size: 1 }, []).code, "reserved");
  assert.strictEqual(checkAttachment(root, { path: "README.md", type: "application/pdf", size: 1 }, []).code, "reserved");

  const attached = checkAttachment(root, { path: path.join(root, "README.md"), name: "README.md", size: 12, type: "text/markdown" }, []);
  assert.strictEqual(attached.ok, true);
  assert.strictEqual(attached.attachment.path, "README.md");
  const goal = formatGoal("Explain the readme", [attached.attachment]);
  assert.ok(goal.includes("README.md"));
  assert.ok(!goal.includes(ANCHOR));

  const html = renderComposer("nonce-value");
  assert.ok(html.includes("nonce-nonce-value"));
  assert.ok(html.includes("composerKeyAction"));
  assert.ok(html.includes("Describe the change"));
  assert.ok(html.includes("split(/\\r?\\n/)"));
  assert.ok(!html.includes("qwen3.5:9b"));

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
  const chip = first.session.attach({ path: "README.md", name: "README.md", size: 12, type: "text/markdown" });
  assert.strictEqual(first.session.detach(chip.attachment.id).ok, true);
  assert.strictEqual(first.session.attachments.length, 0);
  first.session.attach({ path: "README.md", name: "README.md", size: 12, type: "text/markdown" });
  const started = await first.session.submit("Explain the readme", 1);
  assert.strictEqual(started.ok, true);
  assert.strictEqual(first.session.epoch, 1);
  assert.ok(/^run_/.test(started.runId));
  assert.strictEqual(started.model, "llama3.2:3b");
  assert.strictEqual(started.provider, "ollama");
  await waitFor(first.session, (item) => item.stage === "Complete" && !item.running);
  assert.ok(first.seen.includes("Reading"));
  assert.ok(first.provider.models.every((model) => model === "llama3.2:3b"));
  const saved = JSON.parse(fs.readFileSync(path.join(root, "runs", `${started.runId}.json`), "utf8"));
  assert.ok(saved.goal.includes("README.md"));
  assert.ok(!saved.goal.includes(ANCHOR));
  assert.ok(saved.observations.some((item) => item.tool === "file.read"));
  assert.strictEqual(first.session.detach("missing").ok, false);

  const hanging = sessionFor(root, [{ wait: true }], models);
  await hanging.session.refreshModels();
  const live = await hanging.session.submit("wait", 2);
  assert.strictEqual(live.ok, true);
  const busy = await hanging.session.submit("again", 3);
  assert.strictEqual(busy.code, "busy");
  assert.strictEqual(hanging.session.epoch, 2);
  const cancelled = hanging.session.cancel();
  assert.strictEqual(cancelled.ok, true);
  await waitFor(hanging.session, (item) => item.stage === "Cancelled" && !item.running);

  const failing = sessionFor(root, [], models);
  await failing.session.refreshModels();
  const failed = await failing.session.submit("break");
  assert.strictEqual(failed.ok, true);
  await waitFor(failing.session, (item) => item.stage === "Failed" && !item.running);
  const again = await failing.session.submit("recover");
  assert.strictEqual(again.ok, true);
  assert.notStrictEqual(again.requestId, failed.requestId);
  await waitFor(failing.session, (item) => item.requestId === again.requestId && item.stage === "Failed" && !item.running);

  const recovered = sessionFor(root, [{ text: "ok after read", toolCalls: [{ name: "file.read", args: { path: "README.md" } }] }, { text: "done" }], models);
  await recovered.session.refreshModels();
  const second = await recovered.session.submit("try again");
  assert.strictEqual(second.ok, true);
  await waitFor(recovered.session, (item) => !item.running && item.stage === "Complete");

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

  console.log("ok composer agent run");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
