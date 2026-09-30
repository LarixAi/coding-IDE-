const vscode = require("vscode");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { renderComposer } = require("./composer-view");
const { renderWelcome, formatRelativeTime } = require("./welcome");
const { renderEmptyEditor } = require("./empty-editor");
const { host } = require("./code-oss-host");
const { ReadOnlyToolProvider, ControlledToolProvider, ToolRegistry } = require("../../packages/agent-runtime/tool-registry");
const { RunStore } = require("../../packages/agent-runtime/run-store");
const { ComposerSession, listOllamaModels } = require("./composer-session");
const { ConversationStore } = require("./conversation-store");
const { hasWorkspaceEditorInGroups } = require("./tab-policy");
const { loadRuntimeEnv } = require("./runtime-config");
const { N8nIntegration } = require("./n8n-integration");

let N8nCapabilityProvider;
let OllamaModelProvider;
try {
  ({ N8nCapabilityProvider } = require("../../packages/n8n-capability"));
  ({ OllamaModelProvider } = require("../../packages/agent-runtime/model-provider"));
} catch {
  N8nCapabilityProvider = null;
  OllamaModelProvider = null;
}

function activate(context) {
  const runtimeEnv = loadRuntimeEnv();
  console.log(
    "CodeMe shell activated",
    runtimeEnv.loaded
      ? `(runtime config loaded: ${runtimeEnv.keys.length} values)`
      : `(runtime config: ${runtimeEnv.reason || "not loaded"})`,
  );

  const state = {
    grade: "chat_only",
    detail: "Checking the local model server.",
    hub: { connected: false, capabilities: [], detail: "Checking the intelligence hub." },
  };
  const composer = new ComposerViewProvider(context, state);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("codeme.agent", composer, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );
  const welcome = new WelcomePanel(state);
  const emptyEditor = new EmptyEditorPanel();
  context.subscriptions.push(welcome, emptyEditor);
  let tabSyncTimer = null;
  const scheduleEmptyEditorSync = () => {
    if (tabSyncTimer) clearTimeout(tabSyncTimer);
    tabSyncTimer = setTimeout(() => {
      tabSyncTimer = null;
      emptyEditor.sync();
    }, 75);
  };
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => arrangeShell(welcome, emptyEditor)),
    vscode.window.tabGroups.onDidChangeTabs(scheduleEmptyEditorSync),
    { dispose: () => { if (tabSyncTimer) clearTimeout(tabSyncTimer); } },
  );
  applyPreferredSettings();
  arrangeShell(welcome, emptyEditor);

  const connection = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  connection.name = "CodeMe model connection";
  connection.command = "codeme.showConnection";
  connection.show();
  context.subscriptions.push(connection);
  const hubItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  hubItem.name = "CodeMe intelligence hub";
  hubItem.command = "codeme.showConnection";
  hubItem.show();
  context.subscriptions.push(hubItem);
  applyConnection(connection, state);
  applyHub(hubItem, state);
  composer.refreshStatus = () => {
    applyConnection(connection, state);
    applyHub(hubItem, state);
  };
  const refreshModels = () => composer.sync().then(() => {
    applyConnection(connection, state);
    welcome.render();
    console.log(`CodeMe model discovery: ${state.detail}`);
  }).catch((error) => {
    state.grade = "chat_only";
    state.detail = `Model discovery failed: ${error instanceof Error ? error.message : String(error)}`;
    applyConnection(connection, state);
  });
  refreshModels();

  const refreshHub = () => {
    composer.syncExternalPermissions();
    return probeHub(composer.capabilities, composer.externalTools).then((hub) => {
      state.hub = hub;
      applyHub(hubItem, state);
      composer.post(composer.session.snapshot());
    });
  };
  refreshHub();

  const modelTimer = setInterval(refreshModels, 15000);
  const hubTimer = setInterval(refreshHub, 15000);
  context.subscriptions.push(
    { dispose: () => clearInterval(modelTimer) },
    { dispose: () => clearInterval(hubTimer) },
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codeme.showConnection", () => {
      vscode.window.showInformationMessage(`${state.detail} ${state.hub.detail}`);
    }),
    vscode.commands.registerCommand("codeme.ask", () => vscode.commands.executeCommand("codeme.agent.focus")),
    vscode.commands.registerCommand("codeme.attach", () => composer.pickFiles()),
    vscode.commands.registerCommand("codeme.hideStart", () => emptyEditor.suppress(1500)),
  );
}

