const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { startAgentRun, startPipelineRun } = require("../../packages/agent-runtime");
const { stripNegatedEditing } = require("../../packages/agent-runtime/intent");
const { composerStage, composerActivity, compactTools, diffsByFile, formatGoal, normalizeComposerMode, agentModeFor, taskClassFor, looksLikeWorkspaceEdit, isProgressTalk } = require("./composer-client");

const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const INBOX = ".codeme/inbox";

async function listOllamaModels(baseUrl = "http://127.0.0.1:11434", provider = "ollama", sourceLabel = "") {
  const { OllamaModelProvider } = require("../../packages/agent-runtime/model-provider");
  const listed = await new OllamaModelProvider({ baseUrl }).listModels();
  return listed.map((model) => modelRecord(provider || model.provider || "ollama", model.id, sourceLabel));
}

function modelRecord(provider, id, sourceLabel = "") {
  const label = modelLabel(id);
  return { provider, id, label: sourceLabel ? `${sourceLabel} · ${label}` : label };
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

function attachmentKind(type, name) {
  const label = `${type || ""} ${name || ""}`.toLowerCase();
  if (label.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name || "")) return "image";
  if (label.includes("application/pdf") || /\.pdf$/i.test(name || "")) return "pdf";
  return "file";
}

function checkAttachment(root, input, existing) {
  if (input && input.kind === "folder") return reject("reserved", "Folder attachments are reserved.");
  const relative = workspaceRelative(root, input && input.path);
  if (!relative) return reject("path_escape", "That file is outside the workspace.");
  if (existing.length >= MAX_ATTACHMENTS) return reject("too_many", "Attach at most 6 files.");
  const size = Number(input && input.size) || 0;
  if (size > MAX_ATTACHMENT_BYTES) return reject("too_large", "Each attachment must be 8 MB or smaller.");
  if (existing.some((item) => item.path === relative)) return reject("duplicate", "That file is already attached.");
  const name = (input && input.name) || path.posix.basename(relative);
  const type = (input && input.type) || "text/plain";
  return {
    ok: true,
    attachment: {
      id: `att_${crypto.randomBytes(4).toString("hex")}`,
      kind: attachmentKind(type, name),
      path: relative,
      name,
      type,
      size,
    },
  };
}

function importAttachment(root, input, existing) {
  if (!root) return reject("no_workspace", "Open a folder before attaching files.");
  if (input && input.kind === "folder") return reject("reserved", "Folder attachments are reserved.");
  if (input && input.contents) {
    let raw;
    try {
      raw = Buffer.from(String(input.contents), "base64");
    } catch {
      return reject("invalid_file", "That drop could not be read.");
    }
    if (!raw.length) return reject("invalid_file", "That drop is empty.");
    if (raw.length > MAX_ATTACHMENT_BYTES) return reject("too_large", "Each attachment must be 8 MB or smaller.");
    const dest = writeInboxFile(root, input.name || "drop.bin", raw);
    return checkAttachment(root, {
      path: dest,
      name: path.posix.basename(dest),
      size: raw.length,
      type: input.type,
    }, existing);
  }
  const relative = workspaceRelative(root, input && input.path);
  if (relative) return checkAttachment(root, { ...input, path: relative }, existing);
  const abs = localPath(input && input.path);
  if (!abs || !fs.existsSync(abs)) return reject("path_escape", "That file is outside the workspace.");
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) return reject("reserved", "Folder attachments are reserved.");
  if (stat.size > MAX_ATTACHMENT_BYTES) return reject("too_large", "Each attachment must be 8 MB or smaller.");
  const dest = writeInboxFile(root, path.basename(abs), fs.readFileSync(abs));
  return checkAttachment(root, {
    path: dest,
    name: path.posix.basename(dest),
    size: stat.size,
    type: input.type,
  }, existing);
}

function localPath(value) {
  let next = String(value || "").trim();
  if (next.startsWith("file:")) {
    try {
      next = decodeURIComponent(new URL(next).pathname);
    } catch {
      return "";
    }
  }
  return next ? path.resolve(next) : "";
}

function writeInboxFile(root, name, buffer) {
  const dir = path.join(root, INBOX);
  fs.mkdirSync(dir, { recursive: true });
  const base = safeName(name);
  let dest = path.join(dir, base);
  let index = 1;
  while (fs.existsSync(dest)) {
    const ext = path.extname(base);
    dest = path.join(dir, `${path.basename(base, ext)}-${index}${ext}`);
    index += 1;
  }
  fs.writeFileSync(dest, buffer);
  return path.relative(root, dest).split(path.sep).join("/");
}

