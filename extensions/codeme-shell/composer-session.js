const crypto = require("crypto");
const path = require("path");
const { startAgentRun } = require("../../packages/agent-runtime");
const { composerStage, composerActivity, compactTools, diffsByFile, formatGoal } = require("./composer-client");

const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_BYTES = 1024 * 1024;

async function listOllamaModels(baseUrl = "http://127.0.0.1:11434") {
  const { OllamaModelProvider } = require("../../packages/agent-runtime/model-provider");
  const listed = await new OllamaModelProvider({ baseUrl }).listModels();
  return listed.map((model) => modelRecord(model.provider || "ollama", model.id));
}

function modelRecord(provider, id) {
  return { provider, id, label: modelLabel(id) };
}

function modelLabel(id) {
  if (id === "qwen3.5:9b") return "Qwen 3.5 9B";
  const [name, tag] = String(id).split(":");
  const words = name.replace(/[._-]+/g, " ").replace(/(\d)/g, " $1 ").replace(/\s+/g, " ").trim();
  const titled = words.replace(/\b\w/g, (letter) => letter.toUpperCase());
  return tag ? `${titled} ${tag.toUpperCase()}` : titled;
}

function workspaceRelative(root, candidate) {
  if (!root || typeof candidate !== "string" || !candidate.trim()) return "";
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, candidate);
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return "";
  return relative.split(path.sep).join("/");
}

function checkAttachment(root, input, existing) {
  const kind = input && input.kind;
  if (kind === "folder") return reject("reserved", "Folder attachments are reserved.");
  if (kind === "image" || kind === "pdf" || String(input && input.type || "").startsWith("image/") || input && input.type === "application/pdf") {
    return reject("reserved", "Image and PDF attachments are reserved.");
  }
  const relative = workspaceRelative(root, input && input.path);
  if (!relative) return reject("path_escape", "That file is outside the workspace.");
  if (existing.length >= MAX_ATTACHMENTS) return reject("too_many", "Attach at most 6 files.");
  const size = Number(input && input.size) || 0;
  if (size > MAX_ATTACHMENT_BYTES) return reject("too_large", "Each attachment must be 1 MB or smaller.");
  if (existing.some((item) => item.path === relative)) return reject("duplicate", "That file is already attached.");
  return {
    ok: true,
    attachment: {
      id: `att_${crypto.randomBytes(4).toString("hex")}`,
      kind: "file",
      path: relative,
      name: (input && input.name) || path.posix.basename(relative),
      type: (input && input.type) || "text/plain",
      size,
    },
  };
}

function reject(code, message) {
  return { ok: false, code, message };
}

class PublishingStore {
  constructor(inner, publish) {
    this.inner = inner;
    this.publish = publish;
  }

  save(run) {
    const saved = this.inner.save(run);
    this.publish(saved);
    return saved;
  }

  load(id) {
    return this.inner.load(id);
  }
}

class ComposerSession {
  constructor(options) {
    this.store = options.store;
    this.selectionStore = options.selectionStore || { get() { return null; }, set() {} };
    this.listModels = options.listModels;
    this.createProvider = options.createProvider;
    this.createRegistry = options.createRegistry;
    this.capabilities = options.capabilities || null;
    this.root = options.root || "";
    this.attachments = [];
    this.models = [];
    this.selected = null;
    this.mode = this.selectionStore.getMode ? this.selectionStore.getMode() : "read_only";
    if (this.mode !== "controlled") this.mode = "read_only";
    this.active = null;
    this.running = false;
    this.stage = "Waiting";
    this.activity = "";
    this.error = "";
    this.notice = "";
    this.outcome = null;
    this.filesChanged = [];
    this.fileDiffs = [];
    this.tools = [];
    this.thread = [];
    this.verification = null;
    this.diff = "";
    this.runId = "";
    this.requestId = "";
    this.epoch = 0;
    this.onChange = options.onChange || (() => {});
  }

  snapshot() {
    return {
      requestId: this.requestId,
      runId: this.runId,
      epoch: this.epoch,
      running: this.running,
      stage: this.stage,
      activity: this.activity,
      error: this.error,
      notice: this.notice,
      outcome: this.outcome,
      filesChanged: this.filesChanged.slice(),
      fileDiffs: this.fileDiffs.map((item) => ({ ...item })),
      tools: this.tools.map((item) => ({ ...item })),
      thread: this.thread.map((item) => ({ ...item })),
      verification: this.verification,
      diff: this.diff,
      models: this.models.map((model) => ({ ...model })),
      selected: this.selected ? { ...this.selected } : null,
      mode: this.mode,
      attachments: this.attachments.map((item) => ({ ...item })),
    };
  }

  emit() {
    this.onChange(this.snapshot());
  }

  async refreshModels() {
    this.models = await this.listModels();
    const saved = this.selectionStore.get();
    const match = saved && this.models.find((model) => model.provider === saved.provider && model.id === saved.id);
    this.selected = match || this.models[0] || null;
    if (this.selected) this.selectionStore.set({ provider: this.selected.provider, id: this.selected.id });
    this.emit();
    return this.selected;
  }

  selectModel(provider, id) {
    const match = this.models.find((model) => model.provider === provider && model.id === id);
    if (!match) return reject("unknown_model", "That model is not installed.");
    this.selected = match;
    this.selectionStore.set({ provider: match.provider, id: match.id });
    this.notice = "";
    this.emit();
    return { ok: true, model: { ...match } };
  }

