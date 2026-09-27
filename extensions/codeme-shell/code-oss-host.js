const vscode = require("vscode");
const cp = require("child_process");
const { execute, executeReadOnly } = require("../../packages/agent-tools");
const { createPreviewRunner } = require("./preview-runner");
const { describeFileRead } = require("./image-meta");
const { inspectWorkspace } = require("./workspace-inspector");

const preview = createPreviewRunner(vscode);
const PROCESS_RECORDS = new Map();
let PROCESS_SEQUENCE = 0;
const PROCESS_LOG_LIMIT = 50000;

function workspaceFolder() {
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!folder) {
    throw Object.assign(new Error("No workspace folder is open"), { code: "no_workspace" });
  }
  return folder;
}

function relativePath(uri) {
  return vscode.workspace.asRelativePath(uri, false);
}

async function readFile(filePath) {
  const uri = vscode.Uri.joinPath(workspaceFolder().uri, filePath);
  const bytes = Buffer.from(await vscode.workspace.fs.readFile(uri));
  return describeFileRead(filePath, bytes);
}

async function createDirectory(dirPath) {
  const uri = vscode.Uri.joinPath(workspaceFolder().uri, dirPath);
  await vscode.workspace.fs.createDirectory(uri);
  return { path: dirPath };
}

async function listDirectory(dirPath) {
  const root = workspaceFolder().uri;
  const start = vscode.Uri.joinPath(root, dirPath === "." ? "" : dirPath);
  const entries = [];
  async function walk(uri) {
    const children = await vscode.workspace.fs.readDirectory(uri);
    for (const [name, type] of children) {
      if (name === ".git" || name === "node_modules") continue;
      const child = vscode.Uri.joinPath(uri, name);
      const kind = type === vscode.FileType.Directory ? "dir" : "file";
      entries.push({ path: relativePath(child), type: kind });
      if (entries.length >= 200) return;
      if (kind === "dir") await walk(child);
      if (entries.length >= 200) return;
    }
  }
  await walk(start);
  return { path: dirPath, entries };
}

async function writeFile(filePath, contents) {
  const uri = vscode.Uri.joinPath(workspaceFolder().uri, filePath);
  const bytes = Buffer.from(contents, "utf8");
  await vscode.workspace.fs.writeFile(uri, bytes);
  return { path: filePath, bytes: bytes.byteLength };
}

async function patchFile(filePath, oldText, newText) {
  const uri = vscode.Uri.joinPath(workspaceFolder().uri, filePath);
  const before = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
  if (!oldText) {
    throw Object.assign(new Error("file.patch requires non-empty oldText"), { code: "invalid_args" });
  }
  const first = before.indexOf(oldText);
  if (first < 0) {
    throw Object.assign(new Error(`file.patch could not find the requested text in ${filePath}`), { code: "patch_not_found" });
  }
  const second = before.indexOf(oldText, first + oldText.length);
  if (second >= 0) {
    throw Object.assign(new Error(`file.patch matched more than once in ${filePath}; provide a more specific oldText`), { code: "patch_ambiguous" });
  }
  const after = before.slice(0, first) + newText + before.slice(first + oldText.length);
  const bytes = Buffer.from(after, "utf8");
  await vscode.workspace.fs.writeFile(uri, bytes);
  return {
    path: filePath,
    bytes: bytes.byteLength,
    replacements: 1,
    before: oldText,
    after: newText,
  };
}

async function search(query) {
  const files = await vscode.workspace.findFiles("**/*", "**/{.git,node_modules}/**", 200);
  const matches = [];
  for (const uri of files) {
    let bytes;
    try {
      bytes = Buffer.from(await vscode.workspace.fs.readFile(uri));
    } catch {
      continue;
    }
    if (bytes.includes(0)) continue;
    const lines = bytes.toString("utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length && matches.length < 50; index++) {
      if (lines[index].includes(query)) {
        matches.push({ path: relativePath(uri), line: index + 1, text: lines[index] });
      }
    }
  }
  return { query, matches };
}

function runProcess(command) {
  const cwd = workspaceFolder().uri.fsPath;
  return new Promise((resolve) => {
    cp.exec(command, { cwd, timeout: 30000, maxBuffer: 1024 * 1024, encoding: "utf8" }, (error, stdout, stderr) => {
      const exitCode = error && typeof error.code === "number" ? error.code : error ? 1 : 0;
      resolve({
        exitCode,
        stdout: String(stdout || ""),
        stderr: String(stderr || ""),
      });
    });
  });
}

function waitForShellIntegration(terminal) {
  if (terminal && terminal.shellIntegration) return Promise.resolve(terminal.shellIntegration);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      disposable.dispose();
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

async function runTerminal(command) {
  const cwd = workspaceFolder().uri.fsPath;
  const terminal = vscode.window.createTerminal({ name: "CodeMe", shellPath: "/bin/bash", cwd });
  try {
    const shellIntegration = await waitForShellIntegration(terminal);
    const execution = await new Promise((resolve) => {
      setTimeout(() => resolve(shellIntegration.executeCommand(command)), 300);
    });
    const endEvent = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        disposable.dispose();
        reject(Object.assign(new Error("Terminal command timed out"), { code: "terminal_timeout" }));
      }, 20000);
      const disposable = vscode.window.onDidEndTerminalShellExecution((event) => {
        if (event.shellIntegration !== shellIntegration) return;
        clearTimeout(timer);
        disposable.dispose();
        resolve(event);
      });
    });
    let output = "";
    for await (const chunk of execution.read()) {
      output += chunk;
      if (output.length > 100000) break;
    }
    const ended = await endEvent;
    return { exitCode: ended.exitCode ?? 1, output };
  } finally {
    terminal.dispose();
  }
}

