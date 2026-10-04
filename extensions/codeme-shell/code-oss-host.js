const vscode = require("vscode");
const cp = require("child_process");
const path = require("path");
const { execute, executeReadOnly } = require("../../packages/agent-tools");
const { createPreviewRunner, resolveOwnedPreviewUrl } = require("./preview-runner");
const { createPreviewSessionManager } = require("./preview-session-manager");
const { createBrowserInteractionRunner } = require("./browser-interaction-runner");
const { createSandboxRunner } = require("./sandbox-runner");
const { describeFileRead } = require("./image-meta");
const { inspectWorkspace } = require("./workspace-inspector");
const { readDocument: decodeDocument, createDocument: buildDocument, editDocument: patchDocument } = require("./document-service");

const preview = createPreviewRunner(vscode);
const browserInteraction = createBrowserInteractionRunner();
const sandbox = createSandboxRunner();
const previewSessions = createPreviewSessionManager(vscode);

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
  let before = null;
  try {
    before = Buffer.from(await vscode.workspace.fs.readFile(uri));
  } catch {
    before = null;
  }
  const changed = !before || !before.equals(bytes);
  if (changed) await vscode.workspace.fs.writeFile(uri, bytes);
  return {
    path: filePath,
    bytes: bytes.byteLength,
    changed,
    noOp: !changed,
  };
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
  const changed = after !== before;
  if (changed) await vscode.workspace.fs.writeFile(uri, bytes);
  return {
    path: filePath,
    bytes: bytes.byteLength,
    replacements: changed ? 1 : 0,
    before: oldText,
    after: newText,
    changed,
    noOp: !changed,
  };
}

async function readDocument(filePath) {
  const uri = vscode.Uri.joinPath(workspaceFolder().uri, filePath);
  const bytes = Buffer.from(await vscode.workspace.fs.readFile(uri));
  return decodeDocument(filePath, bytes);
}

async function ensureDocumentParent(filePath) {
  const normalized = String(filePath || "").replace(/\\/g, "/");
  const parent = path.posix.dirname(normalized);
  if (parent && parent !== ".") await createDirectory(parent);
}

async function createDocument(filePath, contents, options = {}) {
  const uri = vscode.Uri.joinPath(workspaceFolder().uri, filePath);
  let before = null;
  try {
    before = Buffer.from(await vscode.workspace.fs.readFile(uri));
  } catch {
    before = null;
  }
  if (before !== null && !options.overwrite) {
    throw Object.assign(
      new Error("Document already exists: " + filePath + ". Read it first, then use document.edit or set overwrite=true."),
      { code: "document_exists" },
    );
  }
  const built = buildDocument(filePath, contents, options);
  await ensureDocumentParent(filePath);
  const changed = before === null || !before.equals(built.bytes);
  if (changed) await vscode.workspace.fs.writeFile(uri, built.bytes);
  return {
    path: filePath,
    format: built.format,
    type: built.type,
    bytes: built.bytes.length,
    changed,
    noOp: !changed,
    created: before === null,
  };
}

