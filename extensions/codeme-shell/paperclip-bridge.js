const http = require("http");
const crypto = require("crypto");
const {
  PaperclipApi,
  PaperclipAgentRegistry,
  PaperclipController,
  PaperclipTeamOrchestrator,
} = require("../../packages/paperclip-control");

function envFlag(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

class PaperclipBridge {
  constructor(options = {}) {
    if (!options.session) throw new Error("PaperclipBridge requires a CodeMe session");
    this.session = options.session;
    this.enabled = options.enabled ?? envFlag(process.env.CODEME_PAPERCLIP_ENABLED, false);
    this.host = options.host || "127.0.0.1";
    this.port = Number(options.port || process.env.CODEME_PAPERCLIP_PORT || 7788);
    this.bridgeToken = String(options.bridgeToken || process.env.CODEME_PAPERCLIP_BRIDGE_TOKEN || "");
    this.companyId = String(options.companyId || process.env.PAPERCLIP_COMPANY_ID || "").trim();
    this.api = options.api || new PaperclipApi({
      baseUrl: options.paperclipApiUrl || process.env.PAPERCLIP_API_URL,
      apiKey: options.paperclipApiKey || process.env.PAPERCLIP_API_KEY,
    });
    this.agentRegistry = options.agentRegistry || new PaperclipAgentRegistry({
      defaultApiKey: this.api.apiKey,
      controllerAgentId: options.controllerAgentId || process.env.PAPERCLIP_CONTROLLER_AGENT_ID,
      rolesJson: options.rolesJson !== undefined
        ? options.rolesJson
        : process.env.CODEME_PAPERCLIP_AGENT_ROLES_JSON,
      keysJson: options.keysJson !== undefined
        ? options.keysJson
        : process.env.CODEME_PAPERCLIP_AGENT_KEYS_JSON,
    });
    this.controller = options.controller || new PaperclipController({
      session: this.session,
      api: this.api,
      agentRegistry: this.agentRegistry,
      apiFactory: (identity) => new PaperclipApi({
        baseUrl: this.api.baseUrl,
        apiKey: identity.apiKey,
        timeoutMs: this.api.timeoutMs,
      }),
      pollMs: options.pollMs,
      repeatThreshold: options.repeatThreshold,
      maxRunMs: options.maxRunMs,
    });
    this.teamOrchestrationEnabled = options.teamOrchestrationEnabled
      ?? envFlag(process.env.CODEME_PAPERCLIP_TEAM_ORCHESTRATION, true);
    this.teamOrchestrator = options.teamOrchestrator || new PaperclipTeamOrchestrator({
      api: this.api,
      agentRegistry: this.agentRegistry,
      pollMs: options.teamPollMs,
      maxChildMs: options.teamMaxChildMs,
      maxWorkflowMs: options.teamMaxWorkflowMs,
      maxRepairCycles: options.maxRepairCycles,
    });
    this.server = null;
    this.started = false;
  }

  configured() {
    return Boolean(this.bridgeToken && this.agentRegistry.hasCredential());
  }

  status() {
    return {
      enabled: this.enabled,
      configured: this.configured(),
      started: this.started,
      host: this.host,
      port: this.port,
      companyIdConfigured: Boolean(this.companyId),
      controller: this.controller.snapshot(),
      team: this.agentRegistry.summary(),
      orchestration: {
        enabled: this.teamOrchestrationEnabled,
        ...this.teamOrchestrator.snapshot(),
      },
      reason: !this.enabled
        ? "disabled"
        : !this.bridgeToken
          ? "bridge_token_missing"
          : !this.agentRegistry.hasCredential()
            ? "paperclip_agent_keys_missing"
            : "",
    };
  }

  async submitUserTask(goal, options = {}) {
    const text = String(goal || "").trim();
    if (!text) {
      const error = new Error("Multitask requires a non-empty goal");
      error.code = "invalid_args";
      throw error;
    }

    const state = this.status();
    if (!state.enabled || !state.configured || !state.started) {
      const error = new Error("Multitask requires the configured Paperclip bridge to be online.");
      error.code = "paperclip_not_ready";
      throw error;
    }
    if (!this.teamOrchestrationEnabled || !this.teamOrchestrator.configured()) {
      const error = new Error("Multitask requires the complete seven-role Paperclip team.");
      error.code = "paperclip_team_incomplete";
      throw error;
    }
    if (!this.companyId) {
      const error = new Error("PAPERCLIP_COMPANY_ID is required for Multitask.");
      error.code = "paperclip_company_missing";
      throw error;
    }

    const controller = this.agentRegistry.agentForRole("controller");
    if (!controller || !controller.agentId || !controller.configured) {
      const error = new Error("The Paperclip Controller identity is not configured.");
      error.code = "paperclip_controller_missing";
      throw error;
    }

    const rootRunId = "codeme-multitask-" + crypto.randomUUID();
    const title = text.replace(/\s+/g, " ").slice(0, 120);
    const parent = await this.api.createIssue({
      companyId: this.companyId,
      runId: rootRunId,
      issue: {
        title: title || "CodeMe Multitask",
        description: text,
        status: "todo",
      },
    });
    const taskId = String(parent && (parent.id || parent.issueId) || "").trim();
    if (!taskId) {
      const error = new Error("Paperclip created the Multitask parent without an issue id.");
      error.code = "paperclip_parent_invalid";
      throw error;
    }

    const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
    onProgress({ phase: "product", status: "starting", taskId, runId: rootRunId });

    for (let step = 0; step < 32; step += 1) {
      if (typeof options.isCancelled === "function" && options.isCancelled()) {
        return {
          ok: false,
          accepted: true,
          completed: true,
          status: "cancelled",
          taskId,
          runId: rootRunId,
          phase: "cancelled",
        };
      }
      const heartbeatRunId = rootRunId + "-step-" + String(step + 1);
      const result = await this.teamOrchestrator.handleHeartbeat({
        runId: heartbeatRunId,
        agentId: controller.agentId,
        companyId: this.companyId,
        context: { taskId },
      });

      onProgress({
        phase: result.phase || "team",
        status: result.status || "running",
        taskId,
        runId: rootRunId,
        childIssueId: result.childIssueId || "",
      });

      if (result.status === "done") {
        return { ...result, ok: true, taskId, runId: rootRunId };
      }
      if (result.status === "sync_failed") {
        const error = new Error(result.syncError || result.reason || "Paperclip team sync failed.");
        error.code = "paperclip_disposition_sync_failed";
        throw error;
      }

      if (result.childIssueId) {
        const child = await waitForIssueTerminal(
          this.api,
          result.childIssueId,
          options.childTimeoutMs || 30 * 60 * 1000,
          options.pollMs || 1000,
          (issue) => onProgress({
            phase: result.phase || "team",
            status: String(issue && issue.status || "waiting"),
            taskId,
            runId: rootRunId,
            childIssueId: result.childIssueId,
          }),
          options.isCancelled,
        );
        if (String(child && child.status || "") !== "done") {
          return {
            ok: false,
            accepted: true,
            completed: true,
            status: String(child && child.status || "blocked"),
            taskId,
            runId: rootRunId,
            phase: result.phase || "team",
            childIssueId: result.childIssueId,
            reason: "Paperclip child task did not complete successfully.",
          };
        }
        continue;
      }

      if (result.completed) return { ...result, taskId, runId: rootRunId };
      await delay(options.pollMs || 1000);
    }

    const error = new Error("Multitask exceeded the orchestration step limit.");
    error.code = "paperclip_team_step_limit";
    throw error;
  }

  async start() {
    if (!this.enabled || this.started) return this.status();
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        this.server.removeListener("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.removeListener("error", onError);
        resolve();
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(this.port, this.host);
    });
    this.started = true;
    console.log(
      "CodeMe Paperclip bridge listening on http://" + this.host + ":" + this.port +
      (this.configured() ? "" : " (configuration incomplete)"),
    );
    return this.status();
  }

  async handle(req, res) {
    const url = new URL(req.url || "/", "http://" + this.host + ":" + this.port);
    if (req.method === "GET" && url.pathname === "/healthz") {
      return sendJson(res, 200, { status: "ok", paperclip: this.status() });
    }

    if (req.method === "POST" && url.pathname === "/paperclip/heartbeat") {
      if (!this.configured()) {
        return sendJson(res, 503, {
          ok: false,
          code: "paperclip_not_configured",
          message: "Set CODEME_PAPERCLIP_BRIDGE_TOKEN and the Paperclip agent credentials before accepting Paperclip work.",
        });
      }
      const token = String(req.headers["x-codeme-paperclip-token"] || "");
      if (!token || !safeEqual(token, this.bridgeToken)) {
        return sendJson(res, 401, { ok: false, code: "unauthorized" });
      }

      let body;
      try {
        body = await readJson(req);
      } catch (error) {
        return sendJson(res, error.statusCode || 400, {
          ok: false,
          code: error.code || "invalid_json",
          message: error.message,
        });
      }

      try {
        const identity = this.agentRegistry.resolve(body.agentId);
        const useTeamOrchestration = (
          this.teamOrchestrationEnabled
          && this.agentRegistry.summary().mode === "multi-agent"
          && identity.role.key === "controller"
        );
        const runtime = useTeamOrchestration ? this.teamOrchestrator : this.controller;
        const result = await runtime.handleHeartbeat(body);
        if (result.accepted && result.status === "running") {
          const terminal = await runtime.waitForCompletion(body.runId);
          if (terminal && terminal.status === "sync_failed") {
            return sendJson(res, 502, terminal);
          }
          return sendJson(res, 200, terminal);
        }
        if (result && result.status === "sync_failed") {
          return sendJson(res, 502, result);
        }
        return sendJson(res, 200, result);
      } catch (error) {
        return sendJson(res, error.statusCode || 500, {
          ok: false,
          code: error.code || "paperclip_bridge_error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    sendJson(res, 404, { ok: false, code: "not_found" });
  }

  dispose() {
    this.controller.dispose();
    this.teamOrchestrator.dispose();
    if (this.server) {
      try { this.server.close(); } catch {}
    }
    this.server = null;
    this.started = false;
  }
}

async function waitForIssueTerminal(api, issueId, timeoutMs, pollMs, onProgress, isCancelled) {
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs || 0));
  while (Date.now() < deadline) {
    if (typeof isCancelled === "function" && isCancelled()) {
      const error = new Error("Multitask was cancelled.");
      error.code = "paperclip_multitask_cancelled";
      throw error;
    }
    const issue = await api.getIssue(issueId);
    if (typeof onProgress === "function") onProgress(issue);
    const status = String(issue && issue.status || "");
    if (["done", "blocked", "cancelled", "rejected"].includes(status)) return issue;
    await delay(pollMs);
  }
  const error = new Error("Timed out waiting for Paperclip child task " + issueId);
  error.code = "paperclip_child_timeout";
  throw error;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        const error = new Error("Request body is too large");
        error.code = "body_too_large";
        error.statusCode = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch {
        const error = new Error("Request body must be valid JSON");
        error.code = "invalid_json";
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && require("crypto").timingSafeEqual(a, b);
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.setHeader("content-length", Buffer.byteLength(payload));
  res.end(payload);
}

module.exports = { PaperclipBridge, envFlag, readJson, safeEqual, waitForIssueTerminal };
