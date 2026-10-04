const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { startAgentRun, startPipelineRun, resumePipelineRun } = require("../../packages/agent-runtime");
const { stripNegatedEditing, isScaffoldOnlyRequest } = require("../../packages/agent-runtime/intent");
const { composerStage, composerActivity, compactTools, compactRunStream, diffsByFile, formatGoal, normalizeComposerMode, agentModeFor, taskClassFor, looksLikeWorkspaceEdit, isProgressTalk } = require("./composer-client");

const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const INBOX = ".codeme/inbox";

function modelTurnBudget(composerMode, goal) {
  if (composerMode !== "code") return 12;
  return isScaffoldOnlyRequest(goal) ? 48 : 20;
}

async function listOllamaModels(baseUrl = "http://127.0.0.1:11434", provider = "ollama", sourceLabel = "", options = {}) {
  const { OllamaModelProvider } = require("../../packages/agent-runtime/model-provider");
  const listed = await new OllamaModelProvider({ baseUrl }).listModels(options);
  return listed.map((model) => modelRecord(provider || model.provider || "ollama", model.id, sourceLabel));
}

function modelRecord(provider, id, sourceLabel = "") {
  const label = modelLabel(id);
  return {
    provider,
    id,
    source: sourceLabel || "",
    label: sourceLabel ? `${sourceLabel} · ${label}` : label,
  };
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
    this.externalTools = options.externalTools || null;
    this.n8n = options.n8n || null;
    this.analyzeImages = typeof options.analyzeImages === "function" ? options.analyzeImages : null;
    this.settingsProvider = typeof options.settingsProvider === "function" ? options.settingsProvider : null;
    this.root = options.root || "";
    this.attachments = [];
    this.models = [];
    this.modelSources = [];
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
    this.stream = [];
    this.thread = [];
    this.verification = null;
    this.timeoutDiagnostics = null;
    this.reconnect = null;
    this.projectDecision = null;
    this.clarification = null;
    this.researchRequest = null;
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
      stream: this.stream.map((item) => ({ ...item })),
      thread: this.thread.map((item) => ({ ...item })),
      verification: this.verification,
      timeoutDiagnostics: this.timeoutDiagnostics ? { ...this.timeoutDiagnostics } : null,
      reconnect: this.reconnect ? { ...this.reconnect } : null,
      projectDecision: this.projectDecision ? { ...this.projectDecision } : null,
      clarification: this.clarification ? {
        ...this.clarification,
        questions: (this.clarification.questions || []).map((item) => ({ ...item })),
        previousEnrichment: this.clarification.previousEnrichment
          ? { ...this.clarification.previousEnrichment }
          : null,
      } : null,
      researchRequest: this.researchRequest ? {
        ...this.researchRequest,
        queries: (this.researchRequest.queries || []).slice(),
      } : null,
      diff: this.diff,
      models: this.models.map((model) => ({ ...model })),
      modelSources: this.modelSources.map((source) => ({ ...source })),
      selected: this.selected ? { ...this.selected } : null,
      mode: this.mode,
      composerMode: this.composerMode,
      attachments: this.attachments.map((item) => ({ ...item })),
      conversationId: this.conversationId,
      conversations: this.historyStore ? this.historyStore.list(this.root) : [],
      n8n: this.n8n && typeof this.n8n.snapshot === "function" ? this.n8n.snapshot() : null,
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
    this.stream = [];
    this.verification = null;
    this.timeoutDiagnostics = null;
    this.reconnect = null;
    this.projectDecision = null;
    this.clarification = null;
    this.researchRequest = null;
    this.diff = "";
    this.runId = "";
    this.requestId = "";
  }

  async refreshModels() {
    let discovered;
    try {
      discovered = await this.listModels();
    } catch (error) {
      discovered = {
        models: [],
        sources: [{
          id: "models",
          label: "Models",
          configured: true,
          available: false,
          count: 0,
          message: error instanceof Error ? error.message : String(error),
        }],
      };
    }

    const nextModels = Array.isArray(discovered)
      ? discovered
      : Array.isArray(discovered && discovered.models) ? discovered.models : [];
    const nextSources = Array.isArray(discovered && discovered.sources) ? discovered.sources : [];

    const saved = this.selectionStore.get();
    const savedMatch = saved && nextModels.find((model) => model.provider === saved.provider && model.id === saved.id);
    const currentMatch = this.selected && nextModels.find((model) => (
      model.provider === this.selected.provider && model.id === this.selected.id
    ));

    this.models = nextModels;
    this.modelSources = nextSources;
    this.selected = savedMatch || currentMatch || nextModels[0] || null;

    // Only overwrite the persisted preference when it still exists, or when
    // there was no previous preference. A temporarily offline remote server
    // must not silently replace the user's chosen Server model with Local.
    if (this.selected && (savedMatch || !saved)) {
      this.selectionStore.set({ provider: this.selected.provider, id: this.selected.id });
    }
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

  async configureN8n(patch) {
    if (!this.n8n || typeof this.n8n.update !== "function") return reject("n8n_unavailable", "n8n integration is not configured.");
    try {
      const settings = await this.n8n.update(patch || {});
      this.notice = "";
      this.emit();
      return { ok: true, settings };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notice = "n8n settings failed: " + message;
      this.emit();
      return reject("n8n_settings_failed", message);
    }
  }

  async testN8n() {
    if (!this.n8n || typeof this.n8n.test !== "function") return reject("n8n_unavailable", "n8n integration is not configured.");
    try {
      const result = await this.n8n.test();
      this.notice = result.count + " MCP tool" + (result.count === 1 ? "" : "s") + " available";
      this.emit();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notice = "n8n connection failed: " + message;
      this.emit();
      return reject("n8n_connection_failed", message);
    }
  }

  async enhanceDraft(text) {
    const raw = String(text || "").trim();
    if (!raw) return reject("empty", "Enter a prompt first.");
    if (!this.n8n || typeof this.n8n.enhance !== "function") return { ok: true, prompt: raw, source: "none" };
    try {
      const result = await this.n8n.enhance(raw, {
        conversation: this.thread,
        workspace: typeof this.n8n.workspaceContext === "function" ? this.n8n.workspaceContext(this.root) : {},
      });
      this.notice = result.source === "n8n" ? "Prompt enhanced by n8n" : "Prompt enhanced locally";
      this.emit();
      return { ok: true, prompt: result.prompt, source: result.source };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notice = "Prompt enhancement failed: " + message;
      this.emit();
      return reject("enhance_failed", message);
    }
  }

  recordUserMessage(text, runId = "") {
    const visible = String(text || "").trim();
    if (!visible) return this.thread.map((item) => ({ ...item }));
    this.ensureConversation(visible);
    let next = this.thread.concat([{ role: "user", text: visible }]);
    if (this.historyStore && this.conversationId) {
      const saved = this.historyStore.append(this.conversationId, this.root, {
        role: "user",
        text: visible,
        ...(runId ? { runId } : {}),
      });
      if (saved) next = conversationMessages(saved);
    }
    this.thread = next;
    return next.map((item) => ({ ...item }));
  }

  recordAssistantMessage(text, runId = "") {
    const visible = String(text || "").trim();
    if (!visible) return this.thread.map((item) => ({ ...item }));
    let next = this.thread.concat([{ role: "assistant", text: visible }]);
    if (this.historyStore && this.conversationId) {
      const saved = this.historyStore.append(this.conversationId, this.root, {
        role: "assistant",
        text: visible,
        ...(runId ? { runId } : {}),
      });
      if (saved) next = conversationMessages(saved);
    }
    this.thread = next;
    return next.map((item) => ({ ...item }));
  }

  beginClarification(originalGoal, visibleText, decision, epoch) {
    this.recordUserMessage(visibleText);
    this.resetRunView();
    const requestId = crypto.randomBytes(8).toString("hex");
    if (Number.isFinite(Number(epoch))) this.epoch = Number(epoch);
    this.requestId = requestId;
    this.stage = "Waiting";
    this.activity = "Waiting for your answers";
    this.clarification = {
      originalPrompt: String(originalGoal || ""),
      visiblePrompt: String(visibleText || ""),
      summary: String(decision.summary || "I need a little more information before I start."),
      questions: (decision.clarifyingQuestions || []).slice(0, 5).map((item) => ({ ...item })),
      previousEnrichment: {
        status: decision.status,
        summary: decision.summary || "",
        intent: decision.intent || { goal: "", taskType: "" },
        requirements: (decision.requirements || []).slice(),
        constraints: (decision.constraints || []).slice(),
        knownContext: (decision.knownContext || []).slice(),
        assumptions: (decision.assumptions || []).slice(),
        missingInformation: (decision.missingInformation || []).slice(),
        clarifyingQuestions: (decision.clarifyingQuestions || []).map((item) => ({ ...item })),
        researchQueries: (decision.researchQueries || []).slice(),
        suggestedCapabilities: (decision.suggestedCapabilities || []).slice(),
        suggestedAgents: (decision.suggestedAgents || []).slice(),
        acceptanceCriteria: (decision.acceptanceCriteria || []).slice(),
        enhancedPrompt: "",
        confidence: decision.confidence,
      },
    };
    this.notice = "";
    this.emit();
    return {
      ok: true,
      requestId,
      runId: "",
      conversationId: this.conversationId,
      clarification: true,
      status: "NEEDS_CLARIFICATION",
      mode: this.mode,
      composerMode: this.composerMode,
    };
  }

  beginResearchStop(originalGoal, visibleText, decision, epoch, options = {}) {
    if (options.recordUser !== false) this.recordUserMessage(visibleText);
    this.resetRunView();
    const requestId = crypto.randomBytes(8).toString("hex");
    if (Number.isFinite(Number(epoch))) this.epoch = Number(epoch);
    this.requestId = requestId;
    const queries = (decision.researchQueries || []).slice(0, 10);
    const summary = String(decision.summary || "I need current or external information before I can safely continue.");
    this.researchRequest = { originalPrompt: String(originalGoal || ""), summary, queries };
    this.stage = "Waiting";
    this.activity = "Research required";
    this.notice = "Research is required before CodeMe can start this task.";
    this.recordAssistantMessage(
      summary + (queries.length ? "\n\nResearch needed:\n" + queries.map((item) => "• " + item).join("\n") : "")
    );
    this.emit();
    return {
      ok: true,
      requestId,
      runId: "",
      conversationId: this.conversationId,
      researchRequired: true,
      status: "NEEDS_RESEARCH",
      mode: this.mode,
      composerMode: this.composerMode,
    };
  }

  async submitClarification(answers, visibleText, epoch) {
    const pending = this.clarification;
    if (!pending) return reject("no_clarification", "There is no clarification request waiting for answers.");
    if (Number.isFinite(Number(epoch))) this.epoch = Number(epoch);
    if (!this.n8n || typeof this.n8n.enhanceForSubmit !== "function") {
      return reject("prompt_enhancement_unavailable", "Prompt enhancement is not available.");
    }

    const normalized = (Array.isArray(answers) ? answers : [])
      .map((item) => ({
        id: String(item && item.id || "answer").trim().slice(0, 120),
        answer: String(item && item.answer || "").trim().slice(0, 6000),
      }))
      .filter((item) => item.answer)
      .slice(0, 5);
    const freeform = normalized.find((item) => item.id === "freeform");
    const answerById = new Map(normalized.map((item) => [item.id, item.answer]));
    const missing = (pending.questions || []).filter((item) => item.required !== false && !answerById.get(item.id));
    if (missing.length && !freeform) {
      return reject("clarification_incomplete", "Please answer the required clarification questions before continuing.");
    }

    const answerText = String(visibleText || "").trim()
      || normalized.map((item) => item.answer).filter(Boolean).join("\n");
    if (!answerText) return reject("clarification_empty", "Enter an answer before continuing.");

    let decision;
    try {
      decision = await this.n8n.enhanceForSubmit(pending.originalPrompt, {
        conversation: this.thread,
        workspace: typeof this.n8n.workspaceContext === "function" ? this.n8n.workspaceContext(this.root) : {},
        mode: this.composerMode,
        projectId: this.root ? path.basename(this.root) : null,
        conversationId: this.conversationId || null,
        taskId: this.requestId || null,
      }, {
        clarificationAnswers: normalized,
        previousEnrichment: pending.previousEnrichment,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notice = "Prompt enhancement failed: " + message;
      this.emit();
      return reject(error && error.code ? String(error.code) : "prompt_enhancement_failed", message);
    }

    if (decision.status === "NEEDS_CLARIFICATION") {
      this.recordUserMessage(answerText);
      this.clarification = {
        ...pending,
        summary: String(decision.summary || pending.summary || ""),
        questions: (decision.clarifyingQuestions || []).slice(0, 5).map((item) => ({ ...item })),
        previousEnrichment: {
          status: decision.status,
          summary: decision.summary || "",
          intent: decision.intent || { goal: "", taskType: "" },
          requirements: (decision.requirements || []).slice(),
          constraints: (decision.constraints || []).slice(),
          knownContext: (decision.knownContext || []).slice(),
          assumptions: (decision.assumptions || []).slice(),
          missingInformation: (decision.missingInformation || []).slice(),
          clarifyingQuestions: (decision.clarifyingQuestions || []).map((item) => ({ ...item })),
          researchQueries: (decision.researchQueries || []).slice(),
          suggestedCapabilities: (decision.suggestedCapabilities || []).slice(),
          suggestedAgents: (decision.suggestedAgents || []).slice(),
          acceptanceCriteria: (decision.acceptanceCriteria || []).slice(),
          enhancedPrompt: "",
          confidence: decision.confidence,
        },
      };
      this.notice = "";
      this.emit();
      return {
        ok: true,
        requestId: this.requestId,
        runId: "",
        conversationId: this.conversationId,
        clarification: true,
        status: "NEEDS_CLARIFICATION",
        mode: this.mode,
        composerMode: this.composerMode,
      };
    }

    if (decision.status === "NEEDS_RESEARCH") {
      this.recordUserMessage(answerText);
      this.clarification = null;
      return this.beginResearchStop(pending.originalPrompt, "", decision, epoch, { recordUser: false });
    }

    if (decision.status !== "READY" || !String(decision.prompt || "").trim()) {
      return reject("prompt_enhancement_invalid", "Prompt enhancement did not return a READY task.");
    }

    this.clarification = null;
    this.researchRequest = null;
    return this.submit(answerText, epoch, {
      skipEnhancement: true,
      goalOverride: String(decision.prompt).trim(),
      resumeFromClarification: true,
    });
  }

  ensureConversation(title) {
    if (this.conversationId || !this.historyStore) return;
    const conversation = this.historyStore.create(this.root, title);
    this.conversationId = conversation.id;
  }

  async submit(text, epoch, options = {}) {
    let originalGoal = formatGoal(text, this.attachments);
    if (!originalGoal.trim()) return reject("empty", "Enter a message first.");

    const visibleText = String(text || "").trim() || originalGoal;
    if (
      !options.skipEnhancement
      && this.analyzeImages
      && this.attachments.some((item) => item && item.kind === "image")
    ) {
      try {
        this.notice = "Analyzing attached image" + (this.attachments.filter((item) => item && item.kind === "image").length === 1 ? "…" : "s…");
        this.emit();
        const vision = await this.analyzeImages(this.root, this.attachments, visibleText);
        if (vision && vision.ok && vision.spec) {
          originalGoal += "\n\nLOCAL VISION ANALYSIS (evidence from attached image(s); the user's request remains authoritative):\n"
            + JSON.stringify(vision.spec, null, 2);
          this.notice = "Image context ready · " + String(vision.sourceLabel || vision.source || "vision") + " · " + String(vision.model || "");
        } else if (vision && vision.notice) {
          this.notice = String(vision.notice);
        }
        this.emit();
      } catch (error) {
        this.notice = "Image analysis unavailable: " + (error instanceof Error ? error.message : String(error));
        this.emit();
      }
    }

    if (this.clarification && !options.resumeFromClarification) {
      return this.submitClarification([{ id: "freeform", answer: visibleText }], visibleText, epoch);
    }

    let goal = options.goalOverride ? String(options.goalOverride).trim() : originalGoal;

    // Follow-ups belong to an already-running agent. Do not start a second
    // prompt-enhancement gate while that run is in progress.
    if (this.running) {
      if (Number.isFinite(Number(epoch))) this.epoch = Number(epoch);
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

    if (!options.skipEnhancement && this.n8n && typeof this.n8n.enhanceForSubmit === "function") {
      let decision;
      const enhancementTaskId = crypto.randomBytes(8).toString("hex");
      try {
        decision = await this.n8n.enhanceForSubmit(originalGoal, {
          conversation: this.thread,
          workspace: typeof this.n8n.workspaceContext === "function" ? this.n8n.workspaceContext(this.root) : {},
          mode: this.composerMode,
          projectId: this.root ? path.basename(this.root) : null,
          conversationId: this.conversationId || null,
          taskId: enhancementTaskId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.notice = "Prompt enhancement failed: " + message;
        this.emit();
        return reject(error && error.code ? String(error.code) : "prompt_enhancement_failed", message);
      }

      if (decision && decision.status === "NEEDS_CLARIFICATION") {
        return this.beginClarification(originalGoal, visibleText, decision, epoch);
      }
      if (decision && decision.status === "NEEDS_RESEARCH") {
        return this.beginResearchStop(originalGoal, visibleText, decision, epoch);
      }
      if (decision && decision.status === "READY") {
        if (!String(decision.prompt || "").trim()) {
          return reject("prompt_enhancement_invalid", "Prompt enhancement marked the task READY without an enhanced prompt.");
        }
        goal = String(decision.prompt).trim();
      } else if (decision && decision.status !== "DISABLED") {
        return reject("prompt_enhancement_invalid", "Prompt enhancement returned an unsupported state.");
      }
    }

    this.clarification = null;
    this.researchRequest = null;
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
    const runtimeSettings = this.settingsProvider ? (this.settingsProvider() || {}) : {};
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
    this.stream = [];
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
        externalTools: this.externalTools,
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
        workspaceRoot: this.root,
        projectBrainEnabled: !runtimeSettings.memory || runtimeSettings.memory.projectKnowledgeEnabled !== false,
        memoryWriteEnabled: !runtimeSettings.memory || runtimeSettings.memory.reusableMemoryEnabled !== false,
        skillsEnabled: !runtimeSettings.skills || runtimeSettings.skills.enabled !== false,
        timeoutMs: this.composerMode === "code" && looksLikeWorkspaceEdit(goal) ? 300000 : 180000,
        retryTimeoutMs: this.composerMode === "code" && looksLikeWorkspaceEdit(goal) ? 300000 : 180000,
        maxIterations: modelTurnBudget(this.composerMode, goal),
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

  resume() {
    if (this.running) return reject("busy", "The current run is still active.");
    if (!this.runId) return reject("no_checkpoint", "There is no run to resume.");
    const stored = this.store.load(this.runId);
    if (!stored || !stored.pipelineCheckpoint) return reject("no_checkpoint", "This run has no saved checkpoint.");

    const selection = {
      provider: stored.provider || (this.selected && this.selected.provider) || "ollama-local",
      id: stored.effectiveModel || stored.requestedModel || (this.selected && this.selected.id) || "",
    };
    if (!selection.id) return reject("no_model", "The saved run has no model.");
    let provider;
    try {
      provider = this.createProvider(selection);
    } catch (error) {
      return reject("provider_unavailable", error instanceof Error ? error.message : String(error));
    }

    const registry = this.createRegistry(stored.mode || "controlled");
    const requestId = crypto.randomBytes(8).toString("hex");
    const publishing = new PublishingStore(this.store, (run) => this.publish(requestId, run));
    const runtimeSettings = this.settingsProvider ? (this.settingsProvider() || {}) : {};
    let handle;
    try {
      handle = resumePipelineRun(stored.id, {
        provider,
        registry,
        store: publishing,
        capabilities: this.capabilities,
        externalTools: this.externalTools,
        workspaceRoot: this.root,
        projectBrainEnabled: !runtimeSettings.memory || runtimeSettings.memory.projectKnowledgeEnabled !== false,
        memoryWriteEnabled: !runtimeSettings.memory || runtimeSettings.memory.reusableMemoryEnabled !== false,
        skillsEnabled: !runtimeSettings.skills || runtimeSettings.skills.enabled !== false,
        timeoutMs: stored.timeoutMs || (stored.composerMode === "code" ? 300000 : 180000),
        retryTimeoutMs: stored.timeoutMs || (stored.composerMode === "code" ? 300000 : 180000),
        maxIterations: stored.maxIterations || 20,
        maxRepairRounds: 2,
        maxToolCallsPerTurn: 8,
      });
    } catch (error) {
      return reject(error && error.code ? String(error.code) : "resume_failed", error instanceof Error ? error.message : String(error));
    }

    this.requestId = requestId;
    this.runId = handle.id;
    this.running = true;
    this.stage = "Understanding";
    this.activity = "Resuming from checkpoint…";
    this.error = "";
    this.notice = "";
    this.active = {
      requestId,
      runId: handle.id,
      handle,
      baseThread: this.thread.map((item) => ({ ...item })),
    };
    this.emit();
    handle.done.then((run) => {
      this.publish(requestId, run);
      this.finishRequest(requestId, run);
    }).catch((error) => {
      this.failRequest(requestId, error instanceof Error ? error.message : String(error));
    });

    return { ok: true, requestId, runId: handle.id, resumed: true };
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
    this.stream = compactRunStream(run);

    const assistantItems = threadFrom(run).filter((item) => item.role === "assistant");
    this.thread = (this.active.baseThread || []).concat(assistantItems);

    this.verification = run.verification || null;
    this.timeoutDiagnostics = run.timeoutDiagnostics ? { ...run.timeoutDiagnostics } : null;
    this.reconnect = run.reconnect ? { ...run.reconnect } : null;
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

function isToolProtocolJson(value) {
  const text = String(value || "").trim();
  if (!text || !text.startsWith("{") || !text.endsWith("}")) return false;
  try {
    const parsed = JSON.parse(text);
    return Boolean(
      parsed
      && typeof parsed === "object"
      && !Array.isArray(parsed)
      && (parsed.name || parsed.tool)
      && (parsed.arguments !== undefined || parsed.args !== undefined)
    );
  } catch {
    return false;
  }
}

function stripToolProtocolText(value) {
  let text = String(value || "");
  text = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "");
  text = text.replace(/\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`/gi, (whole, body) => {
    const toolLike = /"(?:name|tool)"\s*:/.test(body) && /"(?:arguments|args)"\s*:/.test(body);
    return toolLike ? "" : whole;
  });
  text = text
    .split(/\r?\n/)
    .filter((line) => !isToolProtocolJson(line))
    .join("\n");
  const trimmed = text.trim();
  if (isToolProtocolJson(trimmed)) return "";
  return trimmed;
}

function cleanAssistantText(value) {
  const text = stripToolProtocolText(value);
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
  modelTurnBudget,
  ComposerSession,
};
