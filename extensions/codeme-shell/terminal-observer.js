const path = require("path");

const MAX_HISTORY = 12;
const MAX_CAPTURE_CHARS = 20000;
const MAX_RETURN_CHARS = 12000;

const TOOL_DEFINITIONS = [
  {
    name: "terminal.last",
    description: "Read the most recent command observed in CodeMe's integrated terminal, including exit code and bounded redacted output. Use this when the user refers to a terminal command or error they already ran. This is read-only local evidence.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "terminal.failures",
    description: "Read recent failed commands observed in CodeMe's integrated terminal. Output is bounded and secrets are redacted. Use this before asking the user to paste terminal errors.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 5 },
      },
      required: [],
    },
  },
  {
    name: "terminal.debug_bundle",
    description: "Build a compact redacted debug bundle from the most recent failed integrated-terminal command. Use this before escalating a terminal failure to n8n; pass only the returned debugText and other explicitly selected project evidence, never raw terminal history.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];

function stripTerminalControl(value) {
  return String(value == null ? "" : value)
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, "")
    .replace(/\x1B[@-_]/g, "")
    .replace(/\r/g, "")
    .replace(/[^\x09\x0A\x20-\x7E]/g, "");
}

function redactSecrets(value) {
  let text = stripTerminalControl(value);

  text = text.replace(
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gi,
    "[REDACTED PRIVATE KEY]",
  );

  text = text.replace(
    /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}={0,2}/gi,
    "Bearer [REDACTED]",
  );

  text = text.replace(
    /\b(?:github_pat_[A-Za-z0-9_]{10,}|gh[pousr]_[A-Za-z0-9_]{10,}|sk-(?:proj-)?[A-Za-z0-9_-]{10,}|npm_[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{16})\b/g,
    "[REDACTED TOKEN]",
  );

  text = text.replace(
    /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|AUTH|COOKIE|PRIVATE_KEY|ACCESS_KEY|CLIENT_SECRET)[A-Z0-9_]*)=([^\s]+)/gi,
    "$1=[REDACTED]",
  );

  text = text.replace(
    /(["']?(?:token|secret|password|passwd|api[_-]?key|authorization|client[_-]?secret|access[_-]?key)["']?\s*[:=]\s*)(["']?)[^\s,"'}]+\2/gi,
    "$1[REDACTED]",
  );

  text = text.replace(
    /(\b--?(?:token|password|passwd|secret|api-key|apikey|authorization|auth)\s+)(?:"[^"]*"|'[^']*'|\S+)/gi,
    "$1[REDACTED]",
  );

  text = text.replace(
    /([?&](?:token|key|api_key|apikey|secret|password|auth|authorization)=)[^&\s]+/gi,
    "$1[REDACTED]",
  );

  text = text.replace(
    /(https?:\/\/)([^\s/:@]+):([^\s/@]+)@/gi,
    "$1[REDACTED]@",
  );

  return text;
}

function boundText(value, limit = MAX_RETURN_CHARS) {
  const text = String(value == null ? "" : value);
  if (text.length <= limit) return text;
  const head = Math.min(3000, Math.floor(limit / 3));
  const tail = Math.max(0, limit - head - 48);
  return text.slice(0, head) + "\n…[terminal output clipped]…\n" + text.slice(-tail);
}

function workspaceCwd(vscodeApi, cwd) {
  const fsPath = cwd && typeof cwd.fsPath === "string" ? cwd.fsPath : "";
  if (!fsPath) return "";
  const folders = vscodeApi.workspace && Array.isArray(vscodeApi.workspace.workspaceFolders)
    ? vscodeApi.workspace.workspaceFolders
    : [];
  for (const folder of folders) {
    const root = folder && folder.uri && folder.uri.fsPath;
    if (!root) continue;
    const relative = path.relative(root, fsPath);
    if (!relative) return ".";
    if (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative)) {
      return relative.split(path.sep).join("/");
    }
  }
  return "[outside-workspace]";
}

function publicRecord(record) {
  if (!record) return null;
  return {
    id: record.id,
    terminal: record.terminal,
    command: boundText(redactSecrets(record.command), 3000),
    commandConfidence: record.commandConfidence,
    commandTrusted: record.commandTrusted,
    cwd: record.cwd,
    status: record.status,
    exitCode: record.exitCode,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    output: boundText(redactSecrets(record.output), MAX_RETURN_CHARS),
    truncated: Boolean(record.truncated),
  };
}

function debugBundle(record) {
  const item = publicRecord(record);
  if (!item) return null;
  const lines = [
    "CodeMe integrated-terminal failure",
    "Command: " + (item.command || "(unknown)"),
    "Exit code: " + (item.exitCode === undefined || item.exitCode === null ? "unknown" : item.exitCode),
    "Working directory: " + (item.cwd || "(unknown)"),
    "Terminal: " + (item.terminal || "(unknown)"),
    "",
    "Redacted terminal output:",
    item.output || "(no output captured)",
  ];
  return {
    ...item,
    debugText: boundText(lines.join("\n"), MAX_RETURN_CHARS),
    safeForExternalResearch: true,
    note: "This bundle is bounded and redacted by CodeMe. Add only the minimum extra project evidence required before sending it to an external tool.",
  };
}

