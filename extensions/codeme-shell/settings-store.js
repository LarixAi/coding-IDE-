"use strict";

const GLOBAL_KEY = "codeme.settings.v1.global";
const WORKSPACE_KEY = "codeme.settings.v1.workspace";

const DEFAULTS = Object.freeze({
  general: {
    autoSave: true,
    defaultMode: "code",
    openLastWorkspace: true,
  },
  appearance: {
    chatDensity: "comfortable",
    showServiceStatus: true,
  },
  chatActivity: {
    showPaperclipStatus: true,
    showN8nStatus: true,
    showCodeMeTools: true,
    showPaperclipOnlyWhenUsed: true,
    showN8nOnlyWhenUsed: true,
    collapseCompleted: true,
    autoExpandErrors: true,
    showRawJson: false,
  },
  research: {
    requireFreshEvidenceWhenNeeded: true,
    preferN8nResearch: true,
  },
  memory: {
    projectKnowledgeEnabled: true,
    reusableMemoryEnabled: true,
  },
  skills: {
    enabled: true,
  },
  advanced: {
    experimentalFeatures: false,
  },
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeDeep(base, patch) {
  const out = clone(base);
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return out;
  for (const [key, value] of Object.entries(patch)) {
    if (
      value
      && typeof value === "object"
      && !Array.isArray(value)
      && out[key]
      && typeof out[key] === "object"
      && !Array.isArray(out[key])
    ) {
      out[key] = mergeDeep(out[key], value);
    } else {
      out[key] = clone(value);
    }
  }
  return out;
}

function hasDefaultPath(pathValue) {
  const parts = String(pathValue || "").split(".").filter(Boolean);
  let cursor = DEFAULTS;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object" || !(part in cursor)) return false;
    cursor = cursor[part];
  }
  return parts.length > 0;
}

function setPath(target, pathValue, value) {
  const parts = String(pathValue || "").split(".").filter(Boolean);
  if (!parts.length) return target;
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    if (!cursor[key] || typeof cursor[key] !== "object" || Array.isArray(cursor[key])) cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
  return target;
}

function getPath(target, pathValue) {
  const parts = String(pathValue || "").split(".").filter(Boolean);
  let cursor = target;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

class CodeMeSettingsStore {
  constructor(context) {
    if (!context || !context.globalState || !context.workspaceState) {
      throw new Error("CodeMeSettingsStore requires globalState and workspaceState");
    }
    this.context = context;
  }

  globalValues() {
    return mergeDeep(DEFAULTS, this.context.globalState.get(GLOBAL_KEY) || {});
  }

  workspaceOverrides() {
    const value = this.context.workspaceState.get(WORKSPACE_KEY) || {};
    return value && typeof value === "object" ? clone(value) : {};
  }

  effectiveValues() {
    return mergeDeep(this.globalValues(), this.workspaceOverrides());
  }

  snapshot(scope = "global") {
    const normalized = scope === "workspace" ? "workspace" : "global";
    return {
      version: 1,
      scope: normalized,
      defaults: clone(DEFAULTS),
      global: this.globalValues(),
      workspace: this.workspaceOverrides(),
      effective: normalized === "workspace" ? this.effectiveValues() : this.globalValues(),
    };
  }

  async update(scope, pathValue, value) {
    if (!hasDefaultPath(pathValue)) {
      const error = new Error("Unknown CodeMe setting: " + pathValue);
      error.code = "unknown_setting";
      throw error;
    }
    const normalized = scope === "workspace" ? "workspace" : "global";
    if (normalized === "workspace") {
      const current = this.workspaceOverrides();
      setPath(current, pathValue, value);
      await this.context.workspaceState.update(WORKSPACE_KEY, current);
    } else {
      const current = this.context.globalState.get(GLOBAL_KEY) || {};
      setPath(current, pathValue, value);
      await this.context.globalState.update(GLOBAL_KEY, current);
    }
    return this.snapshot(normalized);
  }

  async resetWorkspace(pathValue) {
    if (!hasDefaultPath(pathValue)) {
      const error = new Error("Unknown CodeMe setting: " + pathValue);
      error.code = "unknown_setting";
      throw error;
    }
    const current = this.workspaceOverrides();
    const parts = String(pathValue).split(".").filter(Boolean);
    let cursor = current;
    for (let index = 0; index < parts.length - 1; index += 1) {
      cursor = cursor && cursor[parts[index]];
      if (!cursor || typeof cursor !== "object") return this.snapshot("workspace");
    }
    if (cursor && typeof cursor === "object") delete cursor[parts[parts.length - 1]];
    await this.context.workspaceState.update(WORKSPACE_KEY, current);
    return this.snapshot("workspace");
  }

  async clearWorkspace() {
    await this.context.workspaceState.update(WORKSPACE_KEY, {});
    return this.snapshot("workspace");
  }
}

module.exports = {
  CodeMeSettingsStore,
  DEFAULTS,
  GLOBAL_KEY,
  WORKSPACE_KEY,
  getPath,
  hasDefaultPath,
  mergeDeep,
  setPath,
};
