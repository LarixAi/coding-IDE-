const path = require("path");

const TOOLS = {
  "workspace.inspect": [],
  "file.read": ["path"],
  "file.write": ["path", "contents"],
  "file.patch": ["path", "oldText", "newText"],
  "repo.search": ["query"],
  "terminal.run": ["command"],
  "sandbox.run": ["command"],
  "process.start": [],
  "process.status": [],
  "process.logs": [],
  "git.status": [],
  "git.diff": [],
  "diagnostics.run": [],
  "tests.run": ["command"],
  "browser.check": [],
  "browser.interact": ["action"],
  "dir.create": ["path"],
  "dir.list": ["path"],
};

function failure(tool, code, message, data) {
  return { ok: false, tool, error: { code, message }, ...(data === undefined ? {} : { data }) };
}

function success(tool, data) {
  return { ok: true, tool, data };
}

function validate(tool, args) {
  const required = TOOLS[tool];
  if (!required) {
    return failure(tool, "unknown_tool", `Unknown tool: ${tool}`);
  }
  const input = args && typeof args === "object" ? args : {};
  for (const key of required) {
    if (typeof input[key] !== "string" || input[key].length === 0) {
      return failure(tool, "invalid_args", `${tool} requires a non-empty string "${key}"`);
    }
  }
  if (required.includes("path")) {
    const pathError = validateWorkspacePath(input.path);
    if (pathError) return failure(tool, pathError.code, pathError.message);
  }
  if (tool === "browser.interact") {
    const action = String(input.action || "").trim().toLowerCase();
    const allowed = new Set(["click", "fill", "asserttext", "sequence"]);
    if (!allowed.has(action)) {
      return failure(tool, "invalid_args", "browser.interact supports click, fill, assertText, or sequence");
    }

    const validateStep = (step, indexLabel = "") => {
      const value = step && typeof step === "object" ? step : {};
      const stepAction = String(value.action || "").trim().toLowerCase();
      if (!["click", "fill", "asserttext"].includes(stepAction)) {
        return failure(tool, "invalid_args", `browser.interact ${indexLabel}has an unsupported action`);
      }
      const selector = typeof value.selector === "string" ? value.selector.trim() : "";
      const targetText = typeof value.targetText === "string" ? value.targetText.trim() : "";
      const expectedText = typeof value.expectedText === "string" ? value.expectedText.trim() : "";
      if (stepAction === "click" && !selector && !targetText) {
        return failure(tool, "invalid_args", `browser.interact ${indexLabel}click requires selector or targetText`);
      }
      if (stepAction === "fill") {
        if (!selector) return failure(tool, "invalid_args", `browser.interact ${indexLabel}fill requires selector`);
        if (typeof value.value !== "string") return failure(tool, "invalid_args", `browser.interact ${indexLabel}fill requires string value`);
      }
      if (stepAction === "asserttext" && !expectedText) {
        return failure(tool, "invalid_args", `browser.interact ${indexLabel}assertText requires expectedText`);
      }
      return null;
    };

    if (action === "sequence") {
      if (!Array.isArray(input.steps) || input.steps.length === 0 || input.steps.length > 12) {
        return failure(tool, "invalid_args", "browser.interact sequence requires 1-12 steps");
      }
      for (let index = 0; index < input.steps.length; index += 1) {
        const invalidStep = validateStep(input.steps[index], `sequence step ${index + 1} `);
        if (invalidStep) return invalidStep;
      }
    } else {
      const invalidStep = validateStep(input);
      if (invalidStep) return invalidStep;
    }
  }
  return null;
}

function validateWorkspacePath(relativePath) {
  if (path.isAbsolute(relativePath)) {
    return { code: "absolute_path", message: "Path must stay inside the workspace" };
  }
  if (relativePath.includes("\0")) {
    return { code: "invalid_args", message: "Path contains a null byte" };
  }
  const normalized = path.normalize(relativePath);
  const segments = normalized.split(path.sep);
  if (segments.some((segment) => segment.startsWith("--"))) {
    return { code: "flag_like_path", message: "A workspace path cannot look like a command-line flag such as --port" };
  }
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    return { code: "path_escape", message: "Path escapes the workspace" };
  }
  return null;
}

