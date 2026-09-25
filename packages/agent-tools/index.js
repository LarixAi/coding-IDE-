const path = require("path");

const TOOLS = {
  "file.read": ["path"],
  "file.write": ["path", "contents"],
  "repo.search": ["query"],
  "terminal.run": ["command"],
  "git.status": [],
  "git.diff": [],
  "diagnostics.run": [],
  "tests.run": ["command"],
  "browser.check": ["url"],
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
    if (data && typeof data.exitCode === "number" && data.exitCode !== 0) {
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
    case "file.read":
      return host.readFile(args.path);
    case "file.write":
      return host.writeFile(args.path, args.contents);
    case "repo.search":
      return host.search(args.query);
    case "terminal.run":
      return host.runTerminal(args.command);
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
    default:
      throw Object.assign(new Error(`Unknown tool: ${tool}`), { code: "unknown_tool" });
  }
}

const READ_ONLY_TOOLS = ["file.read", "repo.search", "git.status", "git.diff", "diagnostics.run", "browser.check"];

async function executeReadOnly(host, tool, args) {
  if (TOOLS[tool] && !READ_ONLY_TOOLS.includes(tool)) {
    return failure(tool, "mutation_blocked", `${tool} is blocked until read-only qualification passes`);
  }
  return execute(host, tool, args);
}

module.exports = {
  TOOLS: Object.keys(TOOLS),
  READ_ONLY_TOOLS,
  execute,
  executeReadOnly,
  validateWorkspacePath,
};
