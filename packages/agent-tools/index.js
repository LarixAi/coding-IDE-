const cp = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const TOOLS = {
  "workspace.inspect": [],
  "file.read": ["path"],
  "file.readRange": ["path"],
  "file.write": ["path", "contents"],
  "file.patch": ["path", "replacement"],
  "repo.search": ["query"],
  "terminal.run": ["command"],
  "git.status": [],
  "git.diff": [],
  "diagnostics.run": [],
  "tests.run": ["command"],
  "browser.check": ["url"],
  "dir.create": ["path"],
  "dir.list": ["path"],
  "process.run": [],
  "process.start": [],
  "process.status": ["id"],
  "process.stop": ["id"],
};

const PROCESS_EXECUTABLES = new Set(["npm", "npx", "node", "pnpm", "yarn"]);

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
  if (tool === "file.readRange") {
    const rangeError = lineRangeError(input.startLine, input.endLine);
    if (rangeError) return failure(tool, "invalid_args", rangeError);
  }
  if (tool === "file.patch") {
    const hasExpected = typeof input.expected === "string" && input.expected.length > 0;
    const hasRange = input.startLine != null || input.endLine != null;
    if (!hasExpected && !hasRange) {
      return failure(tool, "invalid_args", "file.patch requires expected text or a line range");
    }
    if (hasRange) {
      const rangeError = lineRangeError(input.startLine, input.endLine);
      if (rangeError) return failure(tool, "invalid_args", rangeError);
    }
  }
  if (tool === "process.run" || tool === "process.start") {
    const processError = validateProcess(input);
    if (processError) return failure(tool, processError.code, processError.message);
  }
  return null;
}