async function execute(host, tool, args) {
  const invalid = validate(tool, args ?? {});
  if (invalid) return invalid;

  try {
    const data = await dispatch(host, tool, args);
    if (
      data
      && typeof data.exitCode === "number"
      && data.exitCode !== 0
      && (tool === "terminal.run" || tool === "sandbox.run" || tool === "tests.run" || tool === "process.start")
    ) {
      return failure(tool, "exit_status", `Command exited ${data.exitCode}`, data);
    }
    if (data && data.available === false) {
      return failure(tool, data.code || "unavailable", data.message || "Unavailable", data);
    }
    return success(tool, data);
  } catch (error) {
    const code = error && error.code ? String(error.code) : "tool_failed";
    const message = error instanceof Error ? error.message : String(error);
    return failure(tool, code, message);
  }
}

async function dispatch(host, tool, args) {
  switch (tool) {
    case "workspace.inspect":
      return host.inspectWorkspace();
    case "file.read":
      return host.readFile(args.path);
    case "file.write":
      return host.writeFile(args.path, args.contents);
    case "file.patch":
      return host.patchFile(args.path, args.oldText, args.newText);
    case "repo.search":
      return host.search(args.query);
    case "terminal.run":
      return host.runTerminal(args.command);
    case "sandbox.run":
      return host.runSandbox(args);
    case "process.start":
      return host.startProcess(args.command || "");
    case "process.status":
      return host.processStatus();
    case "process.logs":
      return host.processLogs();
    case "git.status":
      return host.gitStatus();
    case "git.diff":
      return host.gitDiff();
    case "diagnostics.run":
      return host.diagnostics();
    case "tests.run":
      return host.runTests(args.command);
    case "browser.check":
      return host.browserCheck(args.url, args);
    case "browser.interact":
      return host.browserInteract(args);
    case "dir.create":
      return host.createDirectory(args.path);
    case "dir.list":
      return host.listDirectory(args.path);
    default:
      throw Object.assign(new Error(`Unknown tool: ${tool}`), { code: "unknown_tool" });
  }
}

const READ_ONLY_TOOLS = ["workspace.inspect", "file.read", "repo.search", "process.status", "process.logs", "git.status", "git.diff", "diagnostics.run", "browser.check", "dir.list"];
const CONTROLLED_TOOLS = ["workspace.inspect", "file.read", "file.write", "file.patch", "repo.search", "terminal.run", "sandbox.run", "process.start", "process.status", "process.logs", "diagnostics.run", "tests.run", "git.status", "git.diff", "browser.check", "browser.interact", "dir.create", "dir.list"];

function validateProcessCommand(command) {
  const text = typeof command === "string" ? command.trim() : "";
  if (!text) return null;
  const hasNull = Array.from(text).some((char) => char.charCodeAt(0) === 0);
  const hasShellSyntax = /[\n\r;&|$<>\\"\']/.test(text) || text.includes("`") || text.includes("(") || text.includes(")");
  if (hasNull || hasShellSyntax) {
    return { code: "command_rejected", message: "Process command contains shell syntax" };
  }
  if (text === "npm start" || text === "npm run dev" || text === "npm run preview") return null;
  return {
    code: "command_rejected",
    message: "process.start is limited to npm start, npm run dev, or npm run preview",
  };
}

function validateSandboxCommand(command) {
  const text = typeof command === "string" ? command.trim() : "";
  if (!text) {
    return { code: "invalid_args", message: "sandbox.run requires a non-empty command" };
  }
  if (/[\0\n\r;&|`$<>]/.test(text) || /["']/.test(text)) {
    return {
      code: "command_rejected",
      message: "Sandbox commands do not support shell syntax, quoting, pipes, redirects, or backgrounding",
    };
  }

  const parts = text.split(/\s+/);
  const program = parts.shift();
  const args = parts;

  function safeRelative(value) {
    const candidate = String(value || "");
    if (!candidate || candidate.startsWith("-") || path.isAbsolute(candidate) || /^[A-Za-z]:[\\/]/.test(candidate) || candidate.includes("..")) return false;
    return true;
  }

  if (program === "node") {
    if (args.length === 1 && safeRelative(args[0])) return null;
    if (args.length === 2 && args[0] === "--check" && safeRelative(args[1])) return null;
    if (args.length <= 2 && args[0] === "--test" && (!args[1] || safeRelative(args[1]))) return null;
    return {
      code: "command_rejected",
      message: "sandbox.run supports node <file>, node --check <file>, or node --test [file]",
    };
  }

  if (program === "npm") {
    if (args.length === 1 && args[0] === "test") return null;
    if (args.length === 2 && args[0] === "run" && /^[A-Za-z0-9:_-]+$/.test(args[1])) return null;
    return { code: "command_rejected", message: "sandbox.run supports npm test or npm run <script>" };
  }

  if (program === "python3") {
    if (args.length === 1 && safeRelative(args[0]) && /\.py$/i.test(args[0])) return null;
    if (args.length >= 2 && args.length <= 3 && args[0] === "-m" && args[1] === "pytest" && (!args[2] || safeRelative(args[2]))) return null;
    return {
      code: "command_rejected",
      message: "sandbox.run supports python3 <file.py> or python3 -m pytest [path]",
    };
  }

  return { code: "command_rejected", message: "sandbox.run allows node, npm, or python3 commands only" };
}

