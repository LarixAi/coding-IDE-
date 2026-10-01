const crypto = require("crypto");

class PaperclipHttpError extends Error {
  constructor(statusCode, message, body = null) {
    super(message);
    this.name = "PaperclipHttpError";
    this.statusCode = statusCode;
    this.body = body;
    this.code = statusCode === 409 ? "paperclip_conflict" : "paperclip_http_error";
  }
}

class PaperclipApi {
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl || process.env.PAPERCLIP_API_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
    this.apiKey = String(options.apiKey || process.env.PAPERCLIP_API_KEY || "");
    this.timeoutMs = options.timeoutMs || 10000;
  }

  async request(method, pathname, body, runId) {
    const url = new URL(pathname, this.baseUrl);
    const headers = { Accept: "application/json" };
    if (this.apiKey) headers.Authorization = "Bearer " + this.apiKey;
    if (runId) headers["X-Paperclip-Run-Id"] = runId;
    let payload;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      headers["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: payload,
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = error && (error.name === "AbortError" || error.name === "TimeoutError");
      const wrapped = new Error(timedOut ? "Paperclip API timed out" : (error instanceof Error ? error.message : String(error)));
      wrapped.code = timedOut ? "paperclip_timeout" : "paperclip_unavailable";
      throw wrapped;
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let parsed = null;
    if (text) {
      try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 2000) }; }
    }
    if (!response.ok) {
      throw new PaperclipHttpError(
        response.status,
        "Paperclip API returned HTTP " + response.status,
        parsed,
      );
    }
    return parsed || {};
  }

  getIssue(issueId) {
    return this.request("GET", "/api/issues/" + encodeURIComponent(issueId));
  }

  checkout({ issueId, agentId, runId }) {
    return this.request(
      "POST",
      "/api/issues/" + encodeURIComponent(issueId) + "/checkout",
      {
        agentId,
        expectedStatuses: ["todo", "backlog", "blocked", "in_review", "in_progress"],
      },
      runId,
    );
  }

  updateIssue({ issueId, runId, status, comment }) {
    const body = {};
    if (status) body.status = status;
    if (comment) body.comment = comment;
    return this.request(
      "PATCH",
      "/api/issues/" + encodeURIComponent(issueId),
      body,
      runId,
    );
  }
}

function paperclipTaskPrompt(issue) {
  const title = String(issue && (issue.title || issue.identifier) || "Paperclip task").trim();
  const identifier = String(issue && issue.identifier || issue && issue.id || "").trim();
  const description = String(issue && issue.description || "").trim();
  const goal = issue && issue.goal && String(issue.goal.title || issue.goal.name || issue.goal.description || "").trim();
  const plan = issue && issue.planDocument && String(
    issue.planDocument.body || issue.planDocument.content || issue.planDocument.text || "",
  ).trim();

  const parts = [
    "Paperclip assigned task" + (identifier ? " " + identifier : "") + ": " + title,
    "",
    "Work only on this assigned task. Do not expand the scope into unrelated cleanup or redesign.",
  ];
  if (description) parts.push("", "Task description:", description);
  if (goal) parts.push("", "Parent goal:", goal);
  if (plan) parts.push("", "Approved/current plan:", plan);
  parts.push(
    "",
    "Execution discipline:",
    "- Make concrete progress in this heartbeat; do not only restate a plan.",
    "- Do not repeat an identical tool action without new evidence or a changed hypothesis.",
    "- If the same action would be repeated again, stop and report the blocker instead.",
    "- Use CodeMe verification evidence before claiming the task is complete.",
  );
  return parts.join("\n");
}

function toolSignature(tool) {
  if (!tool || !tool.name) return "";
  const args = tool.args && typeof tool.args === "object" ? tool.args : {};
  const target = args.path || args.query || args.url || args.command || "";
  return String(tool.name) + ":" + String(target || JSON.stringify(args));
}

function repeatedTool(tools, threshold = 3) {
  const history = (Array.isArray(tools) ? tools : [])
    .filter((item) => item && item.status !== "running")
    .map((item) => ({ signature: toolSignature(item), item }))
    .filter((entry) => entry.signature);
  if (history.length < threshold) return null;
  const tail = history.slice(-threshold);
  if (!tail.every((entry) => entry.signature === tail[0].signature)) return null;
  return {
    signature: tail[0].signature,
    count: threshold,
    tool: tail[0].item,
  };
}

function conciseOutcome(snapshot) {
  const outcome = snapshot && snapshot.outcome;
  if (outcome && outcome.summary) return String(outcome.summary).slice(0, 1800);
  if (snapshot && snapshot.error) return String(snapshot.error).slice(0, 1800);
  return snapshot && snapshot.stage ? String(snapshot.stage) : "No final summary was recorded.";
}