  selectMode(mode) {
    this.mode = mode === "controlled" ? "controlled" : "read_only";
    if (this.selectionStore.setMode) this.selectionStore.setMode(this.mode);
    this.emit();
    return { ok: true, mode: this.mode };
  }

  attach(input) {
    const checked = checkAttachment(this.root, input, this.attachments);
    if (!checked.ok) {
      this.notice = checked.message;
      this.emit();
      return checked;
    }
    this.attachments.push(checked.attachment);
    this.notice = "";
    this.emit();
    return checked;
  }

  detach(id) {
    const before = this.attachments.length;
    this.attachments = this.attachments.filter((item) => item.id !== id);
    if (this.attachments.length === before) return reject("not_found", "That attachment is not on the composer.");
    this.emit();
    return { ok: true };
  }

  async submit(text, epoch) {
    if (this.running) return reject("busy", "A run is already in progress.");
    const goal = formatGoal(text, this.attachments);
    if (!goal.trim()) return reject("empty", "Enter a message first.");
    if (!this.selected) return reject("no_model", "No local model is installed.");
    const requestId = crypto.randomBytes(8).toString("hex");
    if (Number.isFinite(Number(epoch))) this.epoch = Number(epoch);
      const provider = this.createProvider(this.selected);
    const registry = this.createRegistry(this.mode);
    this.requestId = requestId;
    this.runId = "";
    this.running = true;
    this.stage = "Understanding";
    this.activity = "Understanding…";
    this.error = "";
    this.notice = "";
    this.outcome = null;
    this.filesChanged = [];
    this.fileDiffs = [];
    this.tools = [];
    this.thread = [{ role: "user", text: goal }];
    this.verification = null;
    this.diff = "";
    this.active = { requestId, runId: "", handle: null };
    const publishing = new PublishingStore(this.store, (run) => this.publish(requestId, run));
    let handle;
    try {
      handle = startAgentRun({
        goal,
        model: this.selected.id,
        providerName: this.selected.provider,
        provider,
        registry,
        store: publishing,
        capabilities: this.capabilities,
        mode: this.mode,
        attachments: this.attachments.map((item) => ({
          kind: item.kind,
          path: item.path,
          name: item.name,
          type: item.type,
          size: item.size,
        })),
        timeoutMs: 180000,
      });
    } catch (error) {
      this.failRequest(requestId, error instanceof Error ? error.message : String(error));
      return reject("start_failed", this.error);
    }
    this.active.handle = handle;
    this.active.runId = handle.id;
    this.runId = handle.id;
    this.emit();
    handle.done.then((run) => {
      this.publish(requestId, run);
      this.finishRequest(requestId);
    }).catch((error) => {
      this.failRequest(requestId, error instanceof Error ? error.message : String(error));
    });
      return { ok: true, requestId, runId: handle.id, model: this.selected.id, provider: this.selected.provider, mode: this.mode };
  }

  cancel() {
    if (!this.active || !this.active.handle) return reject("idle", "No run is in progress.");
    this.active.handle.cancel();
    return { ok: true, requestId: this.active.requestId, runId: this.active.runId };
  }

  publish(requestId, run) {
    if (!this.active || this.active.requestId !== requestId || !run) return;
    if (this.active.runId && this.active.runId !== run.id) return;
    this.active.runId = run.id;
    this.runId = run.id;
    this.stage = composerStage(run);
    this.activity = composerActivity(run);
    this.filesChanged = (run.filesChanged || []).slice();
    this.diff = diffText(run);
    this.fileDiffs = diffsByFile(this.diff, this.filesChanged);
    this.tools = compactTools(run);
    this.thread = threadFrom(run);
    this.verification = run.verification || null;
    this.outcome = run.outcome || null;
    this.error = run.lifecycle === "failed" && run.error ? run.error.message : "";
    this.running = !["completed", "failed", "cancelled", "awaiting_user"].includes(run.lifecycle);
    if (run.lifecycle === "cancelled") {
      const files = ((run.progress && run.progress.filesRead) || []).filter(Boolean);
      this.verification = null;
      this.outcome = {
        status: "cancelled",
        summary: files.length
          ? `Stopped before the answer was written. Already read ${files.join(", ")}.`
          : "Stopped before the answer was written.",
      };
    }
    if (run.lifecycle === "awaiting_user") {
      this.activity = (run.outcome && run.outcome.summary) || "Waiting for you";
    }
    this.emit();
  }

  finishRequest(requestId) {
    if (!this.active || this.active.requestId !== requestId) return;
    this.running = false;
    this.active = null;
    if (this.stage === "Complete") this.attachments = [];
    this.emit();
  }

  failRequest(requestId, message) {
    if (this.requestId !== requestId) return;
    this.running = false;
    this.stage = "Failed";
    this.error = message;
    this.active = null;
    this.emit();
  }
}

function threadFrom(run) {
  const items = [];
  if (run && run.goal) items.push({ role: "user", text: run.goal });
  for (const decision of (run && run.decisions) || []) {
    const text = decision && decision.text ? String(decision.text).trim() : "";
    if (text) items.push({ role: "assistant", text });
  }
  return items;
}

function diffText(run) {
  const calls = run.toolCalls || [];
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index];
    const diff = call && call.name === "git.diff" && call.result && call.result.data && call.result.data.diff;
    if (typeof diff === "string" && diff) return diff.slice(0, 8000);
  }
  return "";
}

module.exports = {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  listOllamaModels,
  modelLabel,
  workspaceRelative,
  checkAttachment,
  ComposerSession,
};
