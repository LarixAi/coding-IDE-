const vscode = require("vscode");
const http = require("http");
const fs = require("fs");
const path = require("path");

const STAGES = [
  "Understanding",
  "Planning",
  "Editing",
  "Testing",
  "Fixing",
  "Verifying",
  "Complete",
];

function activate(context) {
  console.log("CodeMe shell activated");

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("codeme.composer", new ComposerViewProvider()),
  );

  const connection = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  connection.name = "CodeMe model connection";
  connection.command = "codeme.showConnection";
  connection.show();
  context.subscriptions.push(connection);
  const state = { grade: "chat_only", detail: "Checking the local model server." };
  applyConnection(connection, state);
  refreshConnection(state).then(() => {
    applyConnection(connection, state);
    console.log(`CodeMe connection: ${state.grade}`);
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("codeme.showConnection", () => {
      vscode.window.showInformationMessage(state.detail);
    }),
  );
}

function applyConnection(item, state) {
  const labels = {
    read_only_qualified: "$(plug) CodeMe: Qwen read-only",
    limited_agent: "$(plug) CodeMe: limited",
    chat_only: "$(plug) CodeMe: chat only",
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

class ComposerViewProvider {
  resolveWebviewView(webviewView) {
    webviewView.webview.options = { enableScripts: false };
    webviewView.webview.html = composerHtml();
  }
}

function composerHtml() {
  const stages = STAGES.map(
    (stage) => `<li><span class="mark"></span><span>${stage}</span></li>`,
  ).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
  <style>
    body {
      margin: 0;
      padding: 16px;
      color: #d3d8de;
      background: #0f1319;
      font-family: var(--vscode-font-family);
      font-size: 13px;
    }
    h1 {
      margin: 0 0 4px;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #1ed1cd;
    }
    p { margin: 0 0 16px; color: #8c939b; line-height: 1.45; }
    ol { list-style: none; margin: 0 0 16px; padding: 0; }
    li {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
      color: #8c939b;
      border-top: 1px solid #23272d;
    }
    .mark {
      width: 7px;
      height: 7px;
      border-radius: 99px;
      background: #2a2e35;
    }
    .box {
      border: 1px solid #2a2e35;
      background: #13161c;
      color: #8c939b;
      border-radius: 6px;
      padding: 10px 12px;
    }
  </style>
</head>
<body>
  <h1>Composer</h1>
  <p>No agent is running. File edits stay off.</p>
  <ol>${stages}</ol>
  <div class="box">Connect a model to start. Changed files and diffs show here when a run finishes.</div>
</body>
</html>`;
}

function deactivate() {}

module.exports = { activate, deactivate };