function processWorkspaceKey() {
  return workspaceFolder().uri.fsPath;
}

function redactProcessOutput(value) {
  return String(value || "")
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*=\s*([^\s]+)/g, "$1=[REDACTED]");
}

function appendProcessOutput(record, chunk) {
  const next = redactProcessOutput(chunk);
  if (!next) return;
  record.output = (record.output + next).slice(-PROCESS_LOG_LIMIT);
  record.updatedAt = new Date().toISOString();
}

function latestProcessRecord() {
  return PROCESS_RECORDS.get(processWorkspaceKey()) || null;
}

function processSnapshot(record, includeOutput) {
  if (!record) {
    return {
      found: false,
      status: "none",
      command: "",
      exitCode: null,
      startedAt: null,
      endedAt: null,
      output: includeOutput ? "" : undefined,
    };
  }
  return {
    found: true,
    id: record.id,
    status: record.status,
    command: record.command,
    exitCode: record.exitCode,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    output: includeOutput ? record.output : undefined,
  };
}

async function startProcess(command) {
  const cwd = workspaceFolder().uri.fsPath;
  const terminal = vscode.window.createTerminal({
    name: "CodeMe Process",
    shellPath: "/bin/bash",
    cwd,
  });
  terminal.show(true);

  let shellIntegration;
  try {
    shellIntegration = await waitForShellIntegration(terminal);
  } catch (error) {
    terminal.dispose();
    throw error;
  }

  const execution = await new Promise((resolve) => {
    setTimeout(() => resolve(shellIntegration.executeCommand(command)), 200);
  });

  let resolveEnded;
  const ended = new Promise((resolve) => { resolveEnded = resolve; });
  const now = new Date().toISOString();
  const record = {
    id: `proc_${++PROCESS_SEQUENCE}`,
    workspace: cwd,
    command,
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
  PROCESS_RECORDS.set(cwd, record);

  const endDisposable = vscode.window.onDidEndTerminalShellExecution((event) => {
    if (event.execution && event.execution !== execution) return;
    if (!event.execution && event.shellIntegration !== shellIntegration) return;
    record.exitCode = typeof event.exitCode === "number" ? event.exitCode : 1;
    record.status = record.exitCode === 0 ? "exited" : "failed";
    record.endedAt = new Date().toISOString();
    record.updatedAt = record.endedAt;
    endDisposable.dispose();
    resolveEnded(record);
  });

  (async () => {
    try {
      for await (const chunk of execution.read()) appendProcessOutput(record, chunk);
    } catch (error) {
      appendProcessOutput(record, `\n[CodeMe log reader error] ${error instanceof Error ? error.message : String(error)}\n`);
    }
  })();

  await Promise.race([
    ended,
    new Promise((resolve) => setTimeout(resolve, 700)),
  ]);

  const snapshot = processSnapshot(record, true);
  if (record.status === "failed") {
    return {
      ...snapshot,
      started: false,
      terminal: "CodeMe Process",
    };
  }
  return {
    ...snapshot,
    started: true,
    terminal: "CodeMe Process",
  };
}

async function processStatus() {
  return processSnapshot(latestProcessRecord(), false);
}

async function processLogs() {
  return processSnapshot(latestProcessRecord(), true);
}

async function gitRepository() {
  const extension = vscode.extensions.getExtension("vscode.git");
  if (!extension) {
    throw Object.assign(new Error("The Git extension is not available"), { code: "git_unavailable" });
  }
  const git = await extension.activate();
  const api = git.getAPI(1);
  const folder = workspaceFolder().uri;
  if (!api.getRepository(folder)) {
    await vscode.commands.executeCommand("git.openRepository", folder);
  }
  const repository = api.getRepository(folder);
  if (!repository) {
    throw Object.assign(new Error("The workspace is not a Git repository"), { code: "not_a_repository" });
  }
  await repository.status();
  return repository;
}

async function gitStatus() {
  const repository = await gitRepository();
  const changes = repository.state.workingTreeChanges.map((change) => ({
    path: relativePath(change.uri),
    status: change.status,
  }));
  return { branch: repository.state.HEAD && repository.state.HEAD.name, changes };
}

async function gitDiff() {
  const repository = await gitRepository();
  const diff = await repository.diff(false);
  return { diff };
}

async function diagnostics() {
  const items = [];
  for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
    for (const item of diagnostics) {
      items.push({
        path: relativePath(uri),
        message: item.message,
        severity: item.severity,
        line: item.range.start.line + 1,
      });
    }
  }
  return { items };
}

async function browserCheck(url) {
  try {
    return await preview.check(workspaceFolder().uri.fsPath, url);
  } catch (error) {
    return {
      available: false,
      code: error && error.code ? String(error.code) : "preview_failed",
      message: error instanceof Error ? error.message : String(error),
      url,
    };
  }
}

const host = {
  inspectWorkspace: () => inspectWorkspace(vscode),
  readFile,
  writeFile,
  patchFile,
  createDirectory,
  listDirectory,
  search,
  runTerminal,
  startProcess,
  processStatus,
  processLogs,
  gitStatus,
  gitDiff,
  diagnostics,
  runTests: runProcess,
  browserCheck,
};

function runTool(tool, args) {
  return execute(host, tool, args);
}

function readOnly(tool, args) {
  return executeReadOnly(host, tool, args);
}

module.exports = { runTool, readOnly, host };