class PaperclipController {
  constructor(options = {}) {
    if (!options.session) throw new Error("PaperclipController requires a CodeMe session");
    this.session = options.session;
    this.api = options.api || new PaperclipApi(options);
    this.pollMs = options.pollMs || 750;
    this.repeatThreshold = options.repeatThreshold || 3;
    this.maxRunMs = options.maxRunMs || 30 * 60 * 1000;
    this.records = new Map();
    this.disposed = false;
  }

  snapshot() {
    const active = [...this.records.values()]
      .filter((record) => !["done", "blocked", "rejected"].includes(record.status))
      .map((record) => ({
        paperclipRunId: record.paperclipRunId,
        taskId: record.taskId,
        status: record.status,
        codemeRunId: record.codemeRunId || "",
      }));
    return { active };
  }

  async handleHeartbeat(payload) {
    const request = normalizeHeartbeat(payload);
    const existing = this.records.get(request.runId);
    if (existing) {
      return {
        ok: true,
        duplicate: true,
        status: existing.status,
        taskId: existing.taskId,
        codemeRunId: existing.codemeRunId || "",
      };
    }

    const current = this.session.snapshot();
    if (current && current.running) {
      const error = new Error("CodeMe is already running another task");
      error.code = "codeme_busy";
      error.statusCode = 409;
      throw error;
    }

    // Paperclip is deliberately model-agnostic. It never selects, pins,
    // ranks, or routes a model. CodeMe owns provider/model selection.
    // The controller only checks that CodeMe is able to accept work.
    if (!current || !current.selected) {
      await this.session.refreshModels();
      const refreshed = this.session.snapshot();
      if (!refreshed.selected) {
        const error = new Error("CodeMe cannot accept work because no model is currently available");
        error.code = "execution_unavailable";
        error.statusCode = 503;
        throw error;
      }
    }

    const issue = await this.api.getIssue(request.taskId);
    try {
      await this.api.checkout({
        issueId: request.taskId,
        agentId: request.agentId,
        runId: request.runId,
      });
    } catch (error) {
      if (error && error.statusCode === 409) {
        error.code = "task_owned_elsewhere";
      }
      throw error;
    }

    let resolveCompletion;
    const completion = new Promise((resolve) => { resolveCompletion = resolve; });
    const record = {
      id: crypto.randomUUID(),
      paperclipRunId: request.runId,
      agentId: request.agentId,
      companyId: request.companyId,
      taskId: request.taskId,
      issueIdentifier: issue && issue.identifier || request.taskId,
      status: "starting",
      codemeRunId: "",
      startedAt: Date.now(),
      repeat: null,
      completion,
      resolveCompletion,
      completionResolved: false,
    };
    this.records.set(request.runId, record);

    // Paperclip requires every issue-bound run to leave a run-attributed comment.
    // Leave that trace before the HTTP adapter returns 2xx, because CodeMe continues
    // asynchronously after the webhook has been accepted.
    try {
      await this.api.updateIssue({
        issueId: record.taskId,
        runId: record.paperclipRunId,
        comment: "CodeMe accepted this Paperclip run and is starting local execution. Final status will be posted when CodeMe finishes.",
      });
    } catch (error) {
      record.lastSyncError = error instanceof Error ? error.message : String(error);
    }

    this.session.selectMode("code");
    const submitted = await this.session.submit(paperclipTaskPrompt(issue), Date.now());

    if (!submitted || submitted.ok === false) {
      record.status = "blocked";
      const reason = submitted && (submitted.message || submitted.code) || "CodeMe rejected the task";
      await this.safeUpdate(record, "blocked", "CodeMe could not start this task: " + reason);
      this.resolveRecord(record);
      return { ok: false, status: record.status, taskId: record.taskId, reason };
    }

    if (submitted.status === "NEEDS_CLARIFICATION") {
      record.status = "blocked";
      const questions = this.session.snapshot().clarification;
      const text = questions && Array.isArray(questions.questions)
        ? questions.questions.map((item, index) => (index + 1) + ". " + item.question).join("\n")
        : "CodeMe needs clarification before it can execute this task.";
      await this.safeUpdate(
        record,
        "blocked",
        "CodeMe needs clarification before continuing:\n" + text,
      );
      this.resolveRecord(record);
      return { ok: true, status: record.status, taskId: record.taskId, needsClarification: true };
    }

    if (submitted.status === "NEEDS_RESEARCH") {
      record.status = "blocked";
      const research = this.session.snapshot().researchRequest;
      const queries = research && Array.isArray(research.queries) ? research.queries.join("; ") : "";
      await this.safeUpdate(
        record,
        "blocked",
        "CodeMe stopped for external research" + (queries ? ": " + queries : "."),
      );
      this.resolveRecord(record);
      return { ok: true, status: record.status, taskId: record.taskId, needsResearch: true };
    }

    record.status = "running";
    record.codemeRunId = submitted.runId || "";
    this.watch(record).catch(() => {});
    return {
      ok: true,
      accepted: true,
      status: record.status,
      taskId: record.taskId,
      codemeRunId: record.codemeRunId,
    };
  }

