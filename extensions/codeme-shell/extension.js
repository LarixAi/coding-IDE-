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
const { wrapToolCallCompat } = require("./model-tool-compat");
const { wrapResponsePolicy } = require("./model-response-policy");
const { PaperclipBridge } = require("./paperclip-bridge");
const { DebugToolProvider } = require("./debug-tool-provider");
const { VerificationToolProvider } = require("./verification-tool-provider");
const { MultitaskController } = require("./multitask-controller");
const { SettingsPanel } = require("./settings-panel");
const { V19NativeWorkbench } = require("./v19-native-workbench");
const { CodeMeSettingsStore } = require("./settings-store");
const { UniversalMcpRegistry } = require("./universal-mcp");
const { loadProjectBrain, brainPath } = require("../../packages/agent-runtime/project-brain-store");
const { loadSkills } = require("../../packages/agent-runtime/skills");
const { TerminalObserver } = require("./terminal-observer");
const { analyzeImages } = require("./vision-integration");

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
  const settingsStore = new CodeMeSettingsStore(context);
  const composer = new ComposerViewProvider(context, state, settingsStore);
  const v19NativeWorkbench = new V19NativeWorkbench(context);
  const originalComposerPost = composer.post.bind(composer);
  composer.post = (snapshot) => {
    originalComposerPost(snapshot);
    v19NativeWorkbench.update(snapshot);
  };
  context.subscriptions.push(
    composer.terminalObserver,
    {
      dispose: () => {
        if (composer.externalTools && typeof composer.externalTools.close === "function") composer.externalTools.close();
      },
    },
  );
  const paperclip = new PaperclipBridge({ session: composer.session });
  composer.setPaperclip(paperclip);
  paperclip.start().then((status) => {
    if (status.enabled) {
      console.log(
        "CodeMe Paperclip bridge " +
        (status.started ? "started" : "not started") +
        " (" + (status.reason || "ready") + ")",
      );
    }
  }).catch((error) => {
    console.error("CodeMe Paperclip bridge failed to start", error);
  });
  context.subscriptions.push(
    paperclip,
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
  setTimeout(() => {
    v19NativeWorkbench.applyLayout().catch(() => {});
  }, 300);

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

  const settingsPanel = new SettingsPanel(context, {
    store: settingsStore,
    getState: (scope) => buildSettingsState({
      scope,
      composer,
      paperclip,
      state,
    }),
    clearProjectBrain: async () => {
      const root = workspaceRoot();
      if (!root) throw new Error("Open a workspace before clearing Project Brain.");
      fs.rmSync(brainPath(root), { force: true });
      return projectBrainSettingsState(root);
    },
    saveSkill: async (skill) => saveWorkspaceSkill(workspaceRoot(), skill),
    deleteSkill: async (name) => deleteWorkspaceSkill(workspaceRoot(), name),
    updateMcp: async (servers) => {
      if (!composer.externalTools || typeof composer.externalTools.updateServers !== "function") {
        throw new Error("Universal MCP registry is not connected");
      }
      const next = await composer.externalTools.updateServers(servers);
      await refreshHub();
      return next;
    },
    updateN8n: async (patch) => {
      const next = patch && typeof patch === "object" ? { ...patch } : {};
      if (typeof next.allowImageUpload === "boolean") {
        await vscode.workspace.getConfiguration("codeme.n8n").update(
          "allowImageUpload",
          next.allowImageUpload,
          vscode.ConfigurationTarget.Global,
        );
        delete next.allowImageUpload;
      }
      await composer.n8n.update(next);
      composer.syncExternalPermissions();
      await refreshHub();
      return composer.n8n.snapshot();
    },
    onSettingsChanged: async () => {
      composer.post(composer.session.snapshot());
    },
  });
  context.subscriptions.push(settingsPanel);

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
    vscode.commands.registerCommand("codeme.openSettings", () => settingsPanel.open()),
    vscode.commands.registerCommand("codeme.openExplorer", () => vscode.commands.executeCommand("workbench.view.explorer")),
    vscode.commands.registerCommand("codeme.openTerminal", () => openTerminalPanel()),
    vscode.commands.registerCommand("codeme.openPreview", () => openIntegratedPreview()),
    vscode.commands.registerCommand("codeme.openFile", (filePath) => openWorkspaceFile(filePath)),
    vscode.commands.registerCommand("codeme.hideStart", () => emptyEditor.suppress(1500)),
  );
}

function applyHub(item, state) {
  const hub = state.hub || {};
  item.text = hub.connected ? "$(radio-tower) hub" : "$(radio-tower) hub offline";
  item.tooltip = hub.detail || "";
}

