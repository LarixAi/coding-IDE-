"use strict";

const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

const SKIP_DIRS = new Set([".git", ".tools", "node_modules"]);

class V19FullIdePanel {
  constructor(context, options = {}) {
    this.context = context;
    this.composer = options.composer || null;
    this.openSettings = options.openSettings || (async () => {});
    this.openPreview = options.openPreview || (async () => {});
    this.openExplorer = options.openExplorer || (async () => {});
    this.openTerminal = options.openTerminal || (async () => {});
    this.panel = null;
  }

  async open() {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "codeme.v19FullIde",
        "CodeMe V19 Full IDE",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        },
      );
      this.panel.onDidDispose(() => {
        this.panel = null;
      });
      this.panel.webview.onDidReceiveMessage((message) => this.onMessage(message));
    } else {
      this.panel.reveal(vscode.ViewColumn.One, false);
    }

    for (const command of [
      "workbench.action.closeSidebar",
      "workbench.action.closePanel",
      "workbench.action.closeAuxiliaryBar",
    ]) {
      try { await vscode.commands.executeCommand(command); } catch {}
    }

    this.panel.webview.html = this.render();
    this.post(this.composer && this.composer.session ? this.composer.session.snapshot() : {});
    this.postWorkspace();
  }

  render() {
    const sourcePath = path.join(__dirname, "media", "codeme-ide-v19-full-ide.html");
    let html = fs.readFileSync(sourcePath, "utf8");
    const bridge = "<script>(" + clientBridge.toString() + ")();</script>";
    html = html.replace(
      "</body>",
      '<div id="codemeV19TestBadge">V19 FULL IDE TEST · REAL RUNTIME BRIDGE</div>' + bridge + "</body>",
    );
    return html;
  }

  post(snapshot) {
    if (!this.panel) return;
    this.panel.webview.postMessage({
      type: "codeme-v19-state",
      snapshot: snapshot || {},
    });
  }

  postWorkspace() {
    if (!this.panel) return;
    const root = workspaceRoot();
    this.panel.webview.postMessage({
      type: "codeme-v19-workspace",
      root: root || "",
      name: root ? path.basename(root) : "NO WORKSPACE",
      entries: root ? collectWorkspaceEntries(root) : [],
    });
  }

  async onMessage(message) {
    if (!message || !this.panel) return;
    try {
      if (message.type === "v19-ready") {
        this.post(this.composer && this.composer.session ? this.composer.session.snapshot() : {});
        this.postWorkspace();
        return;
      }

      if (message.type === "v19-submit") {
        const session = this.composer && this.composer.session;
        if (!session) throw new Error("Composer session is unavailable.");
        const text = String(message.text || "").trim();
        if (!text) return;
        const epoch = Number(message.epoch || (session.epoch + 1));
        const multitask = this.composer && this.composer.multitask
          ? this.composer.multitask.snapshot()
          : null;
        const result = session.composerMode === "multitask"
          ? (
              this.composer.multitask
                ? await this.composer.multitask.start(text, epoch)
                : { ok: false, code: "paperclip_unavailable", message: "Paperclip multitask is unavailable." }
            )
          : await session.submit(text, epoch);
        if (!result || !result.ok) {
          this.panel.webview.postMessage({
            type: "codeme-v19-error",
            message: result && result.message ? result.message : "Could not submit the request.",
          });
        }
        this.post(session.snapshot());
        return;
      }

      if (message.type === "v19-select-mode") {
        const session = this.composer && this.composer.session;
        if (!session) return;
        session.selectMode(String(message.mode || "ask"));
        this.post(session.snapshot());
        return;
      }

      if (message.type === "v19-select-model") {
        const session = this.composer && this.composer.session;
        if (!session) return;
        const result = session.selectModel(String(message.provider || ""), String(message.id || ""));
        if (!result.ok) {
          this.panel.webview.postMessage({ type: "codeme-v19-error", message: result.message });
        }
        this.post(session.snapshot());
        return;
      }

      if (message.type === "v19-cancel") {
        const session = this.composer && this.composer.session;
        if (session) session.cancel();
        return;
      }

      if (message.type === "v19-read-file") {
        const relative = normalizeRelativePath(message.path);
        const absolute = resolveWorkspacePath(relative);
        const contents = fs.readFileSync(absolute, "utf8");
        this.panel.webview.postMessage({
          type: "codeme-v19-file",
          path: relative,
          contents,
        });
        return;
      }

      if (message.type === "v19-save-file") {
        const relative = normalizeRelativePath(message.path);
        const absolute = resolveWorkspacePath(relative);
        fs.writeFileSync(absolute, String(message.contents || ""), "utf8");
        this.panel.webview.postMessage({
          type: "codeme-v19-file-saved",
          path: relative,
        });
        this.postWorkspace();
        return;
      }

      if (message.type === "v19-run-command") {
        const command = String(message.command || "").trim();
        if (!command) return;
        const root = workspaceRoot();
        if (!root) throw new Error("Open a workspace before running terminal commands.");
        cp.exec(
          command,
          {
            cwd: root,
            env: process.env,
            maxBuffer: 1024 * 1024 * 4,
            shell: true,
          },
          (error, stdout, stderr) => {
            if (!this.panel) return;
            this.panel.webview.postMessage({
              type: "codeme-v19-terminal-result",
              command,
              ok: !error,
              stdout: String(stdout || ""),
              stderr: String(stderr || ""),
              code: error && typeof error.code !== "undefined" ? error.code : 0,
            });
          },
        );
        return;
      }

      if (message.type === "v19-action") {
        if (message.action === "settings") await this.openSettings();
        else if (message.action === "preview") await this.openPreview();
        else if (message.action === "explorer") await this.openExplorer();
        else if (message.action === "terminal") await this.openTerminal();
        else if (message.action === "close") this.panel.dispose();
      }
    } catch (error) {
      if (this.panel) {
        this.panel.webview.postMessage({
          type: "codeme-v19-error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  dispose() {
    if (this.panel) {
      try { this.panel.dispose(); } catch {}
    }
    this.panel = null;
  }
}

function workspaceRoot() {
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  return folder && folder.uri && folder.uri.fsPath ? folder.uri.fsPath : "";
}

function normalizeRelativePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function resolveWorkspacePath(relative) {
  const root = workspaceRoot();
  if (!root) throw new Error("Open a workspace first.");
  const absolute = path.resolve(root, relative);
  const rootResolved = path.resolve(root);
  const rel = path.relative(rootResolved, absolute);
  if (!rel || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    throw new Error("That path is outside the current workspace.");
  }
  return absolute;
}

function collectWorkspaceEntries(root) {
  const entries = [];
  const visit = (absoluteDir, relativeDir, depth) => {
    if (entries.length >= 450 || depth > 3) return;
    let listed = [];
    try {
      listed = fs.readdirSync(absoluteDir, { withFileTypes: true });
    } catch {
      return;
    }
    listed.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const item of listed) {
      if (entries.length >= 450) break;
      const rel = relativeDir ? relativeDir + "/" + item.name : item.name;
      if (item.isDirectory()) {
        entries.push({ type: "directory", path: rel, name: item.name, depth });
        if (!SKIP_DIRS.has(item.name) && item.name !== "code-oss") {
          visit(path.join(absoluteDir, item.name), rel, depth + 1);
        }
      } else {
        entries.push({ type: "file", path: rel, name: item.name, depth });
      }
    }
  };
  visit(root, "", 0);
  return entries;
}

function clientBridge() {
  const vscode = acquireVsCodeApi();
  let epoch = 0;
  let activePath = "src/app.js";
  let latestState = {};
  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));

  const css = document.createElement("style");
  css.textContent =
    "#codemeV19TestBadge{position:fixed;right:8px;top:6px;z-index:99999;padding:4px 7px;border:1px solid #41505f;border-radius:5px;background:#17202a;color:#8eb7d4;font:8px ui-monospace,monospace;letter-spacing:.05em}" +
    ".v19-real-running{margin:8px 0;padding:7px 8px;border-left:2px solid #7696af;background:#1d2329;color:#aebdca;font-size:10px}" +
    ".v19-real-error{margin:8px;padding:7px 8px;border:1px solid #6a3f44;background:#281d1f;color:#d9999f;border-radius:5px}" +
    ".v19-real-msg{margin:0 1px 10px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}" +
    ".v19-real-msg.user{color:#e6e6e6;font-weight:600}.v19-real-msg.assistant{color:#c6ccd4}" +
    ".v19-real-file{cursor:pointer}.v19-real-file:hover{background:#252525}";
  document.head.appendChild(css);

  function post(type, extra) {
    vscode.postMessage(Object.assign({ type }, extra || {}));
  }

  function submitReal() {
    const input = document.getElementById("prompt");
    const text = input ? input.value.trim() : "";
    if (!text) return;
    epoch += 1;
    if (input) input.value = "";
    post("v19-submit", { text, epoch });
  }

  function modeLabel(mode) {
    if (mode === "code") return "Code";
    if (mode === "plan") return "Plan";
    if (mode === "debug") return "Debug";
    if (mode === "multitask") return "Multitask";
    if (mode === "test") return "Test";
    return "Chat";
  }

  function renderThread(state) {
    const feed = document.getElementById("feed");
    if (!feed) return;
    const thread = Array.isArray(state.thread) ? state.thread : [];
    let html = "";
    if (!thread.length) {
      html = '<div class="intro"><b>CodeMe AI</b><br><span>V19 shell is connected to the real CodeMe runtime.</span></div>';
    } else {
      for (const item of thread) {
        const role = item && item.role === "user" ? "user" : "assistant";
        html += '<div class="v19-real-msg ' + role + '">' + esc(item && item.text || "") + "</div>";
      }
    }
    if (state.running) {
      html += '<div class="v19-real-running">● ' + esc(state.activity || state.stage || "Working…") + "</div>";
    }
    feed.innerHTML = html;
    feed.scrollTop = feed.scrollHeight;
  }

  function renderModels(state) {
    const menu = document.getElementById("modelMenu");
    const button = document.getElementById("modelBtn");
    const models = Array.isArray(state.models) ? state.models : [];
    const selected = state.selected || null;
    if (button && selected) button.textContent = (selected.label || selected.id || "Model") + " ▾";
    if (!menu || !models.length) return;
    menu.innerHTML = "";
    let lastSource = "";
    for (const model of models) {
      const source = model.source || model.provider || "Models";
      if (source !== lastSource) {
        const group = document.createElement("div");
        group.className = "modelGroup";
        group.textContent = source;
        menu.appendChild(group);
        lastSource = source;
      }
      const row = document.createElement("div");
      row.className = "modelItem";
      row.dataset.v19Provider = model.provider || "";
      row.dataset.v19Id = model.id || "";
      row.innerHTML = "<b>" + esc(model.label || model.id || "Model") + "</b><span>" + esc(source) + "</span>";
      menu.appendChild(row);
    }
  }

  function renderStatus(state) {
    latestState = state || {};
    const mode = modeLabel(state.composerMode);
    const modeButton = document.getElementById("modeBtn");
    if (modeButton) modeButton.textContent = mode + " ▾";
    const status = document.getElementById("status");
    if (status) {
      const text = state.running
        ? (state.activity || "Working…")
        : (mode === "Code" || mode === "Debug" ? "Ready · can edit" : "Ready · read-only");
      status.innerHTML = '<span class="statePill state-' + (state.running ? "running" : "ready") + '"><span class="stateDot"></span><span>' + esc(text) + "</span></span>";
    }
    renderThread(state);
    renderModels(state);
  }

  function renderWorkspace(payload) {
    const name = document.getElementById("workspaceFolderName");
    if (name) name.textContent = String(payload.name || "WORKSPACE").toUpperCase();
    const tree = document.getElementById("fileTree");
    if (!tree || !Array.isArray(payload.entries)) return;
    tree.innerHTML = "";
    for (const entry of payload.entries) {
      const row = document.createElement("div");
      row.className = "treeRow " + (entry.type === "directory" ? "folder" : "file v19-real-file");
      row.dataset.path = entry.path || "";
      row.style.paddingLeft = (8 + Number(entry.depth || 0) * 12) + "px";
      const icon = entry.type === "directory" ? "▸" : fileIcon(entry.name);
      row.innerHTML = '<span class="twisty">' + icon + '</span><span class="treeName">' + esc(entry.name || entry.path) + "</span>";
      tree.appendChild(row);
    }
  }

  function fileIcon(name) {
    const value = String(name || "").toLowerCase();
    if (value.endsWith(".js") || value.endsWith(".ts")) return "JS";
    if (value.endsWith(".css")) return "#";
    if (value.endsWith(".json")) return "{}";
    if (value.endsWith(".md")) return "◆";
    return "·";
  }

  function showFile(message) {
    activePath = String(message.path || activePath);
    const pre = document.getElementById("codeText");
    if (pre) pre.textContent = String(message.contents || "");
    const crumb = document.getElementById("editorCrumb");
    if (crumb) crumb.textContent = activePath;
    const state = document.getElementById("aiEditorState");
    if (state) state.textContent = "Real workspace file · Cmd/Ctrl+S to save";
  }

  function appendTerminal(message) {
    const consoleEl = document.getElementById("terminalConsole");
    if (!consoleEl) return;
    const oldInput = document.getElementById("termInput");
    if (oldInput && oldInput.parentElement) oldInput.parentElement.remove();
    const commandLine = document.createElement("div");
    commandLine.className = "termLine";
    commandLine.textContent = "% " + String(message.command || "");
    consoleEl.appendChild(commandLine);
    const output = String(message.stdout || "") + String(message.stderr || "");
    if (output) {
      const out = document.createElement("div");
      out.className = "termLine " + (message.ok ? "" : "failText");
      out.textContent = output;
      consoleEl.appendChild(out);
    }
    const prompt = document.createElement("div");
    prompt.className = "termLine";
    prompt.innerHTML = '% <input id="termInput" autocomplete="off" spellcheck="false">';
    consoleEl.appendChild(prompt);
    consoleEl.scrollTop = consoleEl.scrollHeight;
    document.getElementById("termInput")?.focus();
  }

  document.addEventListener("click", (event) => {
    const target = event.target && event.target.closest ? event.target : null;
    if (!target) return;

    if (target.closest(".send")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      submitReal();
      return;
    }

    const modeItem = target.closest(".modeItem");
    if (modeItem) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const label = String(modeItem.querySelector("b")?.textContent || "Chat").toLowerCase();
      const mode = label === "chat" ? "ask" : label;
      document.getElementById("modeMenu")?.classList.remove("show");
      post("v19-select-mode", { mode });
      return;
    }

    const modelItem = target.closest(".modelItem[data-v19-id]");
    if (modelItem) {
      event.preventDefault();
      event.stopImmediatePropagation();
      document.getElementById("modelMenu")?.classList.remove("show");
      post("v19-select-model", {
        provider: modelItem.dataset.v19Provider || "",
        id: modelItem.dataset.v19Id || "",
      });
      return;
    }

    const fileRow = target.closest(".treeRow.file[data-path]");
    if (fileRow) {
      event.preventDefault();
      event.stopImmediatePropagation();
      post("v19-read-file", { path: fileRow.dataset.path || "" });
      return;
    }

    const rail = target.closest(".railBtn");
    if (rail) {
      const title = String(rail.getAttribute("title") || "").toLowerCase();
      if (title === "settings") {
        event.preventDefault();
        event.stopImmediatePropagation();
        post("v19-action", { action: "settings" });
      }
    }

    if (target.closest(".openExternal")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      post("v19-action", { action: "preview" });
    }
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.target && event.target.id === "prompt" && event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      submitReal();
      return;
    }

    if (event.target && event.target.id === "termInput" && event.key === "Enter") {
      event.preventDefault();
      event.stopImmediatePropagation();
      const command = String(event.target.value || "").trim();
      if (command) {
        event.target.value = "";
        post("v19-run-command", { command });
      }
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      const editor = document.getElementById("codeText");
      if (editor && (document.activeElement === editor || editor.contains(document.activeElement))) {
        event.preventDefault();
        post("v19-save-file", {
          path: activePath,
          contents: editor.innerText,
        });
      }
    }
  }, true);

  window.addEventListener("message", (event) => {
    const message = event.data || {};
    if (message.type === "codeme-v19-state") renderStatus(message.snapshot || {});
    else if (message.type === "codeme-v19-workspace") renderWorkspace(message);
    else if (message.type === "codeme-v19-file") showFile(message);
    else if (message.type === "codeme-v19-file-saved") {
      const state = document.getElementById("aiEditorState");
      if (state) state.textContent = "Saved · " + String(message.path || "");
    } else if (message.type === "codeme-v19-terminal-result") appendTerminal(message);
    else if (message.type === "codeme-v19-error") {
      const feed = document.getElementById("feed");
      if (feed) feed.insertAdjacentHTML("beforeend", '<div class="v19-real-error">' + esc(message.message || "Something failed.") + "</div>");
    }
  });

  post("v19-ready");
}

module.exports = { V19FullIdePanel };
