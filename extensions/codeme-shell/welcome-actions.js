const { createProject, openFolder } = require("./project-manager");

async function handleWelcomeAction(vscode, action, options = {}) {
  if (!action || action === "ready") return { ok: true, action: "ready" };
  if (!vscode || !vscode.window) {
    return { ok: false, code: "vscode_unavailable", message: "The IDE host is not available." };
  }

  const busy = options.busy;
  if (busy && busy.current) {
    return { ok: false, code: "busy", message: "Another welcome action is already running." };
  }
  if (busy) busy.current = action;

  try {
    if (action === "open") return await openFolder(vscode);
    if (action === "create") return await createProject(vscode);
    if (action === "clone") return await cloneRepository(vscode);
    if (action === "connect") {
      const detail = options.detail || "Checking the local model.";
      await vscode.window.showInformationMessage(detail);
      return { ok: true, action: "connect" };
    }
    return { ok: false, code: "unknown_action", message: `Unknown welcome action: ${action}` };
  } catch (error) {
    const message = error && error.message ? error.message : "The welcome action failed.";
    if (typeof vscode.window.showErrorMessage === "function") {
      await vscode.window.showErrorMessage(message);
    }
    return { ok: false, code: "welcome_failed", message };
  } finally {
    if (busy) busy.current = "";
  }
}

async function cloneRepository(vscode) {
  try {
    await vscode.commands.executeCommand("git.clone");
    return { ok: true, action: "clone" };
  } catch (error) {
    const message = error && error.message ? error.message : "Could not clone a repository.";
    if (typeof vscode.window.showErrorMessage === "function") {
      await vscode.window.showErrorMessage(message);
    }
    return { ok: false, code: "clone_failed", message };
  }
}

module.exports = { handleWelcomeAction };