function validateProcess(input) {
  const executable = input && input.executable;
  const args = input && input.args;
  if (typeof executable !== "string" || !PROCESS_EXECUTABLES.has(executable)) {
    return { code: "command_rejected", message: "Only npm, npx, node, pnpm, and yarn are allowed" };
  }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    return { code: "invalid_args", message: "args must be an array of strings" };
  }
  for (const arg of args) {
    if (/[\0\n\r;&|`$<>\\"']/.test(arg) || arg.includes("(") || arg.includes(")")) {
      return { code: "command_rejected", message: "Command contains shell syntax" };
    }
    if (arg.includes("..") || path.isAbsolute(arg)) {
      return { code: "path_escape", message: "Command escapes the workspace" };
    }
  }
  if (executable === "node") {
    const fileArgs = args.filter((arg) => arg !== "--check");
    if (fileArgs.length !== 1 || fileArgs[0].startsWith("-")) {
      return { code: "command_rejected", message: "node must run one workspace file" };
    }
    return validateWorkspacePath(fileArgs[0]);
  }
  if (executable === "npx") {
    if (args.length === 0 || args[0] === "publish" || !/^[@A-Za-z0-9._/-]+$/.test(args[0])) {
      return { code: "command_rejected", message: "npx must run one package name" };
    }
    return null;
  }
  const sub = args[0];
  if (sub === "publish") return { code: "command_rejected", message: "publish is not allowed" };
  if (sub === "test" && args.length === 1) return null;
  if (sub === "install" && args.length === 1) return null;
  if (sub === "run" && args.length === 2 && /^[A-Za-z0-9:_-]+$/.test(args[1])) return null;
  return { code: "command_rejected", message: `${executable} is limited to test, install, and run <script>` };
}

function resolveExecutable(name) {
  if (name === "node") return process.execPath;
  const beside = path.join(path.dirname(process.execPath), name);
  if (fs.existsSync(beside)) return beside;
  return name;
}

function createProcessRunner(root) {
  const jobs = new Map();
  function spawnJob(spec) {
    const child = cp.spawn(resolveExecutable(spec.executable), spec.args, {
      cwd: root,
      shell: false,
      env: process.env,
    });
    const record = {
      id: `proc_${crypto.randomBytes(4).toString("hex")}`,
      child,
      executable: spec.executable,
      args: spec.args.slice(),
      stdout: "",
      stderr: "",
      exitCode: null,
      running: true,
    };
    const keep = (chunk, field) => {
      record[field] = (record[field] + chunk).slice(-8000);
    };
    child.stdout.on("data", (chunk) => keep(chunk, "stdout"));
    child.stderr.on("data", (chunk) => keep(chunk, "stderr"));
    child.on("error", (error) => {
      record.running = false;
      record.exitCode = 127;
      record.stderr = (record.stderr + error.message).slice(-8000);
    });
    child.on("close", (code) => {
      record.running = false;
      if (record.exitCode === null) record.exitCode = code === null ? 1 : code;
    });
    jobs.set(record.id, record);
    return record;
  }
  function snapshot(record) {
    return {
      id: record.id,
      executable: record.executable,
      args: record.args,
      command: [record.executable].concat(record.args).join(" "),
      running: record.running,
      exitCode: record.exitCode,
      stdout: record.stdout,
      stderr: record.stderr,
    };
  }
  return {
    run(spec) {
      const timeoutMs = Math.min(Math.max(Number(spec.timeoutMs) || 15000, 1), 60000);
      const record = spawnJob(spec);
      return new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          record.timedOut = true;
          record.child.kill("SIGKILL");
        }, timeoutMs);
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ ...snapshot(record), timedOut: Boolean(record.timedOut) });
        };
        record.child.on("close", finish);
        record.child.on("error", finish);
      });
    },
    start(spec) {
      return snapshot(spawnJob(spec));
    },
    status(id) {
      const record = jobs.get(id);
      if (!record) {
        throw Object.assign(new Error("Process is not running in this workspace"), { code: "not_found" });
      }
      return snapshot(record);
    },
    stop(id) {
      const record = jobs.get(id);
      if (!record) {
        throw Object.assign(new Error("Process is not running in this workspace"), { code: "not_found" });
      }
      if (record.running) record.child.kill("SIGTERM");
      return { id, stopped: true };
    },
  };
}

function lineRangeError(startLine, endLine) {
  const start = Number(startLine);
  const end = Number(endLine);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    return "startLine and endLine must be positive integers and endLine must be at least startLine";
  }
  return null;
}

function readRangeFromText(filePath, text, startLine, endLine) {
  const lines = String(text).split(/\r?\n/);
  const start = Number(startLine);
  const end = Number(endLine);
  if (start > lines.length || end > lines.length) {
    throw Object.assign(new Error("Line range is outside the file"), { code: "range_outside" });
  }
  return {
    path: filePath,
    startLine: start,
    endLine: end,
    contents: lines.slice(start - 1, end).join("\n"),
  };
}

function patchText(text, args) {
  const source = String(text);
  const replacement = String(args.replacement);
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const hasRange = args.startLine != null || args.endLine != null;
  if (hasRange) {
    const lines = source.split(/\r?\n/);
    const start = Number(args.startLine);
    const end = Number(args.endLine);
    if (start > lines.length || end > lines.length) {
      throw Object.assign(new Error("The file no longer matches the expected line range"), { code: "conflict" });
    }
    const current = lines.slice(start - 1, end).join("\n");
    if (typeof args.expected === "string" && current !== args.expected) {
      throw Object.assign(new Error("The file no longer matches the expected text"), { code: "conflict" });
    }
    const replacementLines = replacement.length ? replacement.split(/\r?\n/) : [""];
    lines.splice(start - 1, end - start + 1, ...replacementLines);
    return lines.join(newline);
  }
  const expected = String(args.expected);
  const count = source.split(expected).length - 1;
  if (count !== 1) {
    throw Object.assign(new Error(count === 0 ? "The expected text was not found" : "The expected text is not unique"), { code: "conflict" });
  }
  return source.replace(expected, replacement);
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
    case "workspace.inspect":
      return host.inspectWorkspace();
    case "file.read":
      return host.readFile(args.path);
    case "file.readRange":
      return readWorkspaceRange(host, args);
    case "file.write":
      return host.writeFile(args.path, args.contents);
    case "file.patch":
      return patchWorkspaceFile(host, args);
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
    case "dir.create":
      return host.createDirectory(args.path);
    case "dir.list":
      return host.listDirectory(args.path);
    case "process.run":
      return host.runProcess(args);
    case "process.start":
      return host.startProcess(args);
    case "process.status":
      return host.processStatus(args.id);
    case "process.stop":
      return host.stopProcess(args.id);
    default:
      throw Object.assign(new Error(`Unknown tool: ${tool}`), { code: "unknown_tool" });
  }
}

const READ_ONLY_TOOLS = ["workspace.inspect", "file.read", "file.readRange", "repo.search", "git.status", "git.diff", "diagnostics.run", "browser.check", "dir.list"];
const CONTROLLED_TOOLS = ["workspace.inspect", "file.read", "file.readRange", "file.write", "file.patch", "repo.search", "terminal.run", "diagnostics.run", "tests.run", "git.status", "git.diff", "browser.check", "dir.create", "dir.list", "process.run", "process.start", "process.status", "process.stop"];

async function readWorkspaceRange(host, args) {
  if (typeof host.readRange === "function") return host.readRange(args.path, Number(args.startLine), Number(args.endLine));
  const file = await host.readFile(args.path);
  if (typeof file.contents !== "string") {
    throw Object.assign(new Error("file.readRange reads text files"), { code: "not_text" });
  }
  return readRangeFromText(args.path, file.contents, args.startLine, args.endLine);
}

async function patchWorkspaceFile(host, args) {
  if (typeof host.patchFile === "function") return host.patchFile(args.path, args);
  const file = await host.readFile(args.path);
  if (typeof file.contents !== "string") {
    throw Object.assign(new Error("file.patch edits text files"), { code: "not_text" });
  }
  const next = patchText(file.contents, args);
  if (next === file.contents) return { path: args.path, bytes: Buffer.byteLength(next), changed: false };
  const written = await host.writeFile(args.path, next);
  return { ...written, changed: true };
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
  validateProcess,
  validateWorkspacePath,
  readRangeFromText,
  patchText,
  createProcessRunner,
};