function validateCommand(command) {
  if (typeof command !== "string" || command.length === 0) {
    return { code: "invalid_args", message: "Command must be a non-empty string" };
  }
  if (/[\0\n\r;&|`$<>\\"']/.test(command) || command.includes("(") || command.includes(")")) {
    return { code: "command_rejected", message: "Command contains shell syntax" };
  }
  if (command.includes("..")) {
    return { code: "path_escape", message: "Command escapes the workspace" };
  }
  const parts = command.trim().split(/\s+/);
  if (parts[0] === "npm") {
    if (parts.length !== 2 || parts[1] !== "test") {
      return { code: "command_rejected", message: "npm is limited to npm test" };
    }
    return null;
  }
  if (parts[0] !== "node") {
    return { code: "command_rejected", message: "Only node and npm test are allowed" };
  }
  const fileArgs = parts.slice(1).filter((part) => part !== "--check");
  if (fileArgs.length !== 1 || fileArgs[0].startsWith("-")) {
    return { code: "command_rejected", message: "node must run one workspace file" };
  }
  if (path.isAbsolute(fileArgs[0])) {
    return { code: "absolute_path", message: "Path must stay inside the workspace" };
  }
  return validateWorkspacePath(fileArgs[0]);
}

async function executeReadOnly(host, tool, args) {
  if (TOOLS[tool] && !READ_ONLY_TOOLS.includes(tool)) {
    return failure(tool, "mutation_blocked", `${tool} is blocked until read-only qualification passes`);
  }
  return execute(host, tool, args);
}

async function executeControlled(host, tool, args) {
  if (!CONTROLLED_TOOLS.includes(tool)) {
    return failure(tool, "policy_denied", `${tool} is outside the controlled coding grant`);
  }
  const input = args && typeof args === "object" ? args : {};
  if (tool === "terminal.run" || tool === "tests.run") {
    const commandError = validateCommand(input.command);
    if (commandError) return failure(tool, commandError.code, commandError.message);
  }
  if (tool === "sandbox.run") {
    const commandError = validateSandboxCommand(input.command);
    if (commandError) return failure(tool, commandError.code, commandError.message);
    if (input.timeoutMs !== undefined) {
      const timeoutMs = Number(input.timeoutMs);
      if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
        return failure(tool, "invalid_args", "sandbox.run timeoutMs must be between 1000 and 120000");
      }
    }
  }
  if (tool === "process.start") {
    const commandError = validateProcessCommand(input.command);
    if (commandError) return failure(tool, commandError.code, commandError.message);
  }
  return execute(host, tool, args);
}

module.exports = {
  TOOLS: Object.keys(TOOLS),
  READ_ONLY_TOOLS,
  CONTROLLED_TOOLS,
  execute,
  executeReadOnly,
  executeControlled,
  validateCommand,
  validateSandboxCommand,
  validateProcessCommand,
  validateWorkspacePath,
};