async function probePaperclipHealth(paperclip) {
  const status = paperclip && typeof paperclip.status === "function"
    ? paperclip.status()
    : { enabled: false, configured: false, started: false, reason: "unavailable" };

  if (!status.enabled) {
    return { status: "offline", detail: "Paperclip is disabled." };
  }
  if (!status.started) {
    return { status: "offline", detail: "CodeMe Paperclip bridge is not running." };
  }
  if (!status.configured) {
    return {
      status: "degraded",
      detail: "Paperclip bridge is running, but credentials or agent configuration are incomplete.",
    };
  }

  try {
    if (paperclip.api && typeof paperclip.api.request === "function") {
      await paperclip.api.request("GET", "/api/agents/me");
    }
    const team = status.team || {};
    const agents = Array.isArray(team.agents) ? team.agents : [];
    const missing = agents.filter((agent) => !agent.configured);
    if (missing.length) {
      return {
        status: "degraded",
        detail: "Paperclip control plane is reachable, but " + missing.length + " team agent(s) are not configured.",
      };
    }
    return {
      status: "online",
      detail: "Bridge, control plane and configured team are ready.",
    };
  } catch (error) {
    const endpoint = paperclip && paperclip.api && paperclip.api.baseUrl
      ? " at " + String(paperclip.api.baseUrl)
      : "";
    return {
      status: "degraded",
      detail: "CodeMe bridge is running, but the Paperclip control plane" + endpoint + " is unavailable: "
        + (error instanceof Error ? error.message : String(error)),
    };
  }
}

function modelHealth(snapshot) {
  const sources = Array.isArray(snapshot && snapshot.modelSources) ? snapshot.modelSources : [];
  const available = sources.filter((source) => source && source.available);
  if (snapshot && snapshot.selected && available.length) {
    return {
      status: "online",
      detail: String(snapshot.selected.label || snapshot.selected.id || "Selected model") + " is ready.",
    };
  }
  if (available.length) {
    return {
      status: "degraded",
      detail: "Model server is reachable, but no model is selected.",
    };
  }
  return {
    status: "offline",
    detail: sources.length
      ? sources.map((source) => source.label + ": " + (source.message || "unavailable")).join(" · ")
      : "No model server has been discovered.",
  };
}

function projectBrainSettingsState(root) {
  if (!root) return { exists: false, path: ".codeme/project-brain.json", counts: {}, identity: null, requirements: [], decisions: [], lessons: [], files: [] };
  const brain = loadProjectBrain(root);
  if (!brain) return { exists: false, path: ".codeme/project-brain.json", counts: {}, identity: null, requirements: [], decisions: [], lessons: [], files: [] };
  const files = Object.values(brain.files || {});
  return {
    exists: true,
    path: ".codeme/project-brain.json",
    identity: brain.identity || null,
    counts: {
      requirements: (brain.requirements || []).length,
      decisions: (brain.decisions || []).length,
      lessons: (brain.lessons || []).length,
      files: files.length,
    },
    requirements: (brain.requirements || []).slice(-12).map((item) => ({ ...item })),
    decisions: (brain.decisions || []).slice(-12).map((item) => ({ ...item })),
    lessons: (brain.lessons || []).slice(-12).map((item) => ({ ...item })),
    files: files.slice(-20).map((item) => ({ ...item })),
  };
}

