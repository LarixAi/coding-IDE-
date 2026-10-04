"use strict";

const vscode = require("vscode");
const { collectChangedLines } = require("./v19-native-diff");

class V19NativeWorkbench {
  constructor(context) {
    this.context = context;
    this.changedLines = new Map();
    this.lastSnapshot = null;

    this.changeDecoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: "rgba(181, 155, 210, 0.07)",
      borderStyle: "solid",
      borderWidth: "0 0 0 2px",
      borderColor: "rgba(181, 155, 210, 0.70)",
      overviewRulerColor: "#b59bd2",
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });

    this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 95);
    this.status.name = "CodeMe file changes";
    this.status.command = "codeme.ask";
    this.status.hide();

    this.codeLensProvider = {
      provideCodeLenses: (document) => {
        const relative = workspaceRelative(document.uri);
        if (!relative || !this.changedLines.has(relative)) return [];
        const lines = this.changedLines.get(relative) || [];
        const line = lines.length ? Math.max(0, Math.min(lines[0], document.lineCount - 1)) : 0;
        return [
          new vscode.CodeLens(
            new vscode.Range(line, 0, line, 0),
            {
              title: "✦ CodeMe changed this file",
              command: "codeme.ask",
              tooltip: "Open CodeMe to review the last AI change",
            },
          ),
        ];
      },
    };

    context.subscriptions.push(
      this.changeDecoration,
      this.status,
      vscode.window.onDidChangeVisibleTextEditors(() => this.applyDecorations()),
      vscode.window.onDidChangeActiveTextEditor(() => this.applyDecorations()),
      vscode.languages.registerCodeLensProvider({ scheme: "file" }, this.codeLensProvider),
      vscode.commands.registerCommand("codeme.v19.applyLayout", () => this.applyLayout()),
      vscode.commands.registerCommand("codeme.v19.clearChangeMarkers", () => this.clear()),
    );
  }

  async applyLayout() {
    if (!vscode.workspace.workspaceFolders || !vscode.workspace.workspaceFolders.length) return;

    await safeCommand("workbench.action.positionSideBarLeft");
    await safeCommand("workbench.action.positionPanelBottom");
    await safeCommand("workbench.action.positionAuxiliaryBarRight");
    await safeCommand("workbench.view.explorer");
    await safeCommand("workbench.action.closeChat");
    await safeCommand("codeme.agent.focus");
  }

  update(snapshot) {
    this.lastSnapshot = snapshot && typeof snapshot === "object" ? snapshot : {};
    this.changedLines = collectChangedLines(this.lastSnapshot.fileDiffs, this.lastSnapshot.filesChanged);
    this.renderStatus();
    this.applyDecorations();

    try {
      vscode.commands.executeCommand("vscode.executeCodeLensProvider", vscode.window.activeTextEditor?.document.uri);
    } catch {}
  }

  clear() {
    this.changedLines.clear();
    this.status.hide();
    this.applyDecorations();
  }

  renderStatus() {
    const count = this.changedLines.size;
    if (!count) {
      this.status.hide();
      return;
    }
    this.status.text = "$(edit) CodeMe · " + count + " changed " + (count === 1 ? "file" : "files");
    this.status.tooltip = "CodeMe changed files in the latest run. Click to open the CodeMe panel.";
    this.status.show();
  }

  applyDecorations() {
    for (const editor of vscode.window.visibleTextEditors) {
      const relative = workspaceRelative(editor.document.uri);
      const lines = relative ? this.changedLines.get(relative) : null;
      if (!lines) {
        editor.setDecorations(this.changeDecoration, []);
        continue;
      }

      const options = (lines.length ? lines : [0])
        .filter((line) => Number.isInteger(line) && line >= 0 && line < editor.document.lineCount)
        .map((line) => ({
          range: new vscode.Range(line, 0, line, 0),
          hoverMessage: "✦ CodeMe changed this line in the latest run.",
        }));

      editor.setDecorations(this.changeDecoration, options);
    }
  }
}

async function safeCommand(command) {
  try {
    await vscode.commands.executeCommand(command);
  } catch {}
}

function workspaceRelative(uri) {
  if (!uri || uri.scheme !== "file" || !vscode.workspace.workspaceFolders?.length) return "";
  const relative = vscode.workspace.asRelativePath(uri, false);
  if (!relative || relative === uri.fsPath) return "";
  return String(relative).replace(/\\/g, "/");
}

module.exports = { V19NativeWorkbench };