function applyHub(item, state) {
  const hub = state.hub || {};
  item.text = hub.connected ? "$(radio-tower) hub" : "$(radio-tower) hub offline";
  item.tooltip = hub.detail || "";
}

async function applyPreferredSettings() {
  const config = vscode.workspace.getConfiguration();
  const pairs = [
    ["chat.disableAIFeatures", true],
    ["chat.titleBar.signIn.enabled", false],
    ["chat.titleBar.openInAgentsWindow.enabled", false],
    ["workbench.secondarySideBar.defaultVisibility", "visible"],
    ["workbench.tips.enabled", false],
    ["workbench.editor.empty.hint", "hidden"],
  ];
  for (const [key, value] of pairs) {
    try {
      if (config.get(key) !== value) await config.update(key, value, vscode.ConfigurationTarget.Global);
    } catch {
      // Some keys cannot be written as defaults. The workspace still stays usable.
    }
  }
}

function folderOpen() {
  return Boolean(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length);
}

async function runCommand(command) {
  try {
    await vscode.commands.executeCommand(command);
  } catch (error) {
    console.log(`CodeMe skipped ${command}: ${error && error.message ? error.message : error}`);
  }
}

async function arrangeShell(welcome, emptyEditor) {
  if (!folderOpen()) {
    if (emptyEditor) emptyEditor.dispose();
    await runCommand("workbench.action.closeSidebar");
    await runCommand("workbench.action.closeAuxiliaryBar");
    await closeStockWelcome();
    welcome.open();
    return;
  }
  if (welcome.panel) welcome.panel.dispose();
  await runCommand("workbench.view.explorer");
  await runCommand("workbench.action.closeChat");
  await runCommand("codeme.agent.focus");
  if (emptyEditor) {
    emptyEditor.sync();
    setTimeout(() => emptyEditor.sync(), 250);
  }
}

async function closeStockWelcome() {
  for (const group of vscode.window.tabGroups.all) {
    const stock = group.tabs.filter((tab) => {
      if (tab.label !== "Welcome" && tab.label !== "Get Started") return false;
      const viewType = tab.input && tab.input.viewType;
      return viewType !== "codeme.welcome";
    });
    if (stock.length) await vscode.window.tabGroups.close(stock);
  }
}

class WelcomePanel {
  constructor(state) {
    this.state = state;
    this.panel = undefined;
  }

  open() {
    if (this.panel) {
      this.render();
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      "codeme.welcome",
      "Welcome",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
    this.panel.webview.onDidReceiveMessage((message) => this.onMessage(message));
    this.render();
  }

  render() {
    if (!this.panel) return;
    const nonce = crypto.randomBytes(16).toString("hex");
    listRecentProjects().then((recent) => {
      if (!this.panel) return;
      this.panel.webview.html = renderWelcome({
        detail: this.state.detail,
        ready: this.state.grade !== "chat_only",
        modelLabel: this.state.selectedLabel || this.state.modelLabel || "",
        recent,
      }, nonce);
    });
  }

  async onMessage(message) {
    if (!message || message.type !== "welcome") return;
    if (message.action === "open") {
      await vscode.commands.executeCommand("workbench.action.files.openFolder");
      return;
    }
    if (message.action === "clone") {
      await vscode.commands.executeCommand("git.clone");
      return;
    }
    if (message.action === "connect") {
      await vscode.window.showInformationMessage(this.state.detail);
      return;
    }
    if (message.action === "create") {
      await createProject();
      return;
    }
    if (message.action === "recent" && message.uri) {
      await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.parse(message.uri));
      return;
    }
    if (message.action === "recents") {
      await vscode.commands.executeCommand("workbench.action.openRecent");
      return;
    }
    if (message.action === "shortcuts") {
      await vscode.commands.executeCommand("workbench.action.openGlobalKeybindings");
      return;
    }
    if (message.action === "learn") {
      await vscode.window.showInformationMessage("Open a folder, then ask CodeMe from the agent panel. Explorer, editor, and terminal stay native.");
      return;
    }
    if (message.action === "docs") {
      await vscode.env.openExternal(vscode.Uri.parse("https://github.com/LarixAi/coding-IDE-"));
    }
  }

