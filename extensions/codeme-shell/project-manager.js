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

async function createProject(vscode) {
  const entered = await vscode.window.showInputBox({
    title: "Create Project",
    prompt: "Project folder name",
    placeHolder: "my-project",
  });
  if (entered === undefined) return cancelled("name");

  const checked = validateProjectName(entered);
  if (!checked.ok) {
    await showError(vscode, checked.message);
    return checked;
  }

  const parent = await vscode.window.showOpenDialog({
    title: "Parent directory",
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Create here",
  });
  if (!parent || !parent[0]) return cancelled("location");

  const root = vscode.Uri.joinPath(parent[0], checked.name);
  const exists = await pathExists(vscode.workspace.fs, root);
  if (exists) {
    const result = failure("project_exists", `A folder named ${checked.name} already exists in that location.`);
    await showError(vscode, result.message);
    return result;
  }

  await vscode.workspace.fs.createDirectory(root);
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(root, "README.md"),
    Buffer.from(`# ${checked.name}\n`, "utf8"),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(root, ".gitignore"),
    Buffer.from("node_modules/\n", "utf8"),
  );
  await vscode.commands.executeCommand("vscode.openFolder", root);

  return {
    ok: true,
    name: checked.name,
    root: root.fsPath || root.path || String(root),
    state: "workspace_opening",
    created: ["README.md", ".gitignore"],
  };
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

async function showError(vscode, message) {
  if (vscode.window && typeof vscode.window.showErrorMessage === "function") {
    await vscode.window.showErrorMessage(message);
  }
}

function cancelled(stage) {
  return { ok: false, cancelled: true, stage };
}

function failure(code, message) {
  return { ok: false, code, message };
}

module.exports = { validateProjectName, createProject, pathExists };
