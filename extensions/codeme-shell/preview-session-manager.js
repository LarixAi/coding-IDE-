const { previewPlan, ensureStaticPreview, recoverFlagSocket, probe } = require("./preview-runner");

const PROCESS_LOG_LIMIT = 50000;

function createPreviewSessionManager(vscode, options = {}) {
  const sessions = new Map();
  let sequence = 0;
  const waitForShell = options.waitForShellIntegration || ((terminal) => waitForShellIntegration(vscode, terminal));
  const probePreview = options.probe || probe;
  const healthGraceMs = Math.max(0, Number(options.healthGraceMs ?? 2500));

  function key(root) {
    return String(root || "");
  }

  function current(root) {
    return sessions.get(key(root)) || null;
  }

  function snapshot(root, includeOutput = false) {
    const record = current(root);
    if (!record) {
      return {
        found: false,
        sessionId: "",
        id: "",
        kind: "",
        status: "none",
        command: "",
        port: null,
        origin: "",
        url: "",
        exitCode: null,
        startedAt: null,
        endedAt: null,
        healthCode: "",
        healthMessage: "",
        output: includeOutput ? "" : undefined,
      };
    }
    return {
      found: true,
      sessionId: record.id,
      id: record.id,
      kind: record.kind,
      status: record.status,
      command: record.command,
      port: record.port || null,
      origin: record.origin || "",
      url: record.url || record.origin || "",
      exitCode: record.exitCode,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      restartCount: Number(record.restartCount || 0),
      healthCode: String(record.healthCode || ""),
      healthMessage: String(record.healthMessage || ""),
      output: includeOutput ? record.output : undefined,
    };
  }

  function adoptUrl(root, reachableUrl) {
    const record = current(root);
    if (!record || !reachableUrl) return snapshot(root, false);
    try {
      const reachable = new URL(String(reachableUrl));
      if (!["127.0.0.1", "localhost"].includes(reachable.hostname)) return snapshot(root, false);
      const existing = new URL(String(record.url || record.origin || reachableUrl));
      existing.protocol = reachable.protocol;
      existing.hostname = reachable.hostname;
      existing.port = reachable.port;
      record.origin = reachable.origin;
      record.url = existing.toString();
      record.healthCode = "reachable";
      record.healthMessage = "Preview answered on " + reachable.hostname + ".";
      record.updatedAt = new Date().toISOString();
    } catch {}
    return snapshot(root, false);
  }

  async function refresh(root) {
    const record = current(root);
    if (!record || record.status !== "running" || !record.origin) return snapshot(root, false);

    const target = String(record.url || record.origin);
    const health = await probePreview(target);
    if (health && health.url && health.code !== "preview_not_running") adoptUrl(root, health.url);

    if (health && (health.available || health.code !== "preview_not_running")) {
      record.healthCode = health.available ? "reachable" : String(health.code || "http_response");
      record.healthMessage = health.available
        ? "Preview is reachable."
        : String(health.message || "Preview process answered.");
      record.updatedAt = new Date().toISOString();
      return snapshot(root, false);
    }

    const startedAt = Date.parse(String(record.startedAt || ""));
    const ageMs = Number.isFinite(startedAt) ? Date.now() - startedAt : healthGraceMs;
    if (ageMs < healthGraceMs) {
      record.healthCode = "starting";
      record.healthMessage = "Preview has not answered yet; still inside startup grace period.";
      return snapshot(root, false);
    }

    record.status = "stale";
    record.healthCode = String(health && (health.cause || health.code) || "preview_not_running");
    record.healthMessage = String(health && health.message || "The recorded preview process is no longer reachable.");
    record.updatedAt = new Date().toISOString();
    return snapshot(root, false);
  }

  async function stop(root) {
    const record = current(root);
    if (!record) return snapshot(root, false);

    if (record.kind === "static" && record.server && record.server.listening) {
      await new Promise((resolve) => {
        try {
          record.server.close(() => resolve());
        } catch {
          resolve();
        }
      });
    } else if (record.terminal && typeof record.terminal.dispose === "function") {
      try { record.terminal.dispose(); } catch {}
      if (record.origin) await waitForOriginToStop(record.origin, 4000);
    }

    record.status = "stopped";
    record.exitCode = record.exitCode === null ? 0 : record.exitCode;
    record.endedAt = new Date().toISOString();
    record.updatedAt = record.endedAt;
    return snapshot(root, false);
  }

  async function start(root, requestedCommand = "") {
    const workspace = key(root);
    if (!workspace) throw Object.assign(new Error("Preview session requires a workspace root"), { code: "no_workspace" });

    const old = current(workspace);
    if (old && ["running", "stale"].includes(old.status)) await stop(workspace);

    recoverFlagSocket(workspace);

    const plan = previewPlan(workspace, "index.html");
    if (!plan.ok) throw Object.assign(new Error(plan.message || "Preview plan failed"), { code: plan.code || "preview_plan_failed" });
    const command = String(requestedCommand || "").trim() || String(plan.command || "").trim();

    if (!command) {
      const staticPreview = await ensureStaticPreview(workspace, plan.port || 4173);
      const now = new Date().toISOString();
      const record = {
        id: old ? old.id : `preview_${++sequence}`,
        workspace,
        kind: "static",
        command: "static-preview",
        port: Number(staticPreview.port) || plan.port || 4173,
        origin: `http://127.0.0.1:${Number(staticPreview.port) || plan.port || 4173}`,
        url: "",
        server: staticPreview.server,
        terminal: null,
        execution: null,
        status: "running",
        exitCode: null,
        output: "",
        startedAt: now,
        updatedAt: now,
        endedAt: null,
        restartCount: old ? Number(old.restartCount || 0) + 1 : 0,
        healthCode: "starting",
        healthMessage: "Static preview started.",
      };
      record.url = new URL(plan.staticPath || "/", record.origin).toString();
      sessions.set(workspace, record);
      if (record.server && typeof record.server.once === "function") {
        record.server.once("close", () => {
          if (record.status === "running") {
            record.status = "stopped";
            record.exitCode = 0;
            record.endedAt = new Date().toISOString();
            record.updatedAt = record.endedAt;
          }
        });
      }
      return { ...snapshot(workspace, true), started: true, restarted: Boolean(old), terminal: "" };
    }

    const terminal = vscode.window.createTerminal({
      name: "CodeMe Process",
      shellPath: process.platform === "win32" ? undefined : "/bin/bash",
      cwd: workspace,
    });
    terminal.show(true);

    let shellIntegration;
    try {
      shellIntegration = await waitForShell(terminal);
    } catch (error) {
      try { terminal.dispose(); } catch {}
      throw error;
    }

    const execution = await new Promise((resolve) => {
      setTimeout(() => resolve(shellIntegration.executeCommand(command)), 200);
    });

    let resolveEnded;
    const ended = new Promise((resolve) => { resolveEnded = resolve; });
    const now = new Date().toISOString();
    const record = {
      id: old ? old.id : `preview_${++sequence}`,
      workspace,
      kind: "process",
      command,
      port: plan.port || null,
      origin: plan.origin || "",
      url: plan.url || plan.origin || "",
      terminal,
      execution,
      status: "running",
      exitCode: null,
      output: "",
      startedAt: now,
      updatedAt: now,
      endedAt: null,
      ended,
      restartCount: old ? Number(old.restartCount || 0) + 1 : 0,
      healthCode: "starting",
      healthMessage: "Preview process started; waiting for HTTP readiness.",
    };
    sessions.set(workspace, record);

    const endDisposable = vscode.window.onDidEndTerminalShellExecution((event) => {
      if (event.execution && event.execution !== execution) return;
      if (!event.execution && event.shellIntegration !== shellIntegration) return;
      record.exitCode = typeof event.exitCode === "number" ? event.exitCode : 1;
      record.status = record.exitCode === 0 ? "exited" : "failed";
      record.endedAt = new Date().toISOString();
      record.updatedAt = record.endedAt;
      if (endDisposable && typeof endDisposable.dispose === "function") endDisposable.dispose();
      resolveEnded(record);
    });

    (async () => {
      try {
        for await (const chunk of execution.read()) appendOutput(record, chunk);
      } catch (error) {
        appendOutput(record, `\n[CodeMe log reader error] ${error instanceof Error ? error.message : String(error)}\n`);
      }
    })();

    await Promise.race([
      ended,
      new Promise((resolve) => setTimeout(resolve, 700)),
    ]);

    return {
      ...snapshot(workspace, true),
      started: record.status !== "failed",
      restarted: Boolean(old),
      terminal: "CodeMe Process",
    };
  }

  return {
    start,
    stop,
    refresh,
    adoptUrl,
    status(root) { return snapshot(root, false); },
    logs(root) { return snapshot(root, true); },
    current,
  };
}

