const vscode = require("vscode");

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
  connection.text = "$(plug) CodeMe: not connected";
  connection.tooltip = "No model server is connected. The coding agent stays off until a later gate.";
  connection.command = "codeme.showConnection";
  connection.show();
  context.subscriptions.push(connection);

  context.subscriptions.push(
    vscode.commands.registerCommand("codeme.showConnection", () => {
      vscode.window.showInformationMessage(
        "CodeMe is not connected to a model server. Explorer, editor, and terminal are the native Code - OSS tools.",
      );
    }),
  );
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
  <p>Waiting for a model connection. No agent is running.</p>
  <ol>${stages}</ol>
  <div class="box">Connect a model to start. Changed files and diffs show here when a run finishes.</div>
</body>
</html>`;
}

function deactivate() {}

module.exports = { activate, deactivate };