function safeSkillSlug(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function skillsSettingsState(root) {
  if (!root) return { items: [] };
  return {
    items: loadSkills(root).map((skill) => ({
      name: skill.name,
      description: skill.description,
      source: skill.source,
      path: skill.path || "",
    })),
  };
}

function saveWorkspaceSkill(root, input = {}) {
  if (!root) throw new Error("Open a workspace before saving a skill.");
  const name = safeSkillSlug(input.name);
  if (!name) throw new Error("Skill name is required.");
  const description = String(input.description || "").trim().slice(0, 300);
  const instructions = String(input.instructions || "").trim();
  if (!instructions) throw new Error("Skill instructions are required.");
  const dir = path.join(root, ".codeme", "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  const body = [
    "---",
    "name: " + name,
    description ? "description: " + JSON.stringify(description) : "",
    "---",
    instructions,
    "",
  ].filter((line) => line !== "").join("\n");
  fs.writeFileSync(path.join(dir, "SKILL.md"), body, "utf8");
  return skillsSettingsState(root);
}

function deleteWorkspaceSkill(root, rawName) {
  if (!root) throw new Error("Open a workspace before deleting a skill.");
  const name = safeSkillSlug(rawName);
  if (!name) throw new Error("Skill name is required.");
  const dir = path.join(root, ".codeme", "skills", name);
  const base = path.join(root, ".codeme", "skills");
  const resolved = path.resolve(dir);
  if (resolved !== path.resolve(base) && !resolved.startsWith(path.resolve(base) + path.sep)) {
    throw new Error("Skill path escaped the workspace.");
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return skillsSettingsState(root);
}

async function buildSettingsState({ scope, composer, paperclip, state }) {
  const snapshot = composer.session.snapshot();
  let n8nStatus;
  try {
    n8nStatus = await composer.n8n.connectionStatus();
  } catch (error) {
    n8nStatus = {
      connected: false,
      error: { message: error instanceof Error ? error.message : String(error) },
    };
  }
  await composer.n8n.refreshTokenFlag();
  const n8n = composer.n8n.snapshot();
  const paperclipStatus = paperclip.status();
  const paperclipHealth = await probePaperclipHealth(paperclip);
  const root = workspaceRoot();

  return {
    scope,
    workspace: {
      name: root ? path.basename(root) : "",
      path: root || "",
    },
    projectBrain: projectBrainSettingsState(root),
    skills: skillsSettingsState(root),
    health: {
      paperclip: paperclipHealth,
      n8n: {
        status: n8nStatus && n8nStatus.connected ? "online" : "offline",
        detail: n8nStatus && n8nStatus.connected
          ? "n8n MCP connected with " + String(n8nStatus.toolCount || 0) + " discovered tool(s)."
          : (n8nStatus && n8nStatus.error && n8nStatus.error.message) || "n8n MCP is unavailable.",
      },
      model: modelHealth(snapshot),
    },
    models: {
      selected: snapshot.selected || null,
      sources: Array.isArray(snapshot.modelSources) ? snapshot.modelSources : [],
      available: Array.isArray(snapshot.models) ? snapshot.models : [],
    },
    n8n,
    mcp: composer.externalTools && typeof composer.externalTools.snapshot === "function"
      ? composer.externalTools.snapshot()
      : { servers: [], status: [] },
    paperclip: {
      ...paperclipStatus,
      apiUrl: paperclip.api && paperclip.api.baseUrl || "",
      bridgeUrl: paperclipStatus.host && paperclipStatus.port
        ? "http://" + paperclipStatus.host + ":" + paperclipStatus.port
        : "",
    },
    hub: state.hub || {},
  };
}

async function applyPreferredSettings() {
  const config = vscode.workspace.getConfiguration();
  const pairs = [
    ["chat.disableAIFeatures", true],
    ["chat.titleBar.signIn.enabled", false],
    ["chat.titleBar.openInAgentsWindow.enabled", false],
    ["workbench.secondarySideBar.defaultVisibility", "visible"],
    ["workbench.panel.defaultLocation", "bottom"],
    ["explorer.compactFolders", false],
    ["explorer.decorations.badges", true],
    ["explorer.decorations.colors", true],
    ["workbench.tree.indent", 12],
    ["workbench.tree.renderIndentGuides", "always"],
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

async function openWorkspaceFile(filePath) {
  const root = workspaceRoot();
  const requested = String(filePath || "").trim();
  if (!root || !requested) return false;
  const candidate = path.isAbsolute(requested)
    ? path.resolve(requested)
    : path.resolve(root, requested);
  const resolvedRoot = path.resolve(root);
  if (candidate !== resolvedRoot && !candidate.startsWith(resolvedRoot + path.sep)) {
    await vscode.window.showWarningMessage("CodeMe can only open files inside the current workspace.");
    return false;
  }
  try {
    await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(candidate), { preview: false });
    return true;
  } catch (error) {
    await vscode.window.showWarningMessage(
      "Could not open " + requested + ": " + (error && error.message ? error.message : String(error)),
    );
    return false;
  }
}

async function openTerminalPanel() {
  await runCommand("workbench.action.positionPanelBottom");
  await runCommand("workbench.action.terminal.focus");
  return true;
}

async function openIntegratedPreview() {
  let status;
  try {
    status = await host.processStatus();
  } catch (error) {
    await vscode.window.showWarningMessage(
      "CodeMe could not read the preview session: " + (error && error.message ? error.message : String(error)),
    );
    return false;
  }
  const url = status && status.status === "running"
    ? String(status.url || status.origin || "")
    : "";
  if (!url) {
    await vscode.window.showInformationMessage(
      "No CodeMe preview is running yet. Start the app from Code mode, then open Preview.",
    );
    return false;
  }
  try {
    await vscode.commands.executeCommand("simpleBrowser.show", url);
    return true;
  } catch (error) {
    await vscode.window.showWarningMessage(
      "The integrated Simple Browser could not open " + url + ". " +
      (error && error.message ? error.message : String(error)),
    );
    return false;
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
  await runCommand("workbench.action.positionPanelBottom");
  await runCommand("workbench.action.terminal.focus");
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

function modelDisplayName(id) {
  if (id === "qwen3.5:9b") return "Qwen 3.5 9B";
  const parts = String(id || "").split(":");
  const name = parts[0] || "";
  const tag = parts[1] || "";
  const words = name
    .replace(/[._-]+/g, " ")
    .replace(/(\d)/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim();
  const titled = words.replace(/\b\w/g, (letter) => letter.toUpperCase());
  return tag ? titled + " " + tag.toUpperCase() : titled;
}

async function discoverOllamaEndpoint(endpoint) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(new URL("/api/tags", endpoint.url), {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error("model list returned HTTP " + response.status);
    }
    const body = await response.json();
    const models = (Array.isArray(body.models) ? body.models : [])
      .map((model) => String(model && model.name || "").trim())
      .filter(Boolean)
      .map((id) => ({
        provider: endpoint.provider,
        id,
        source: endpoint.label,
        label: endpoint.label + " · " + modelDisplayName(id),
      }));
    return {
      source: {
        id: endpoint.id,
        label: endpoint.label,
        configured: true,
        available: true,
        count: models.length,
        message: models.length
          ? models.length + " model" + (models.length === 1 ? "" : "s")
          : "No models installed",
        url: endpoint.url,
      },
      models,
    };
  } catch (error) {
    const timedOut = error && (error.name === "AbortError" || error.name === "TimeoutError");
    const message = timedOut
      ? "Timed out after 6s"
      : error instanceof Error
        ? error.message
        : String(error);
    return {
      source: {
        id: endpoint.id,
        label: endpoint.label,
        configured: true,
        available: false,
        count: 0,
        message,
        url: endpoint.url,
      },
      models: [],
    };
  } finally {
    clearTimeout(timer);
  }
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
          url: "",
        },
        models: [],
      };
    }
    return discoverOllamaEndpoint(endpoint);
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
    if (!source.available) {
      return `${source.label}: unavailable${source.message ? " (" + source.message + ")" : ""}`;
    }
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
  constructor(context, state, settingsStore = null) {
    this.context = context;
    this.state = state;
    this.view = undefined;
    this.paperclip = null;
    this.multitask = null;
    this.capabilities = N8nCapabilityProvider ? new N8nCapabilityProvider({ retries: 0, retryDelayMs: 1 }) : null;
    this.n8n = new N8nIntegration(context);
    this.terminalObserver = new TerminalObserver(vscode).start();
    this.externalTools = new UniversalMcpRegistry(context, this.n8n, [this.terminalObserver]);
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
          return wrapResponsePolicy(wrapToolCallCompat(new OllamaModelProvider({ baseUrl })));
        }
        if (selection.provider === "ollama-server") {
          const baseUrl = process.env.CODEME_SERVER_OLLAMA_URL;
          if (!baseUrl) {
            throw Object.assign(new Error("Remote Ollama server is not configured"), { code: "unknown_provider" });
          }
          return wrapResponsePolicy(wrapToolCallCompat(new OllamaModelProvider({ baseUrl })));
        }
        throw Object.assign(new Error(`Provider ${selection.provider} is not connected`), { code: "unknown_provider" });
      },
      createRegistry: (mode) => {
        const composerMode = this.session && this.session.composerMode;
        if (mode === "controlled" && composerMode === "debug") {
          return new ToolRegistry(new DebugToolProvider(host));
        }
        if (mode === "controlled" && composerMode === "test") {
          return new ToolRegistry(new VerificationToolProvider(host));
        }
        return new ToolRegistry(
          mode === "controlled" ? new ControlledToolProvider(host) : new ReadOnlyToolProvider(host),
        );
      },
      capabilities: this.capabilities,
      externalTools: this.externalTools,
      n8n: this.n8n,
      analyzeImages,
      settingsProvider: () => settingsStore ? settingsStore.effectiveValues() : {},
      root: workspaceRoot(),
      onChange: (snapshot) => this.post(snapshot),
    });
  }

  setPaperclip(paperclip) {
    this.paperclip = paperclip || null;
    this.multitask = this.paperclip
      ? new MultitaskController({
        session: this.session,
        paperclip: this.paperclip,
        onChange: () => this.post(this.session.snapshot()),
      })
      : null;
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
    const multitask = this.multitask ? this.multitask.snapshot() : null;
    const multitaskActive = Boolean(multitask && multitask.active);
    const effectiveComposerMode = multitaskActive ? "multitask" : snapshot.composerMode;
    const effectiveRunning = Boolean(snapshot.running || multitaskActive);
    const effectiveActivity = multitaskActive && !snapshot.running
      ? "Multitask · " + String(multitask.phase || "team") + " · " + String(multitask.status || "working")
      : snapshot.activity;
    this.view.webview.postMessage({
      type: "state",
      ...snapshot,
      composerMode: effectiveComposerMode,
      running: effectiveRunning,
      activity: effectiveActivity,
      readOnly: effectiveComposerMode === "multitask" ? false : snapshot.mode !== "controlled",
      multitask,
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
        const result = this.session.composerMode === "multitask"
          ? (this.multitask
            ? this.multitask.start(text, message.epoch)
            : { ok: false, code: "paperclip_unavailable", message: "Multitask is unavailable because Paperclip is not connected." })
          : await this.session.submit(text, message.epoch);
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
    if (message.type === "clarification-submit") {
      this.view.webview.postMessage({ type: "clarification-submitting", epoch: message.epoch });
      try {
        const result = await this.session.submitClarification(
          Array.isArray(message.answers) ? message.answers : [],
          String(message.text || ""),
          message.epoch,
        );
        if (!result.ok) {
          this.view.webview.postMessage({
            type: "clarification-rejected",
            epoch: message.epoch,
            code: result.code,
            message: result.message,
          });
          return;
        }
        this.view.webview.postMessage({
          type: "clarification-accepted",
          epoch: message.epoch,
          requestId: result.requestId,
          runId: result.runId,
          status: result.status || "",
        });
      } catch (error) {
        this.view.webview.postMessage({
          type: "clarification-rejected",
          epoch: message.epoch,
          code: "clarification_failed",
          message: error && error.message ? error.message : "Could not continue.",
        });
      }
      return;
    }
    if (message.type === "resume-run") {
      const result = this.session.resume();
      if (!result.ok) {
        this.view.webview.postMessage({ type: "rejected", code: result.code, message: result.message });
      } else {
        this.view.webview.postMessage({ type: "accepted", epoch: this.session.epoch, requestId: result.requestId, runId: result.runId, text: "" });
      }
      return;
    }
    if (message.type === "cancel") {
      const multitask = this.multitask ? this.multitask.snapshot() : null;
      if (multitask && multitask.active) {
        this.multitask.cancel();
        return;
      }
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
      const multitask = this.multitask ? this.multitask.snapshot() : null;
      if (multitask && multitask.active) {
        this.view.webview.postMessage({
          type: "rejected",
          code: "multitask_busy",
          message: "Stop the active Multitask run before changing modes.",
        });
        return;
      }
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
    if (message.type === "open-file") {
      await openWorkspaceFile(message.path);
      return;
    }
    if (message.type === "open-terminal") {
      await openTerminalPanel();
      return;
    }
    if (message.type === "open-preview") {
      await openIntegratedPreview();
      return;
    }
    if (message.type === "open-explorer") {
      await vscode.commands.executeCommand("workbench.view.explorer");
      return;
    }
    if (message.type === "attach") {
      const files = Array.isArray(message.files) ? message.files : [];
      if (!files.length) {
        this.session.notice = "Drop one or more files, images, or PDFs onto the composer.";
        this.session.emit();
        return;
      }
      this.attachFiles(files);
      return;
    }
    if (message.type === "pick") await this.pickFiles();
  }

  attachFiles(files) {
    const added = [];
    const rejected = [];
    for (const file of Array.isArray(files) ? files : []) {
      const input = file && file.contents ? file : fileFromUri(file && file.path ? file.path : file);
      const result = this.session.attach(input);
      if (result && result.ok) added.push(result.attachment);
      else if (result) rejected.push(result);
    }

    if (added.length || rejected.length) {
      const parts = [];
      if (added.length) parts.push("Attached " + added.length + " file" + (added.length === 1 ? "" : "s"));
      if (rejected.length) {
        const reasons = [...new Set(rejected.map((item) => item.message).filter(Boolean))];
        parts.push(rejected.length + " skipped" + (reasons.length ? ": " + reasons.join(" · ") : ""));
      }
      this.session.notice = parts.join(" · ");
      this.session.emit();
    }

    return { added, rejected };
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
    this.attachFiles((picked || []).map((uri) => ({ path: uri.toString() })));
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
