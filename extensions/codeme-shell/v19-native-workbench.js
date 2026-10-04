"use strict";

const vscode = require("vscode");

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

function collectChangedLines(fileDiffs, filesChanged) {
  const map = new Map();

  for (const item of Array.isArray(fileDiffs) ? fileDiffs : []) {
    const path = normalizePath(item && item.path);
    if (!path) continue;
    map.set(path, parseAddedLines(item && item.diff));
  }

  for (const file of Array.isArray(filesChanged) ? filesChanged : []) {
    const path = normalizePath(file);
    if (path && !map.has(path)) map.set(path, []);
  }

  return map;
}

function normalizePath(value) {
  return String(value || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function parseAddedLines(diff) {
  const lines = [];
  let newLine = 0;
  let inHunk = false;

  for (const raw of String(diff || "").split(/\r?\n/)) {
    const hunk = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(raw);
    if (hunk) {
      newLine = Math.max(0, Number(hunk[1]) - 1);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (raw.startsWith("+++")) continue;
    if (raw.startsWith("---")) continue;

    if (raw.startsWith("+")) {
      lines.push(newLine);
      newLine += 1;
      continue;
    }
    if (raw.startsWith("-")) continue;
    if (raw.startsWith("\\ No newline at end of file")) continue;

    newLine += 1;
  }

  return [...new Set(lines)];
}

module.exports = {
  V19NativeWorkbench,
  collectChangedLines,
  parseAddedLines,
};