async function waitForOriginToStop(origin, timeoutMs) {
  const deadline = Date.now() + Math.max(0, Number(timeoutMs || 0));
  while (Date.now() < deadline) {
    const current = await probe(origin);
    if (!current.available && current.code === "preview_not_running") return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

function redact(value) {
  return String(value || "")
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*=\s*([^\s]+)/g, "$1=[REDACTED]");
}

function appendOutput(record, chunk) {
  const next = redact(chunk);
  if (!next) return;
  record.output = (record.output + next).slice(-PROCESS_LOG_LIMIT);
  record.updatedAt = new Date().toISOString();
}

function waitForShellIntegration(vscode, terminal) {
  if (terminal && terminal.shellIntegration) return Promise.resolve(terminal.shellIntegration);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (disposable && typeof disposable.dispose === "function") disposable.dispose();
      reject(Object.assign(new Error("Terminal shell integration did not start"), { code: "terminal_timeout" }));
    }, 20000);
    const disposable = vscode.window.onDidChangeTerminalShellIntegration((event) => {
      if (event.terminal !== terminal) return;
      clearTimeout(timer);
      disposable.dispose();
      resolve(event.shellIntegration);
    });
    terminal.show();
  });
}

module.exports = {
  PROCESS_LOG_LIMIT,
  createPreviewSessionManager,
  waitForOriginToStop,
  redact,
};
