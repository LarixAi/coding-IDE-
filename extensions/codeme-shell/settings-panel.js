"use strict";

const crypto = require("crypto");
const vscode = require("vscode");
const { CodeMeSettingsStore } = require("./settings-store");
const { renderSettings } = require("./settings-view");

class SettingsPanel {
  constructor(context, options = {}) {
    this.context = context;
    this.options = options;
    this.store = options.store || new CodeMeSettingsStore(context);
    this.panel = null;
    this.scope = "global";
    this.renderEpoch = 0;
  }

  async open(scope = this.scope) {
    this.scope = scope === "workspace" ? "workspace" : "global";
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "codeme.settings",
        "CodeMe Settings",
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
    await this.render();
  }

  async buildState() {
    const base = typeof this.options.getState === "function"
      ? await this.options.getState(this.scope)
      : {};
    return {
      ...base,
      settings: this.store.snapshot(this.scope),
    };
  }

  async render() {
    if (!this.panel) return;
    const epoch = ++this.renderEpoch;
    let state;
    try {
      state = await this.buildState();
    } catch (error) {
      state = {
        settings: this.store.snapshot(this.scope),
        workspace: {},
        health: {
          paperclip: { status: "offline", detail: "Could not read service state." },
          n8n: { status: "offline", detail: "Could not read service state." },
          model: { status: "offline", detail: "Could not read service state." },
        },
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (!this.panel || epoch !== this.renderEpoch) return;
    const nonce = crypto.randomBytes(16).toString("hex");
    this.panel.webview.html = renderSettings(state, nonce);
  }

  async onMessage(message) {
    if (!message || !this.panel) return;
    try {
      if (message.type === "settings-scope") {
        this.scope = message.scope === "workspace" ? "workspace" : "global";
        await this.render();
        return;
      }

      if (message.type === "settings-save") {
        await this.store.update(message.scope, message.path, message.value);
        this.panel.webview.postMessage({ type: "settings-saved" });
        if (typeof this.options.onSettingsChanged === "function") {
          await this.options.onSettingsChanged({
            scope: message.scope,
            path: message.path,
            value: message.value,
            settings: this.store.snapshot(message.scope),
          });
        }
        return;
      }

      if (message.type === "settings-refresh") {
        this.scope = message.scope === "workspace" ? "workspace" : "global";
        await this.render();
        return;
      }

      if (message.type === "settings-n8n-update") {
        if (typeof this.options.updateN8n !== "function") {
          throw new Error("n8n settings are not connected");
        }
        const patch = message.patch && typeof message.patch === "object" ? { ...message.patch } : {};
        await this.options.updateN8n(patch);
        await this.render();
        return;
      }

      if (message.type === "settings-mcp-update") {
        if (typeof this.options.updateMcp !== "function") {
          throw new Error("Universal MCP settings are not connected");
        }
        const servers = Array.isArray(message.servers) ? message.servers : [];
        await this.options.updateMcp(servers);
        await this.render();
        return;
      }

      if (message.type === "settings-memory-clear") {
        if (typeof this.options.clearProjectBrain !== "function") {
          throw new Error("Project Brain management is not connected");
        }
        await this.options.clearProjectBrain();
        await this.render();
        return;
      }

      if (message.type === "settings-skill-save") {
        if (typeof this.options.saveSkill !== "function") {
          throw new Error("Skill management is not connected");
        }
        await this.options.saveSkill(message.skill && typeof message.skill === "object" ? message.skill : {});
        await this.render();
        return;
      }

      if (message.type === "settings-skill-delete") {
        if (typeof this.options.deleteSkill !== "function") {
          throw new Error("Skill management is not connected");
        }
        await this.options.deleteSkill(String(message.name || ""));
        await this.render();
        return;
      }
    } catch (error) {
      if (this.panel) {
        this.panel.webview.postMessage({
          type: "settings-error",
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

module.exports = { SettingsPanel };