function safeName(name) {
  const base = path.basename(String(name || "drop.bin")).replace(/[^\w.\-]+/g, "_") || "drop.bin";
  return base.slice(0, 80);
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
    this.historyStore = options.historyStore || null;
    this.selectionStore = options.selectionStore || { get() { return null; }, set() {} };
    this.listModels = options.listModels;
    this.createProvider = options.createProvider;
    this.createRegistry = options.createRegistry;
    this.capabilities = options.capabilities || null;
    this.root = options.root || "";
    this.attachments = [];
    this.models = [];
    this.selected = null;
    this.composerMode = normalizeComposerMode(this.selectionStore.getMode ? this.selectionStore.getMode() : "ask");
    this.mode = agentModeFor(this.composerMode);
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
    this.projectDecision = null;
    this.diff = "";
    this.runId = "";
    this.requestId = "";
    this.epoch = 0;
    this.conversationId = "";
    this.onChange = options.onChange || (() => {});
    this.restoreActiveConversation();
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
      projectDecision: this.projectDecision ? { ...this.projectDecision } : null,
      diff: this.diff,
      models: this.models.map((model) => ({ ...model })),
      selected: this.selected ? { ...this.selected } : null,
      mode: this.mode,
      composerMode: this.composerMode,
      attachments: this.attachments.map((item) => ({ ...item })),
      conversationId: this.conversationId,
      conversations: this.historyStore ? this.historyStore.list(this.root) : [],
    };
  }

  emit() {
    this.onChange(this.snapshot());
  }

  setRoot(root) {
    const next = String(root || "");
    if (next === this.root) return;
    this.root = next;
    this.resetRunView();
    this.restoreActiveConversation();
    this.emit();
  }

  restoreActiveConversation() {
    if (!this.historyStore || !this.root) {
      this.conversationId = "";
      if (!this.running) this.thread = [];
      return;
    }
    const conversation = this.historyStore.active(this.root);
    if (!conversation) {
      this.conversationId = "";
      if (!this.running) this.thread = [];
      return;
    }
    this.conversationId = conversation.id;
    if (!this.running) this.thread = conversationMessages(conversation);
  }

  newChat() {
    if (this.running) return reject("busy", "Stop the current run before starting a new chat.");
    if (this.historyStore) this.historyStore.clearActive(this.root);
    this.conversationId = "";
    this.thread = [];
    this.attachments = [];
    this.resetRunView();
    this.emit();
    return { ok: true };
  }

  openChat(id) {
    if (this.running) return reject("busy", "Stop the current run before opening another chat.");
    if (!this.historyStore) return reject("history_unavailable", "Chat history is not configured.");
    const conversation = this.historyStore.get(id, this.root);
    if (!conversation) return reject("not_found", "That chat is no longer available.");
    this.historyStore.setActive(this.root, conversation.id);
    this.conversationId = conversation.id;
    this.thread = conversationMessages(conversation);
    this.attachments = [];
    this.resetRunView();
    this.emit();
    return { ok: true, conversationId: conversation.id };
  }

  resetRunView() {
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
    this.verification = null;
    this.projectDecision = null;
    this.diff = "";
    this.runId = "";
    this.requestId = "";
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
    this.composerMode = normalizeComposerMode(mode);
    this.mode = agentModeFor(this.composerMode);
    if (this.selectionStore.setMode) this.selectionStore.setMode(this.composerMode);
    this.emit();
    return { ok: true, mode: this.composerMode, agentMode: this.mode };
  }

  attach(input) {
    const checked = importAttachment(this.root, input, this.attachments);
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

  ensureConversation(title) {
    if (this.conversationId || !this.historyStore) return;
    const conversation = this.historyStore.create(this.root, title);
    this.conversationId = conversation.id;
  }

  async submit(text, epoch) {
    const goal = formatGoal(text, this.attachments);
    if (!goal.trim()) return reject("empty", "Enter a message first.");

    const visibleText = String(text || "").trim() || goal;
    if (this.running) {
      if (!this.active || !this.active.handle || typeof this.active.handle.followUp !== "function") {
        return reject("busy", "The active run cannot accept a follow-up.");
      }
      this.active.handle.followUp(goal);
      let baseThread = (this.active.baseThread || this.thread).concat([{ role: "user", text: visibleText }]);
      if (this.historyStore && this.conversationId) {
        const saved = this.historyStore.append(this.conversationId, this.root, {
          role: "user",
          text: visibleText,
          runId: this.active.runId,
        });
        if (saved) baseThread = conversationMessages(saved);
      }
      this.active.baseThread = baseThread.map((item) => ({ ...item }));
      this.thread = baseThread;
      this.notice = "Follow-up added to the active run";
      this.emit();
      return {
        ok: true,
        requestId: this.active.requestId,
        runId: this.active.runId,
        conversationId: this.conversationId,
        followUp: true,
        model: this.selected ? this.selected.id : "",
        provider: this.selected ? this.selected.provider : "",
        mode: this.mode,
        composerMode: this.composerMode,
      };
    }

    if (!this.selected) return reject("no_model", "No local model is installed.");
    const priorThread = this.thread.map((item) => ({ ...item }));
    this.ensureConversation(visibleText);

    let baseThread = priorThread.concat([{ role: "user", text: visibleText }]);
    if (this.historyStore && this.conversationId) {
      const saved = this.historyStore.append(this.conversationId, this.root, {
        role: "user",
        text: visibleText,
      });
      if (saved) baseThread = conversationMessages(saved);
    }
    this.thread = baseThread;

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
    this.notice = this.composerMode === "ask" && looksLikeWorkspaceEdit(goal)
      ? "Switch to Code to apply file edits"
      : "";
    this.outcome = null;
    this.filesChanged = [];
    this.fileDiffs = [];
    this.tools = [];
    this.verification = null;
    this.projectDecision = null;
    this.diff = "";
    this.active = {
      requestId,
      runId: "",
      handle: null,
      baseThread: baseThread.map((item) => ({ ...item })),
    };
    this.emit();

    const publishing = new PublishingStore(this.store, (run) => this.publish(requestId, run));
    let handle;
    try {
      const runAgent = process.env.CODEME_AGENT_PIPELINE === "legacy"
        ? startAgentRun
        : startPipelineRun;
      handle = runAgent({
        goal,
        model: this.selected.id,
        providerName: this.selected.provider || provider.name || "ollama",
        provider,
        registry,
        store: publishing,
        capabilities: this.capabilities,
        mode: this.mode,
        composerMode: this.composerMode,
        taskClass: taskClassFor(this.composerMode) || undefined,
        conversationHistory: priorThread,
        attachments: this.attachments.map((item) => ({
          kind: item.kind,
          path: item.path,
          name: item.name,
          type: item.type,
          size: item.size,
        })),
        inferRequirements: true,
        timeoutMs: this.composerMode === "code" && looksLikeWorkspaceEdit(goal) ? 300000 : 180000,
        maxIterations: this.composerMode === "code" ? 20 : 12,
        maxRepairRounds: 2,
        maxToolCallsPerTurn: 8,
        maxIdenticalActions: this.composerMode === "code" ? 12 : 4,
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
      this.finishRequest(requestId, run);
    }).catch((error) => {
      this.failRequest(requestId, error instanceof Error ? error.message : String(error));
    });

    return {
      ok: true,
      requestId,
      runId: handle.id,
      conversationId: this.conversationId,
      model: this.selected.id,
      provider: this.selected.provider,
      mode: this.mode,
      composerMode: this.composerMode,
    };
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

    const assistantItems = threadFrom(run).filter((item) => item.role === "assistant");
    this.thread = (this.active.baseThread || []).concat(assistantItems);

    this.verification = run.verification || null;
    this.projectDecision = run.projectDecision ? { ...run.projectDecision } : null;
    this.outcome = run.outcome || null;
    this.error = run.lifecycle === "failed" && run.error ? run.error.message : "";
    this.notice = this.composerMode === "ask" && looksLikeWorkspaceEdit(run.goal || "")
      ? "Switch to Code to apply file edits"
      : "";
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

  finishRequest(requestId, run) {
    if (!this.active || this.active.requestId !== requestId) return;

    if (this.historyStore && this.conversationId && run) {
      let assistantItems = threadFrom(run).filter((item) => item.role === "assistant");
      if (!assistantItems.length && run.outcome && run.outcome.summary) {
        assistantItems = [{ role: "assistant", text: String(run.outcome.summary) }];
      }
      for (const item of assistantItems) {
        this.historyStore.append(this.conversationId, this.root, {
          role: "assistant",
          text: item.text,
          runId: run.id,
        });
      }
      const saved = this.historyStore.get(this.conversationId, this.root);
      if (saved) this.thread = conversationMessages(saved);
    }

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

function conversationMessages(conversation) {
  return ((conversation && conversation.messages) || []).map((item) => ({
    role: item.role === "assistant" ? "assistant" : "user",
    text: String(item.text || ""),
  })).filter((item) => item.text.trim());
}

function threadFrom(run) {
  const items = [];
  if (run && run.goal) items.push({ role: "user", text: run.goal });
  const final = finalAssistantText(run);
  if (final) items.push({ role: "assistant", text: final });
  return items;
}

function finalAssistantText(run) {
  if (!run || !["completed", "failed", "cancelled", "awaiting_user"].includes(run.lifecycle)) return "";

  if (run.lifecycle === "completed") {
    const files = Array.isArray(run.filesChanged) ? run.filesChanged.filter(Boolean) : [];
    if (files.length) {
      const names = formatFileList(files);
      const evidence = (run.verification && run.verification.evidence) || [];
      if (evidence.includes("browser.interact")) {
        return `Done — I applied the requested change to ${names} and verified the interaction with a real browser click.`;
      }
      if (evidence.includes("browser.check")) {
        return `Done — I applied the requested change to ${names} and verified the result in the browser.`;
      }
      if (evidence.includes("tests.run")) {
        return `Done — I updated ${names} and the available tests passed.`;
      }
      if (evidence.includes("file.read")) {
        return `Done — I updated ${names} and confirmed the saved contents.`;
      }
      return `Done — I updated ${names}.`;
    }

    if (run.taskClass === "inspect") {
      const inventory = lastDirectoryListing(run);
      if (inventory.length) {
        return `This project contains ${inventory.length} ${inventory.length === 1 ? "file" : "files"}:\n${inventory.map((file) => `• \`${file}\``).join("\n")}`;
      }
    }

    const outcome = run.outcome && run.outcome.summary;
    if (outcome) return cleanAssistantText(outcome);
    return cleanAssistantText(lastMeaningfulDecision(run)) || "Done.";
  }

  if (run.lifecycle === "cancelled") return "Stopped — no further changes will be made.";
  if (run.lifecycle === "awaiting_user") {
    return cleanAssistantText(run.outcome && run.outcome.summary) || "I need more information before I can continue.";
  }

  const reason = cleanAssistantText(run.outcome && run.outcome.summary);
  const files = Array.isArray(run.filesChanged) ? run.filesChanged.filter(Boolean) : [];
  if (files.length) {
    return `I changed ${formatFileList(files)}, but I could not finish verification. ${reason || "Check the failed tool above for details."}`;
  }
  return `I couldn't complete that. ${reason || "Check the failed tool above for details."}`;
}

function lastDirectoryListing(run) {
  const calls = (run && run.toolCalls) || [];
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index];
    if (call.name !== "dir.list" || !call.result || !call.result.ok) continue;
    const entries = call.result.data && Array.isArray(call.result.data.entries) ? call.result.data.entries : [];
    return entries.filter((item) => !item.type || item.type === "file").map((item) => item.path).filter(Boolean).slice(0, 40);
  }
  return [];
}

function lastMeaningfulDecision(run) {
  const decisions = (run && run.decisions) || [];
  for (let index = decisions.length - 1; index >= 0; index -= 1) {
    const text = decisions[index] && decisions[index].text ? String(decisions[index].text).trim() : "";
    if (text && !isProgressTalk(text)) return text;
  }
  return "";
}

function cleanAssistantText(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const paragraphs = text.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  const seen = new Set();
  const kept = [];
  for (const paragraph of paragraphs) {
    if (isProgressTalk(paragraph)) continue;
    const key = paragraph.toLowerCase().replace(/\s+/g, " ").replace(/[`*_>#-]/g, "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(paragraph);
  }
  return kept.join("\n\n").slice(0, 1600);
}

function formatFileList(files) {
  const unique = [...new Set(files.map((file) => String(file)))];
  const shown = unique.slice(0, 4).map((file) => `\`${file}\``);
  if (unique.length > 4) shown.push(`${unique.length - 4} more files`);
  if (shown.length === 1) return shown[0];
  if (shown.length === 2) return `${shown[0]} and ${shown[1]}`;
  return `${shown.slice(0, -1).join(", ")}, and ${shown[shown.length - 1]}`;
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
  INBOX,
  listOllamaModels,
  modelLabel,
  workspaceRelative,
  checkAttachment,
  importAttachment,
  finalAssistantText,
  ComposerSession,
};
