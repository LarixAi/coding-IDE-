const vscode = require("vscode");
const crypto = require("crypto");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { renderComposer } = require("./hub-panel");
const { renderWelcome } = require("./welcome");
const { readOnly } = require("./code-oss-host");
const { ReadOnlyToolProvider } = require("../../packages/agent-runtime/tool-registry");

let N8nCapabilityProvider;
let buildRequest;
let acceptResponse;
let OllamaModelProvider;
try {
  ({ N8nCapabilityProvider } = require("../../packages/n8n-capability"));
  ({ buildRequest, acceptResponse } = require("../../packages/agent-runtime/capability"));
  ({ OllamaModelProvider } = require("../../packages/agent-runtime/model-provider"));
} catch {
  N8nCapabilityProvider = null;
  OllamaModelProvider = null;
}

const HUB_ACTIONS = {
  "research.problem": (text) => ({ problem: text }),
  "knowledge.lookup": (text) => ({ query: text }),
  "task.decompose": (text) => ({ goal: text }),
};

function activate(context) {
  console.log("CodeMe shell activated");

  const state = {
    grade: "chat_only",
    detail: "Checking the local model server.",
    hub: { connected: false, capabilities: [], detail: "Checking the intelligence hub." },
  };
  const composer = new ComposerViewProvider(state);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("codeme.agent", composer),
  );
  const welcome = new WelcomePanel(state);
  context.subscriptions.push(welcome);
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => arrangeShell(welcome)),
  );
  arrangeShell(welcome);

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
  refreshConnection(state).then(() => {
    applyConnection(connection, state);
    applyHub(hubItem, state);
    composer.render();
    welcome.render();
    console.log(`CodeMe connection: ${state.grade}`);
  });
  probeHub().then((hub) => {
    state.hub = hub;
    applyHub(hubItem, state);
    composer.render();
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("codeme.showConnection", () => {
      vscode.window.showInformationMessage(`${state.detail} ${state.hub.detail}`);
    }),
  );
}

function applyHub(item, state) {
  const hub = state.hub || {};
  item.text = hub.connected ? "$(radio-tower) hub" : "$(radio-tower) hub offline";
  item.tooltip = hub.detail || "";
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

async function arrangeShell(welcome) {
  if (!folderOpen()) {
    await runCommand("workbench.action.closeSidebar");
    await runCommand("workbench.action.closeAuxiliaryBar");
    await closeStockWelcome();
    welcome.open();
    return;
  }
  if (welcome.panel) welcome.panel.dispose();
  await runCommand("workbench.view.explorer");
  await runCommand("codeme.agent.focus");
  await runCommand("workbench.action.chat.open");
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
    this.panel.webview.html = renderWelcome({ detail: this.state.detail }, nonce);
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
    if (message.action === "create") await createProject();
  }

  dispose() {
    if (this.panel) this.panel.dispose();
  }
}

async function createProject() {
  const name = await vscode.window.showInputBox({
    title: "Create Project",
    prompt: "Project folder name",
    placeHolder: "my-project",
  });
  const folderName = String(name || "").trim();
  if (!folderName || folderName.includes("/") || folderName.includes("\\")) return;
  const parent = await vscode.window.showOpenDialog({
    title: "Parent directory",
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Create here",
  });
  if (!parent || !parent[0]) return;
  const root = vscode.Uri.joinPath(parent[0], folderName);
  await vscode.workspace.fs.createDirectory(root);
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, "README.md"), Buffer.from(`# ${folderName}\n`, "utf8"));
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, ".gitignore"), Buffer.from("node_modules/\n", "utf8"));
  await vscode.commands.executeCommand("vscode.openFolder", root);
}

async function probeHub() {
  if (!N8nCapabilityProvider) {
    return { connected: false, capabilities: [], detail: "Intelligence hub client is missing." };
  }
  const provider = new N8nCapabilityProvider({ retries: 0, retryDelayMs: 1 });
  const status = await provider.connectionStatus();
  if (!status.connected) {
    return { connected: false, capabilities: [], detail: "Intelligence hub is not reachable. Explorer, editor, and terminal still work." };
  }
  const listed = await provider.listCapabilities();
  const capabilities = listed.map((item) => item.name).filter((name) => typeof name === "string");
  const detail = capabilities.length
    ? `Intelligence hub connected: ${capabilities.join(", ")}.`
    : "Intelligence hub is up, but no capabilities are published.";
  return { connected: true, capabilities, detail };
}

function applyConnection(item, state) {
  const labels = {
    read_only_qualified: "$(sparkle) qwen3.5:9b",
    limited_agent: "$(sparkle) qwen3.5:9b",
    chat_only: "$(sparkle) local model offline",
  };
  item.text = labels[state.grade] || labels.chat_only;
  item.tooltip = state.detail;
}

function refreshConnection(state) {
  return new Promise((resolve) => {
    const req = http.get("http://127.0.0.1:11434/api/tags", (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          state.grade = "chat_only";
          state.detail = "The model server did not answer. Explorer, editor, and terminal still work.";
          resolve();
          return;
        }
        let installed = false;
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          installed = (body.models || []).some((model) => String(model.name || "").startsWith("qwen3.5:9b"));
        } catch {
          installed = false;
        }
        if (!installed) {
          state.grade = "chat_only";
          state.detail = "Ollama is running, but qwen3.5:9b is not installed. The IDE stays usable.";
          resolve();
          return;
        }
        const recorded = readGrade();
        state.grade = recorded === "read_only_qualified" || recorded === "limited_agent" ? recorded : "limited_agent";
        state.detail = state.grade === "read_only_qualified"
          ? "qwen3.5:9b passed read-only qualification. It cannot edit files."
          : "qwen3.5:9b is installed. Read-only qualification has not passed, so editing stays off.";
        resolve();
      });
    });
    req.setTimeout(2000, () => {
      req.destroy();
      state.grade = "chat_only";
      state.detail = "The model server is not reachable. Explorer, editor, and terminal still work.";
      resolve();
    });
    req.on("error", () => {
      state.grade = "chat_only";
      state.detail = "The model server is not reachable. Explorer, editor, and terminal still work.";
      resolve();
    });
  });
}