  completionResult(record) {
    return {
      ok: record.status === "done",
      accepted: true,
      completed: ["done", "blocked", "rejected"].includes(record.status),
      status: record.status,
      taskId: record.taskId,
      codemeRunId: record.codemeRunId || "",
      repeat: record.repeat || null,
    };
  }

  resolveRecord(record) {
    if (!record || record.completionResolved) return;
    record.completionResolved = true;
    try { record.resolveCompletion(this.completionResult(record)); } catch {}
  }

  async waitForCompletion(runId) {
    const record = this.records.get(String(runId || ""));
    if (!record) {
      const error = new Error("Unknown Paperclip run");
      error.code = "paperclip_run_not_found";
      error.statusCode = 404;
      throw error;
    }
    if (["done", "blocked", "rejected"].includes(record.status)) {
      return this.completionResult(record);
    }
    return record.completion;
  }

  async watch(record) {
    while (!this.disposed && record.status === "running") {
      const snapshot = this.session.snapshot();
      if (record.codemeRunId && snapshot.runId && snapshot.runId !== record.codemeRunId) {
        record.status = "blocked";
        await this.safeUpdate(record, "blocked", "CodeMe switched to a different run before this Paperclip task completed.");
        this.resolveRecord(record);
        return;
      }

      const repeat = repeatedTool(snapshot.tools, this.repeatThreshold);
      if (repeat) {
        record.repeat = repeat;
        record.status = "blocked";
        try { this.session.cancel(); } catch {}
        await this.safeUpdate(
          record,
          "blocked",
          "CodeMe stopped a repeated-action loop after " + repeat.count + " identical actions: " + repeat.signature + ". A new hypothesis or re-plan is required before retrying.",
        );
        this.resolveRecord(record);
        return;
      }

      if (Date.now() - record.startedAt > this.maxRunMs) {
        record.status = "blocked";
        try { this.session.cancel(); } catch {}
        await this.safeUpdate(record, "blocked", "CodeMe stopped because the Paperclip task exceeded its heartbeat execution limit.");
        this.resolveRecord(record);
        return;
      }

      if (!snapshot.running) {
        if (snapshot.stage === "Complete") {
          record.status = "done";
          const files = Array.isArray(snapshot.filesChanged) && snapshot.filesChanged.length
            ? "\nChanged files: " + snapshot.filesChanged.join(", ")
            : "";
          const verification = snapshot.verification && snapshot.verification.status
            ? "\nVerification: " + snapshot.verification.status
            : "";
          await this.safeUpdate(
            record,
            "done",
            "CodeMe completed the task.\n\n" + conciseOutcome(snapshot) + files + verification,
          );
        } else {
          record.status = "blocked";
          await this.safeUpdate(
            record,
            "blocked",
            "CodeMe stopped before verified completion.\n\n" + conciseOutcome(snapshot),
          );
        }
        this.resolveRecord(record);
        return;
      }

      await delay(this.pollMs);
    }
  }

  async safeUpdate(record, status, comment) {
    try {
      return await this.api.updateIssue({
        issueId: record.taskId,
        runId: record.paperclipRunId,
        status,
        comment,
      });
    } catch (error) {
      record.lastSyncError = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  dispose() {
    this.disposed = true;
  }
}

function normalizeHeartbeat(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw invalid("heartbeat body must be a JSON object");
  }
  const runId = String(payload.runId || "").trim();
  const agentId = String(payload.agentId || "").trim();
  const context = payload.context && typeof payload.context === "object" ? payload.context : {};
  const companyId = String(payload.companyId || context.companyId || "").trim();
  const taskId = String(context.taskId || payload.taskId || "").trim();
  if (!runId) throw invalid("runId is required");
  if (!agentId) throw invalid("agentId is required");
  if (!taskId) throw invalid("context.taskId is required");
  return { runId, agentId, companyId, taskId, context };
}

function invalid(message) {
  const error = new Error(message);
  error.code = "invalid_heartbeat";
  error.statusCode = 400;
  return error;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  PaperclipApi,
  PaperclipController,
  PaperclipHttpError,
  normalizeHeartbeat,
  paperclipTaskPrompt,
  repeatedTool,
  toolSignature,
};