class TerminalObserver {
  constructor(vscodeApi, options = {}) {
    this.vscode = vscodeApi;
    this.now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
    this.history = [];
    this.active = new Map();
    this.disposables = [];
    this.nextId = 1;
    this.started = false;
  }

  start() {
    if (this.started) return this;
    this.started = true;
    const window = this.vscode && this.vscode.window;
    if (!window) return this;

    if (typeof window.onDidStartTerminalShellExecution === "function") {
      this.disposables.push(window.onDidStartTerminalShellExecution((event) => this.onStart(event)));
    }
    if (typeof window.onDidEndTerminalShellExecution === "function") {
      this.disposables.push(window.onDidEndTerminalShellExecution((event) => this.onEnd(event)));
    }
    return this;
  }

  onStart(event) {
    const execution = event && event.execution;
    if (!execution) return;

    const commandLine = execution.commandLine || {};
    const record = {
      id: "terminal_" + this.nextId++,
      terminal: event.terminal && event.terminal.name ? String(event.terminal.name) : "",
      command: String(commandLine.value || ""),
      commandConfidence: typeof commandLine.confidence === "number" ? commandLine.confidence : null,
      commandTrusted: commandLine.isTrusted === true,
      cwd: workspaceCwd(this.vscode, execution.cwd),
      status: "running",
      exitCode: null,
      startedAt: this.now(),
      endedAt: null,
      output: "",
      truncated: false,
    };
    this.active.set(execution, record);
    this.history.push(record);
    if (this.history.length > MAX_HISTORY) this.history.splice(0, this.history.length - MAX_HISTORY);

    try {
      const stream = execution.read();
      this.capture(stream, record);
    } catch {
      // Shell integration can report a command even when output streaming is unavailable.
    }
  }

  async capture(stream, record) {
    try {
      for await (const chunk of stream) {
        const next = record.output + String(chunk || "");
        if (next.length > MAX_CAPTURE_CHARS) {
          record.output = boundText(next, MAX_CAPTURE_CHARS);
          record.truncated = true;
        } else {
          record.output = next;
        }
      }
    } catch {
      // Observation failure must never interfere with the user's terminal.
    }
  }

  onEnd(event) {
    const execution = event && event.execution;
    if (!execution) return;
    const record = this.active.get(execution) || this.history[this.history.length - 1];
    if (!record) return;

    const commandLine = execution.commandLine || {};
    if (commandLine.value) record.command = String(commandLine.value);
    if (typeof commandLine.confidence === "number") record.commandConfidence = commandLine.confidence;
    if (commandLine.isTrusted === true) record.commandTrusted = true;

    record.exitCode = typeof event.exitCode === "number" ? event.exitCode : null;
    record.status = record.exitCode === 0 ? "completed" : (record.exitCode === null ? "unknown" : "failed");
    record.endedAt = this.now();
    this.active.delete(execution);
  }

  last() {
    return this.history.length ? this.history[this.history.length - 1] : null;
  }

  failures(limit = 3) {
    const count = Math.max(1, Math.min(5, Number(limit) || 3));
    return this.history.filter((item) => item.status === "failed").slice(-count).reverse();
  }

  listTools() {
    return TOOL_DEFINITIONS.map((item) => ({
      ...item,
      parameters: JSON.parse(JSON.stringify(item.parameters)),
    }));
  }

  async call(name, args = {}) {
    if (name === "terminal.last") {
      const item = publicRecord(this.last());
      return item
        ? { ok: true, tool: name, trusted: true, data: item }
        : {
            ok: false,
            tool: name,
            trusted: true,
            error: {
              code: "terminal_history_empty",
              message: "No integrated-terminal command has been observed since CodeMe terminal observation started.",
            },
          };
    }

    if (name === "terminal.failures") {
      const items = this.failures(args.limit).map(publicRecord);
      return {
        ok: true,
        tool: name,
        trusted: true,
        data: { failures: items, count: items.length },
      };
    }

    if (name === "terminal.debug_bundle") {
      const latestFailure = this.failures(1)[0];
      const bundle = debugBundle(latestFailure);
      return bundle
        ? { ok: true, tool: name, trusted: true, data: bundle }
        : {
            ok: false,
            tool: name,
            trusted: true,
            error: {
              code: "terminal_failure_missing",
              message: "No failed integrated-terminal command has been observed yet.",
            },
          };
    }

    return {
      ok: false,
      tool: name,
      trusted: true,
      error: { code: "unknown_local_tool", message: "Unknown terminal observation tool" },
    };
  }

  dispose() {
    for (const disposable of this.disposables.splice(0)) {
      try { if (disposable && typeof disposable.dispose === "function") disposable.dispose(); } catch {}
    }
    this.active.clear();
    this.started = false;
  }
}

module.exports = {
  TerminalObserver,
  TOOL_DEFINITIONS,
  stripTerminalControl,
  redactSecrets,
  boundText,
  publicRecord,
  debugBundle,
};