function readGrade() {
  try {
    const file = path.join(__dirname, "model-grade.json");
    return JSON.parse(fs.readFileSync(file, "utf8")).grade;
  } catch {
    return "";
  }
}

async function workspaceBrief() {
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!folder) return { open: false, text: "No workspace folder is open." };
  const found = await vscode.workspace.findFiles("**/*", "**/{.git,node_modules,out,dist,.tools}/**", 80);
  const paths = found.map((uri) => vscode.workspace.asRelativePath(uri, false)).sort();
  const active = vscode.window.activeTextEditor;
  const activePath = active ? vscode.workspace.asRelativePath(active.document.uri, false) : "";
  const lines = [
    `Workspace: ${folder.name}`,
    `Root: ${folder.uri.fsPath}`,
    activePath ? `Active file: ${activePath}` : "Active file: none",
    "Files:",
    paths.join("\n") || "(no files found)",
  ];
  return { open: true, text: lines.join("\n") };
}

async function answerChat(webviewView, message) {
  const text = String(message.text || "").trim().slice(0, 4000);
  if (!text) return;
  const post = (body) => webviewView.webview.postMessage({ type: "chat", role: "assistant", text: body });
  if (!OllamaModelProvider) {
    post("The local model client is missing.");
    return;
  }
  const workspace = await workspaceBrief();
  if (!workspace.open) {
    post("No workspace folder is open, so the model cannot see any files. Use Open Folder, then ask again.");
    return;
  }
  const mode = message.mode === "plan" || message.mode === "agent" ? message.mode : "ask";
  const guidance = mode === "agent"
    ? "The user selected Agent mode. File edits stay off. Describe the change from the files you read, and do not claim files were edited."
    : mode === "plan"
      ? "Draft a short implementation plan from the files you read. Do not claim files were edited."
      : "Answer from the open workspace. Read files before you answer. Do not claim files were edited.";
  const tools = new ReadOnlyToolProvider({}).definitions();
  const messages = [
    {
      role: "system",
      content: `You are CodeMe inside the IDE. ${guidance}\nUse file.read and repo.search for files you have not already been shown. Write tools are not available.\n\n${workspace.text}`,
    },
    { role: "user", content: text },
  ];
  try {
    const provider = new OllamaModelProvider({ timeoutMs: 120000 });
    for (let turn = 0; turn < 4; turn += 1) {
      const result = await provider.complete({ model: "qwen3.5:9b", messages, tools });
      const calls = Array.isArray(result.toolCalls) ? result.toolCalls : [];
      if (!calls.length) {
        post(result.text || "The local model returned an empty reply.");
        return;
      }
      messages.push({ role: "assistant", content: result.text || "", toolCalls: calls });
      for (const call of calls.slice(0, 4)) {
        const label = (call.args && (call.args.path || call.args.query)) || "";
        webviewView.webview.postMessage({
          type: "chat",
          role: "assistant",
          done: false,
          text: `Looking at ${call.name}${label ? ` ${label}` : ""}`,
        });
        const observed = await readOnly(call.name, call.args || {});
        messages.push({ role: "tool", name: call.name, content: JSON.stringify(observed).slice(0, 8000) });
      }
    }
    post("The model kept asking for files and did not finish an answer. Ask about a specific file.");
  } catch (error) {
    post(error && error.message ? error.message : "The local model did not answer.");
  }
}

class ComposerViewProvider {
  constructor(state) {
    this.state = state;
    this.view = undefined;
  }

  async resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    const hub = await probeHub();
    this.state.hub = hub;
    this.render();
    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (!message) return;
      if (message.type === "chat") {
        await answerChat(webviewView, message);
        return;
      }
      if (message.type !== "hub") return;
      const text = String(message.text || "").trim().slice(0, 1500);
      if (!text) {
        webviewView.webview.postMessage({ type: "result", text: "Enter a problem or a goal first." });
        return;
      }
      const inputFor = HUB_ACTIONS[message.action];
      if (!inputFor || !buildRequest || !acceptResponse || !N8nCapabilityProvider) {
        webviewView.webview.postMessage({ type: "result", text: "That hub capability is not available." });
        return;
      }
      const provider = new N8nCapabilityProvider({ retries: 0, retryDelayMs: 1 });
      const built = buildRequest({
        runId: "run_composer",
        capability: message.action,
        input: inputFor(text),
        context: { purpose: "composer" },
        timeout: message.action === "task.decompose" ? 80000 : 15000,
      });
      if (!built.ok) {
        webviewView.webview.postMessage({ type: "result", text: built.error.message });
        return;
      }
      const response = await provider.invoke(built.request);
      const accepted = acceptResponse(response, built.request);
      webviewView.webview.postMessage({ type: "result", text: JSON.stringify(accepted, null, 2) });
    });
  }

  render() {
    if (!this.view) return;
    const nonce = crypto.randomBytes(16).toString("hex");
    const hub = this.state.hub || { connected: false, capabilities: [], detail: "Checking the intelligence hub." };
    this.view.webview.html = renderComposer({ ...hub, model: { detail: this.state.detail } }, nonce);
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
