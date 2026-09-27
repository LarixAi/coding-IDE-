const vscode = require("vscode");
const cp = require("child_process");
const { execute, executeReadOnly } = require("../../packages/agent-tools");
const { createPreviewRunner } = require("./preview-runner");
const { describeFileRead } = require("./image-meta");
const { inspectWorkspace } = require("./workspace-inspector");

const preview = createPreviewRunner(vscode);

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
  createDirectory,
  listDirectory,
  search,
  runTerminal,
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
