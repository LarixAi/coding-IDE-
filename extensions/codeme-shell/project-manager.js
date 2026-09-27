const INVALID_PROJECT_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;

function validateProjectName(value) {
  const name = String(value || "").trim();
  if (!name) return failure("invalid_project_name", "Project name is required.");
  if (name === "." || name === "..") return failure("invalid_project_name", "Project name cannot be '.' or '..'.");
  if (INVALID_PROJECT_CHARS.test(name)) return failure("invalid_project_name", "Project name contains characters that cannot be used in a folder name.");
  if (/[. ]$/.test(name)) return failure("invalid_project_name", "Project name cannot end with a dot or space.");
  if (name.length > 100) return failure("invalid_project_name", "Project name is too long.");
  return { ok: true, name };
}

function requireHost(vscode) {
  if (!vscode || !vscode.window || !vscode.workspace || !vscode.commands) {
    return failure("vscode_unavailable", "The IDE host is not available.");
  }
  return { ok: true };
}

async function openFolder(vscode) {
  return pickAndOpen(vscode, {
    title: "Open Folder",
    openLabel: "Open",
    error: "Could not open that folder.",
  });
}

async function createProject(vscode) {
  const host = requireHost(vscode);
  if (!host.ok) return host;
  try {
    const picked = await vscode.window.showOpenDialog({
      title: "Create Project",
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Open Project",
    });
    if (!picked || !picked[0]) return cancelled("location");

    const root = picked[0];
    const name = folderName(root);
    const created = await seedProjectFiles(vscode, root, name);
    const opened = await openWorkspace(vscode, root, "Could not open that project.");
    return {
      ...opened,
      name,
      created,
    };
  } catch (error) {
    return reportError(vscode, "create_failed", error, "Could not create that project.");
  }
}

async function seedProjectFiles(vscode, root, name) {
  const created = [];
  const files = [
    { name: "README.md", contents: `# ${name}\n` },
    { name: ".gitignore", contents: "node_modules/\n.DS_Store\n" },
  ];
  for (const file of files) {
    const target = vscode.Uri.joinPath(root, file.name);
    if (await pathExists(vscode.workspace.fs, target)) continue;
    await vscode.workspace.fs.writeFile(target, Buffer.from(file.contents, "utf8"));
    created.push(file.name);
  }
  return created;
}

function folderName(uri) {
  const root = (uri && (uri.fsPath || uri.path)) || "";
  return root.replace(/\\/g, "/").split("/").filter(Boolean).pop() || root;
}

async function pickAndOpen(vscode, options) {
  const host = requireHost(vscode);
  if (!host.ok) return host;
  try {
    const picked = await vscode.window.showOpenDialog({
      title: options.title,
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: options.openLabel,
    });
    if (!picked || !picked[0]) return cancelled("location");
    return openWorkspace(vscode, picked[0], options.error);
  } catch (error) {
    return reportError(vscode, "open_failed", error, options.error);
  }
}

async function openWorkspace(vscode, uri, fallback) {
  const host = requireHost(vscode);
  if (!host.ok) return host;
  if (!uri) return cancelled("location");
  try {
    await vscode.commands.executeCommand("vscode.openFolder", uri);
    return {
      ok: true,
      state: "workspace_opening",
      root: uri.fsPath || uri.path || String(uri),
    };
  } catch (error) {
    return reportError(vscode, "open_failed", error, fallback || "Could not open that folder.");
  }
}

async function pathExists(fsApi, uri) {
  try {
    await fsApi.stat(uri);
    return true;
  } catch (error) {
    if (notFound(error)) return false;
    throw error;
  }
}

function notFound(error) {
  const code = String(error && error.code || "");
  const name = String(error && error.name || "");
  const message = String(error && error.message || "");
  return code === "FileNotFound"
    || code === "ENOENT"
    || name === "EntryNotFound"
    || name === "FileNotFound"
    || /not found/i.test(message);
}

async function reportError(vscode, code, error, fallback) {
  const message = error && error.message ? error.message : fallback;
  await showError(vscode, message);
  return failure(code, message);
}

async function showError(vscode, message) {
  if (vscode && vscode.window && typeof vscode.window.showErrorMessage === "function") {
    await vscode.window.showErrorMessage(message);
  }
}

function cancelled(stage) {
  return { ok: false, cancelled: true, stage };
}

function failure(code, message) {
  return { ok: false, code, message };
}

module.exports = {
  validateProjectName,
  createProject,
  seedProjectFiles,
  openFolder,
  openWorkspace,
  pathExists,
};