async function editDocument(filePath, oldText, newText) {
  const uri = vscode.Uri.joinPath(workspaceFolder().uri, filePath);
  const before = Buffer.from(await vscode.workspace.fs.readFile(uri));
  const edited = patchDocument(filePath, before, oldText, newText);
  if (edited.changed) await vscode.workspace.fs.writeFile(uri, edited.bytes);
  return {
    path: filePath,
    format: edited.format,
    type: edited.type,
    bytes: edited.bytes.length,
    replacements: edited.replacements,
    changed: edited.changed,
    noOp: !edited.changed,
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

async function runSandbox(input) {
  return sandbox.run(workspaceFolder().uri.fsPath, input || {});
}

async function runTerminal(command) {
  const result = await runProcess(command);
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  return {
    exitCode: result.exitCode,
    stdout,
    stderr,
    output: [stdout, stderr].filter(Boolean).join(stderr && stdout ? "\n" : ""),
  };
}

async function startProcess(command) {
  return previewSessions.start(workspaceFolder().uri.fsPath, String(command || ""));
}

async function processStatus() {
  return previewSessions.refresh(workspaceFolder().uri.fsPath);
}

async function processLogs() {
  return previewSessions.logs(workspaceFolder().uri.fsPath);
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

async function browserCheck(url, input = {}) {
  const root = workspaceFolder().uri.fsPath;
  const requestedUrl = String(url || "");
  const refreshed = await previewSessions.refresh(root);
  const effectiveUrl = resolveOwnedPreviewUrl(refreshed, requestedUrl);
  const args = input && typeof input === "object" ? input : {};
  if (!effectiveUrl) {
    return {
      available: false,
      code: "preview_not_running",
      message: "No CodeMe-owned preview is running. Call process.start first.",
      url: "",
      session: previewSessions.status(root),
    };
  }
  try {
    const checked = await preview.check(root, effectiveUrl);
    if (checked && checked.url) previewSessions.adoptUrl(root, checked.url);
    const session = previewSessions.status(root);
    if (!checked || checked.available === false) {
      return {
        ...(checked || {
          available: false,
          code: "preview_failed",
          message: "The preview check returned no result.",
          url: requestedUrl,
        }),
        session,
      };
    }

    const observed = await browserInteraction.interact({
      url: checked.url || requestedUrl,
      action: "observe",
      selector: String(args.selector || "body"),
      expectedText: String(args.expectedText || ""),
    });
    if (!observed || observed.available === false) {
      return {
        ...(observed || {
          available: false,
          code: "browser_observation_failed",
          message: "The real browser did not return observation evidence.",
          url: checked.url || requestedUrl,
        }),
        statusCode: checked.statusCode,
        title: checked.title || "",
        assets: Array.isArray(checked.assets) ? checked.assets : [],
        session,
      };
    }

    return {
      ...observed,
      available: true,
      statusCode: checked.statusCode,
      title: checked.title || "",
      assets: Array.isArray(checked.assets) ? checked.assets : [],
      renderedText: String(observed.afterText || ""),
      expectedText: String(args.expectedText || ""),
      expectedTextMatched: args.expectedText ? observed.matched === true : true,
      session,
      preview: {
        url: checked.url || requestedUrl,
        statusCode: checked.statusCode,
        title: checked.title || "",
        assets: Array.isArray(checked.assets) ? checked.assets : [],
      },
    };
  } catch (error) {
    return {
      available: false,
      code: error && error.code ? String(error.code) : "preview_failed",
      message: error instanceof Error ? error.message : String(error),
      url: requestedUrl,
      session: previewSessions.status(root),
    };
  }
}

async function browserInteract(input) {
  const args = input && typeof input === "object" ? input : {};
  const requestedUrl = String(args.url || "");
  const root = workspaceFolder().uri.fsPath;
  const refreshed = await previewSessions.refresh(root);
  const effectiveUrl = resolveOwnedPreviewUrl(refreshed, requestedUrl);
  if (!effectiveUrl) {
    return {
      available: false,
      code: "preview_not_running",
      message: "No CodeMe-owned preview is running. Call process.start first.",
      url: "",
      session: previewSessions.status(root),
    };
  }
  try {
    const checked = await preview.check(root, effectiveUrl);
    if (checked && checked.url) previewSessions.adoptUrl(root, checked.url);
    if (!checked || checked.available === false) {
      return {
        ...checked,
        session: previewSessions.status(root),
      };
    }
    const result = await browserInteraction.interact({
      ...args,
      url: checked.url || requestedUrl,
    });
    if (result && typeof result === "object") {
      result.statusCode = checked.statusCode;
      result.title = checked.title || "";
      result.assets = Array.isArray(checked.assets) ? checked.assets : [];
      result.session = previewSessions.status(root);
      result.preview = {
        url: checked.url || requestedUrl,
        statusCode: checked.statusCode,
        title: checked.title || "",
        assets: result.assets,
      };
    }
    return result;
  } catch (error) {
    return {
      available: false,
      code: error && error.code ? String(error.code) : "browser_interaction_failed",
      message: error instanceof Error ? error.message : String(error),
      url: requestedUrl,
      session: previewSessions.status(root),
    };
  }
}

const host = {
  inspectWorkspace: () => inspectWorkspace(vscode),
  readFile,
  writeFile,
  patchFile,
  readDocument,
  createDocument,
  editDocument,
  createDirectory,
  listDirectory,
  search,
  runTerminal,
  runSandbox,
  startProcess,
  processStatus,
  processLogs,
  gitStatus,
  gitDiff,
  diagnostics,
  runTests: runProcess,
  browserCheck,
  browserInteract,
};

function runTool(tool, args) {
  return execute(host, tool, args);
}

function readOnly(tool, args) {
  return executeReadOnly(host, tool, args);
}

module.exports = { runTool, readOnly, host };
