const fs = require("fs");
const path = require("path");

const SECRET_KEY = /(authorization|api[-_]?key|token|password|secret|cookie|set-cookie)/i;
const SECRET_VALUE = /\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._~+\/-]+=*)\b/gi;
const MAX_STRING = 12000;
const MAX_DEPTH = 7;

class RunStore {
  constructor(directory) {
    this.directory = directory;
    this.ledgerDirectory = path.join(directory, "ledger");
    fs.mkdirSync(directory, { recursive: true });
    fs.mkdirSync(this.ledgerDirectory, { recursive: true });
  }

  pathFor(id) {
    return path.join(this.directory, `${id}.json`);
  }

  ledgerPathFor(id) {
    return path.join(this.ledgerDirectory, `${id}.json`);
  }

  save(run) {
    const file = this.pathFor(run.id);
    const previous = `${file}.prev`;
    if (fs.existsSync(file)) fs.copyFileSync(file, previous);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(run, null, 2));
    fs.renameSync(tmp, file);
    this.saveLedger(run);
    return run;
  }

  saveLedger(run) {
    if (!run || !run.id) return null;
    const ledger = buildRunLedger(run);
    atomicWriteJson(this.ledgerPathFor(run.id), ledger);
    return ledger;
  }

  loadLedger(id) {
    return readJson(this.ledgerPathFor(id));
  }

  load(id) {
    const file = this.pathFor(id);
    const parsed = readJson(file);
    if (parsed) return parsed;
    return readJson(`${file}.prev`);
  }
}

function buildRunLedger(run, now = Date.now()) {
  const startedAt = firstTimestamp(run) || now;
  const finishedAt = terminalLifecycle(run.lifecycle) ? lastTimestamp(run) || now : null;
  const calls = Array.isArray(run.toolCalls) ? run.toolCalls : [];
  const events = calls.map((call, index) => toolEvent(call, index, startedAt));
  const errors = events.filter((event) => event.status === "failed").map((event) => ({
    eventId: event.id,
    tool: event.tool,
    at: event.finishedAt || event.startedAt,
    code: event.error && event.error.code || "",
    message: event.error && event.error.message || "",
  }));
  return {
    schemaVersion: 1,
    runId: String(run.id),
    request: {
      goal: redact(run.goal || ""),
      mode: run.composerMode || run.mode || "",
      taskClass: run.taskClass || "",
    },
    model: {
      id: run.model || "",
      provider: run.providerName || run.provider || "",
    },
    lifecycle: run.lifecycle || "unknown",
    startedAt: iso(startedAt),
    finishedAt: finishedAt ? iso(finishedAt) : null,
    durationMs: finishedAt ? Math.max(0, finishedAt - startedAt) : Math.max(0, now - startedAt),
    summary: {
      eventCount: events.length,
      toolCalls: events.length,
      failedToolCalls: errors.length,
      filesChanged: Array.isArray(run.filesChanged) ? run.filesChanged.slice() : [],
      verification: redact(run.verification || null),
      outcome: redact(run.outcome || null),
    },
    context: contextTelemetry(run),
    errors,
    events,
  };
}

function toolEvent(call, index, fallbackTime) {
  const started = timestamp(call && (call.startedAt || call.started_at || call.createdAt || call.at)) || fallbackTime;
  const finished = timestamp(call && (call.finishedAt || call.finished_at || call.completedAt));
  const result = call && call.result;
  const ok = result ? result.ok !== false : !(call && call.error);
  const error = !ok ? normalizeError(result && result.error || call && call.error || result) : null;
  return {
    id: `evt_${String(index + 1).padStart(4, "0")}`,
    sequence: index + 1,
    type: "tool",
    tool: String(call && call.name || "unknown"),
    iteration: Number.isFinite(Number(call && call.iteration)) ? Number(call.iteration) : null,
    startedAt: iso(started),
    finishedAt: finished ? iso(finished) : null,
    durationMs: duration(call, started, finished),
    status: ok ? "success" : "failed",
    input: redact(call && (call.args || call.arguments || call.input) || {}),
    result: compactResult(result),
    error,
  };
}

function contextTelemetry(run) {
  const history = Array.isArray(run.conversationHistory) ? run.conversationHistory : [];
  const decisions = Array.isArray(run.decisions) ? run.decisions : [];
  const toolCalls = Array.isArray(run.toolCalls) ? run.toolCalls : [];
  const approxChars = safeJsonLength(history) + safeJsonLength(decisions) + safeJsonLength(toolCalls);
  return {
    schemaVersion: 1,
    approximateCharacters: approxChars,
    approximateTokens: Math.ceil(approxChars / 4),
    conversationMessages: history.length,
    decisions: decisions.length,
    toolCalls: toolCalls.length,
    compactions: Number(run.contextCompactions || 0),
    note: "Approximate telemetry only; automatic context compaction is not enabled in Run Ledger v1.",
  };
}

function compactResult(result) {
  if (result == null) return null;
  const clean = redact(result);
  const raw = JSON.stringify(clean);
  if (raw.length <= MAX_STRING) return clean;
  return {
    truncated: true,
    originalCharacters: raw.length,
    preview: redact(raw.slice(0, MAX_STRING)),
  };
}

function redact(value, key = "", depth = 0) {
  if (SECRET_KEY.test(String(key))) return "[REDACTED]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    return value.replace(SECRET_VALUE, "[REDACTED]").slice(0, MAX_STRING);
  }
  if (depth >= MAX_DEPTH) return "[MAX_DEPTH]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redact(item, "", depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [childKey, childValue] of Object.entries(value).slice(0, 100)) {
      out[childKey] = redact(childValue, childKey, depth + 1);
    }
    return out;
  }
  return String(value);
}

function normalizeError(error) {
  if (!error) return null;
  if (typeof error === "string") return { code: "", message: redact(error) };
  return {
    code: String(error.code || error.name || ""),
    message: redact(error.message || error.stderr || error.detail || "Tool failed"),
  };
}

function duration(call, started, finished) {
  const explicit = Number(call && (call.durationMs || call.duration_ms));
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  return finished ? Math.max(0, finished - started) : null;
}

function firstTimestamp(run) {
  const candidates = [
    run.startedAt, run.started_at, run.createdAt, run.created_at,
    run.lifecycleStartedAt, run.updatedAt, run.updated_at,
  ];
  for (const value of candidates) {
    const parsed = timestamp(value);
    if (parsed) return parsed;
  }
  return 0;
}

function lastTimestamp(run) {
  const candidates = [run.finishedAt, run.finished_at, run.completedAt, run.updatedAt, run.updated_at];
  for (const value of candidates) {
    const parsed = timestamp(value);
    if (parsed) return parsed;
  }
  return 0;
}

function timestamp(value) {
  if (!value) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value) {
  return new Date(value || Date.now()).toISOString();
}

function terminalLifecycle(value) {
  return ["completed", "failed", "cancelled", "awaiting_user"].includes(String(value || ""));
}

function safeJsonLength(value) {
  try { return JSON.stringify(value || []).length; } catch { return 0; }
}

function atomicWriteJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

module.exports = { RunStore, buildRunLedger, redact };
