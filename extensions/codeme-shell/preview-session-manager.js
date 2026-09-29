const { previewPlan, ensureStaticPreview, recoverFlagSocket } = require("./preview-runner");

const PROCESS_LOG_LIMIT = 50000;

function createPreviewSessionManager(vscode, options = {}) {
  const sessions = new Map();
  let sequence = 0;
  const waitForShell = options.waitForShellIntegration || ((terminal) => waitForShellIntegration(vscode, terminal));

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
        exitCode: null,
        startedAt: null,
        endedAt: null,
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
      exitCode: record.exitCode,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      output: includeOutput ? record.output : undefined,
    };
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
    if (old && old.status === "running") await stop(workspace);

    recoverFlagSocket(workspace);

    const plan = previewPlan(workspace, "index.html");
    if (!plan.ok) throw Object.assign(new Error(plan.message || "Preview plan failed"), { code: plan.code || "preview_plan_failed" });
    const command = String(requestedCommand || "").trim() || String(plan.command || "").trim();

    if (!command) {
      const staticPreview = await ensureStaticPreview(workspace, plan.port || 4173);
      const now = new Date().toISOString();
      const record = {
        id: `preview_${++sequence}`,
        workspace,
        kind: "static",
        command: "static-preview",
        port: Number(staticPreview.port) || plan.port || 4173,
        origin: `http://127.0.0.1:${Number(staticPreview.port) || plan.port || 4173}`,
        server: staticPreview.server,
        terminal: null,
        execution: null,
        status: "running",
        exitCode: null,
        output: "",
        startedAt: now,
        updatedAt: now,
        endedAt: null,
      };
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
      id: `preview_${++sequence}`,
      workspace,
      kind: "process",
      command,
      port: plan.port || null,
      origin: plan.origin || "",
      terminal,
      execution,
      status: "running",
      exitCode: null,
      output: "",
      startedAt: now,
      updatedAt: now,
      endedAt: null,
      ended,
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
    status(root) { return snapshot(root, false); },
    logs(root) { return snapshot(root, true); },
    current,
  };
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
  redact,
};
