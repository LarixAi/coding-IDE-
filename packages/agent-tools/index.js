const path = require("path");

const TOOLS = {
  "workspace.inspect": [],
  "file.read": ["path"],
  "file.write": ["path", "contents"],
  "file.patch": ["path", "oldText", "newText"],
  "repo.search": ["query"],
  "terminal.run": ["command"],
  "process.start": [],
  "process.status": [],
  "process.logs": [],
  "git.status": [],
  "git.diff": [],
  "diagnostics.run": [],
  "tests.run": ["command"],
  "browser.check": ["url"],
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
      && (tool === "terminal.run" || tool === "tests.run" || tool === "process.start")
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
    case "process.start":
      return host.startProcess(args.command || "npm start");
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
      return host.browserCheck(args.url);
    case "dir.create":
      return host.createDirectory(args.path);
    case "dir.list":
      return host.listDirectory(args.path);
    default:
      throw Object.assign(new Error(`Unknown tool: ${tool}`), { code: "unknown_tool" });
  }
}

const READ_ONLY_TOOLS = ["workspace.inspect", "file.read", "repo.search", "process.status", "process.logs", "git.status", "git.diff", "diagnostics.run", "browser.check", "dir.list"];
const CONTROLLED_TOOLS = ["workspace.inspect", "file.read", "file.write", "file.patch", "repo.search", "terminal.run", "process.start", "process.status", "process.logs", "diagnostics.run", "tests.run", "git.status", "git.diff", "browser.check", "dir.create", "dir.list"];

function validateProcessCommand(command) {
  const text = typeof command === "string" && command.trim() ? command.trim() : "npm start";
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
  if (tool === "process.start") {
    const commandError = validateProcessCommand(input.command || "npm start");
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
  validateProcessCommand,
  validateWorkspacePath,
};