  dispose() {
    if (this.panel) this.panel.dispose();
  }
}

class EmptyEditorPanel {
  constructor() {
    this.panel = undefined;
    this.suppressedUntil = 0;
  }

  sync() {
    if (Date.now() < this.suppressedUntil) {
      this.dispose();
      return;
    }
    if (!folderOpen()) {
      this.dispose();
      return;
    }
    if (hasWorkspaceEditor()) {
      this.dispose();
      return;
    }
    this.open();
  }

  open() {
    if (this.panel) {
      this.render();
      this.panel.reveal(vscode.ViewColumn.One, false);
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      "codeme.start",
      "Start",
      { viewColumn: vscode.ViewColumn.One, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
    this.panel.webview.onDidReceiveMessage((message) => this.onMessage(message));
    this.render();
    this.panel.reveal(vscode.ViewColumn.One, false);
    vscode.commands.executeCommand("codeme.agent.focus").then(() => {}, () => {});
  }

  render() {
    if (!this.panel) return;
    const nonce = crypto.randomBytes(16).toString("hex");
    this.panel.webview.html = renderEmptyEditor(nonce);
  }

  async onMessage(message) {
    if (!message || message.type !== "empty") return;
    if (message.action === "open") {
      await vscode.commands.executeCommand("workbench.action.quickOpen");
      return;
    }
    if (message.action === "search") {
      await vscode.commands.executeCommand("workbench.action.findInFiles");
      return;
    }
    if (message.action === "terminal") {
      await vscode.commands.executeCommand("workbench.action.terminal.toggleTerminal");
      return;
    }
    if (message.action === "ask") await vscode.commands.executeCommand("codeme.agent.focus");
  }

  suppress(durationMs = 1000) {
    this.suppressedUntil = Math.max(this.suppressedUntil, Date.now() + Math.max(0, Number(durationMs) || 0));
    this.dispose();
  }

  dispose() {
    if (this.panel) this.panel.dispose();
  }
}

function hasWorkspaceEditor() {
  return hasWorkspaceEditorInGroups(vscode.window.tabGroups.all);
}

async function listRecentProjects() {
  try {
    const recent = await vscode.commands.executeCommand("_workbench.getRecentlyOpened");
    const workspaces = (recent && recent.workspaces) || [];
    return workspaces.slice(0, 3).map((item) => {
      const uri = item.folderUri || (item.workspace && item.workspace.configPath);
      if (!uri) return undefined;
      const fsPath = uri.fsPath || "";
      let when = "";
      try {
        when = formatRelativeTime(fs.statSync(fsPath).mtimeMs);
      } catch {
        when = "";
      }
      return {
        name: item.label || path.basename(fsPath) || "Untitled",
        path: displayPath(fsPath),
        when,
        uri: String(uri),
      };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function displayPath(fsPath) {
  const home = process.env.HOME;
  if (home && fsPath.startsWith(home)) return `~${fsPath.slice(home.length)}`;
  return fsPath;
}

async function createProject() {
  const selected = await vscode.window.showOpenDialog({
    title: "Create Project",
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Open Project",
  });
  if (!selected || !selected[0]) return;
  await vscode.commands.executeCommand("vscode.openFolder", selected[0]);
}

async function probeHub(capabilityProvider, mcpProvider) {
  const details = [];
  const capabilities = [];
  let connected = false;
  let tools = [];
  let categories = {};
  let imageUploadAllowed = false;
  let actionsAllowed = false;

  if (mcpProvider && typeof mcpProvider.connectionStatus === "function") {
    const mcp = await mcpProvider.connectionStatus();
    if (mcp.connected) {
      connected = true;
      const count = Number(mcp.toolCount || 0);
      tools = Array.isArray(mcp.toolRecords) ? mcp.toolRecords.map((item) => ({ ...item })) : [];
      categories = mcp.categories && typeof mcp.categories === "object" ? { ...mcp.categories } : {};
      imageUploadAllowed = Boolean(mcp.imageUploadAllowed);
      actionsAllowed = Boolean(mcp.actionsAllowed);
      const imageCount = tools.filter((item) => item.acceptsImage).length;
      const categoryText = Object.entries(categories)
        .sort((a, b) => b[1] - a[1])
        .map(([name, total]) => name + ":" + total)
        .join(", ");
      details.push(
        "n8n MCP connected: " + count + " tool" + (count === 1 ? "" : "s")
        + (imageCount ? " · " + imageCount + " image-capable" : "")
        + (categoryText ? " · " + categoryText : "")
      );
      for (const name of mcp.tools || []) capabilities.push(name);
    } else {
      const code = mcp.error && mcp.error.code;
      details.push(code === "auth_required"
        ? "n8n MCP is reachable but needs an MCP bearer token"
        : "n8n MCP unavailable");
    }
  } else {
    details.push("n8n MCP client unavailable");
  }

  if (capabilityProvider && typeof capabilityProvider.connectionStatus === "function") {
    const status = await capabilityProvider.connectionStatus();
    if (status.connected) {
      connected = true;
      const listed = await capabilityProvider.listCapabilities();
      const names = listed.map((item) => item.name).filter((name) => typeof name === "string");
      for (const name of names) capabilities.push(name);
      details.push(names.length
        ? "Webhook hub: " + names.length + " capabilit" + (names.length === 1 ? "y" : "ies")
        : "Webhook hub reachable, no published capabilities");
    } else {
      details.push("Webhook hub unavailable");
    }
  }

  return {
    connected,
    capabilities: [...new Set(capabilities)],
    tools,
    categories,
    imageUploadAllowed,
    actionsAllowed,
    detail: details.join(" · ") || "Intelligence hub is not configured.",
  };
}

async function discoverConfiguredModels() {
  const localUrl = process.env.CODEME_LOCAL_OLLAMA_URL || process.env.CODEME_OLLAMA_URL || "http://127.0.0.1:11434";
  const serverUrl = process.env.CODEME_SERVER_OLLAMA_URL || "";
  const endpoints = [
    { id: "local", label: "Local", provider: "ollama-local", url: localUrl, configured: true },
    { id: "server", label: "Server", provider: "ollama-server", url: serverUrl, configured: Boolean(serverUrl) },
  ];

  const results = await Promise.all(endpoints.map(async (endpoint) => {
    if (!endpoint.configured) {
      return {
        source: {
          id: endpoint.id,
          label: endpoint.label,
          configured: false,
          available: false,
          count: 0,
          message: "Not configured",
        },
        models: [],
      };
    }
    try {
      const models = await listOllamaModels(
        endpoint.url,
        endpoint.provider,
        endpoint.label,
        { strict: true },
      );
      return {
        source: {
          id: endpoint.id,
          label: endpoint.label,
          configured: true,
          available: true,
          count: models.length,
          message: models.length ? `${models.length} model${models.length === 1 ? "" : "s"}` : "No models installed",
        },
        models,
      };
    } catch (error) {
      return {
        source: {
          id: endpoint.id,
          label: endpoint.label,
          configured: true,
          available: false,
          count: 0,
          message: error instanceof Error ? error.message : String(error),
        },
        models: [],
      };
    }
  }));

  return {
    models: results.flatMap((item) => item.models),
    sources: results.map((item) => item.source),
  };
}

function modelDiscoveryDetail(snapshot) {
  const sources = (snapshot && snapshot.modelSources) || [];
  if (!sources.length) return "No model sources have been checked yet.";
  return sources.map((source) => {
    if (!source.configured) return `${source.label}: not configured`;
    if (!source.available) return `${source.label}: unavailable`;
    return `${source.label}: ${source.count} model${source.count === 1 ? "" : "s"}`;
  }).join(" · ");
}

function applyConnection(item, state) {
  if (state.grade === "chat_only") {
    item.text = "$(sparkle) model offline";
  } else {
    const selected = state.selectedLabel ? state.selectedLabel : "local model";
    item.text = `$(sparkle) ${selected}`;
  }
  item.tooltip = state.detail;
}

function readGrade() {
  try {
    const file = path.join(__dirname, "model-grade.json");
    return JSON.parse(fs.readFileSync(file, "utf8")).grade;
  } catch {
    return "";
  }
}

function workspaceRoot() {
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  return folder ? folder.uri.fsPath : "";
}

function fileFromUri(uri) {
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!folder) return { path: String(uri || "") };
  let parsed = String(uri || "");
  if (parsed.startsWith("file:")) parsed = vscode.Uri.parse(parsed).fsPath;
  const name = path.basename(parsed);
  let size = 0;
  let type = fileType(name);
  try {
    const stat = fs.statSync(parsed);
    if (stat.isDirectory()) return { path: parsed, kind: "folder", name, size: 0, type: "folder" };
    size = stat.size;
  } catch {
    size = 0;
  }
  return {
    path: parsed,
    name,
    size,
    type,
    kind: "file",
  };
}

function fileType(name) {
  const ext = path.extname(name).slice(1).toLowerCase();
  const known = {
    md: "text/markdown",
    js: "text/javascript",
    jsx: "text/javascript",
    ts: "text/typescript",
    tsx: "text/typescript",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    bmp: "image/bmp",
    pdf: "application/pdf",
    txt: "text/plain",
    py: "text/x-python",
    html: "text/html",
    css: "text/css",
  };
  return known[ext] || (ext ? `text/${ext}` : "text/plain");
}

class ComposerViewProvider {
  constructor(context, state) {
    this.context = context;
    this.state = state;
    this.view = undefined;
    this.capabilities = N8nCapabilityProvider ? new N8nCapabilityProvider({ retries: 0, retryDelayMs: 1 }) : null;
    this.n8n = new N8nIntegration(context);
    this.externalTools = this.n8n;
    this.syncExternalPermissions();
    this.session = new ComposerSession({
      store: new RunStore(path.join(context.globalStorageUri.fsPath, "composer-runs")),
      historyStore: new ConversationStore(path.join(context.globalStorageUri.fsPath, "composer-history")),
      selectionStore: {
        get: () => context.globalState.get("codeme.model"),
        set: (value) => context.globalState.update("codeme.model", value),
        getMode: () => context.globalState.get("codeme.mode") || "read_only",
        setMode: (value) => context.globalState.update("codeme.mode", value),
      },
      listModels: () => discoverConfiguredModels(),
      createProvider: (selection) => {
        if (!OllamaModelProvider) {
          throw Object.assign(new Error("Ollama provider is not connected"), { code: "unknown_provider" });
        }
        if (selection.provider === "ollama-local" || selection.provider === "ollama") {
          const baseUrl = process.env.CODEME_LOCAL_OLLAMA_URL || process.env.CODEME_OLLAMA_URL || "http://127.0.0.1:11434";
          return new OllamaModelProvider({ baseUrl });
        }
        if (selection.provider === "ollama-server") {
          const baseUrl = process.env.CODEME_SERVER_OLLAMA_URL;
          if (!baseUrl) {
            throw Object.assign(new Error("Remote Ollama server is not configured"), { code: "unknown_provider" });
          }
          return new OllamaModelProvider({ baseUrl });
        }
        throw Object.assign(new Error(`Provider ${selection.provider} is not connected`), { code: "unknown_provider" });
      },
      createRegistry: (mode) => new ToolRegistry(
        mode === "controlled" ? new ControlledToolProvider(host) : new ReadOnlyToolProvider(host),
      ),
      capabilities: this.capabilities,
      externalTools: this.externalTools,
      n8n: this.n8n,
      root: workspaceRoot(),
      onChange: (snapshot) => this.post(snapshot),
    });
  }

  syncExternalPermissions() {
    if (!this.n8n || typeof this.n8n.setRuntimePermissions !== "function") return;
    const config = vscode.workspace.getConfiguration("codeme.n8n");
    this.n8n.setRuntimePermissions({
      allowImageUpload: Boolean(config.get("allowImageUpload", false)),
    });
  }

  async resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    const nonce = crypto.randomBytes(16).toString("hex");
    webviewView.webview.html = renderComposer(nonce);
    webviewView.webview.onDidReceiveMessage((message) => this.onMessage(message));
    this.session.setRoot(workspaceRoot());
    await this.n8n.refreshTokenFlag();
    await this.session.refreshModels();
  }

  async sync() {
    if (!this.session) return null;
    this.session.setRoot(workspaceRoot());
    return this.session.refreshModels();
  }

  post(snapshot) {
    const selected = snapshot.selected;
    const discovery = modelDiscoveryDetail(snapshot);
    if (selected) {
      const recorded = readGrade();
      this.state.grade = recorded === "read_only_qualified" || recorded === "limited_agent"
        ? recorded
        : "limited_agent";
      this.state.selectedLabel = selected.label;
      this.state.modelLabel = selected.label;
      this.state.detail = `${selected.label} selected · ${discovery}`;
    } else {
      this.state.grade = "chat_only";
      this.state.selectedLabel = "";
      this.state.modelLabel = "";
      this.state.detail = discovery;
    }
    if (this.refreshStatus) this.refreshStatus();
    if (!this.view) return;
    this.view.webview.postMessage({
      type: "state",
      readOnly: snapshot.mode !== "controlled",
      ...snapshot,
      hub: this.state.hub || { connected: false, capabilities: [], tools: [], categories: {} },
    });
  }

  async onMessage(message) {
    if (!message || !this.view) return;
    if (message.type === "ready") {
      this.post(this.session.snapshot());
      return;
    }
    if (message.type === "submit") {
      const text = String(message.text || "");
      this.view.webview.postMessage({ type: "submitting", epoch: message.epoch });
      try {
        const result = await this.session.submit(text, message.epoch);
        if (!result.ok) {
          this.view.webview.postMessage({ type: "rejected", epoch: message.epoch, code: result.code, message: result.message });
          return;
        }
        this.view.webview.postMessage({ type: "accepted", epoch: message.epoch, requestId: result.requestId, runId: result.runId, text });
      } catch (error) {
        this.view.webview.postMessage({
          type: "rejected",
          epoch: message.epoch,
          code: "submit_failed",
          message: error && error.message ? error.message : "Could not send.",
        });
      }
      return;
    }
    if (message.type === "cancel") {
      if (message.requestId && this.session.requestId && message.requestId !== this.session.requestId) return;
      this.session.cancel();
      return;
    }
    if (message.type === "select-model") {
      const result = this.session.selectModel(message.provider, message.id);
      if (!result.ok) this.view.webview.postMessage({ type: "rejected", code: result.code, message: result.message });
      return;
    }
    if (message.type === "refresh-models") {
      try {
        await this.sync();
      } catch (error) {
        this.view.webview.postMessage({
          type: "rejected",
          code: "model_refresh_failed",
          message: error instanceof Error ? error.message : "Could not refresh models.",
        });
      }
      return;
    }
    if (message.type === "select-mode") {
      this.session.selectMode(message.mode);
      return;
    }
    if (message.type === "new-chat") {
      const result = this.session.newChat();
      if (!result.ok) this.view.webview.postMessage({ type: "rejected", code: result.code, message: result.message });
      return;
    }
    if (message.type === "open-chat") {
      const result = this.session.openChat(message.id);
      if (!result.ok) this.view.webview.postMessage({ type: "rejected", code: result.code, message: result.message });
      return;
    }
    if (message.type === "detach") {
      this.session.detach(message.id);
      return;
    }
    if (message.type === "attach") {
      const files = message.files || [];
      if (!files.length) {
        this.session.notice = "Drop a file, image, or PDF onto the composer.";
        this.session.emit();
        return;
      }
      for (const file of files) {
        if (file && file.contents) this.session.attach(file);
        else this.session.attach(fileFromUri(file.path || file));
      }
      return;
    }
    if (message.type === "pick") await this.pickFiles();
  }

  async pickFiles() {
    const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    const picked = await vscode.window.showOpenDialog({
      title: "Attach files",
      canSelectMany: true,
      canSelectFiles: true,
      canSelectFolders: false,
      openLabel: "Attach",
      defaultUri: folder && folder.uri,
      filters: [
        { name: "All files", extensions: ["*"] },
        { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] },
        { name: "Documents", extensions: ["md", "txt", "pdf", "json", "html", "css", "js", "ts"] },
      ],
    });
    for (const uri of picked || []) this.session.attach(fileFromUri(uri.toString()));
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
