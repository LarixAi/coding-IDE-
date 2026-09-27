const { executeControlled, executeReadOnly, READ_ONLY_TOOLS, CONTROLLED_TOOLS } = require("../agent-tools");

const DEFINITIONS = {
  "workspace.inspect": {
    description: "Inspect the active workspace without changing it. Reports whether it is empty, an existing project, or a general folder, plus project markers, languages, frameworks, package manager, scripts, and Git presence.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  "file.read": {
    description: "Read a workspace-relative text file.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  "repo.search": {
    description: "Search workspace files for a text query.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  "git.status": {
    description: "Show git status for the workspace.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  "git.diff": {
    description: "Show the working tree diff.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  "diagnostics.run": {
    description: "List diagnostics for the workspace.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  "browser.check": {
    description: "Start the workspace preview if needed and check a local page. Use the site URL from the project, or a workspace HTML path.",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  "browser.interact": {
    description: "Drive a real installed Chromium browser against the local preview. For click tasks, click selector or targetText and verify expectedText on that same element. The tool also fails on browser runtime/console errors. Use this for real interaction verification; source inspection alone is not enough.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        action: { type: "string", enum: ["click"] },
        selector: { type: "string" },
        targetText: { type: "string" },
        expectedText: { type: "string" },
      },
      required: ["url", "action"],
    },
  },
  "dir.create": {
    description: "Create one workspace-relative folder. Parent folders are created with it. This does not use the shell.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  "dir.list": {
    description: "List files and folders inside the workspace. Use path \".\" for the whole workspace. This does not search file text and does not use the shell.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  "file.write": {
    description: "Create or fully replace a workspace-relative text file. Parent folders are created for the file. The path must stay inside the workspace.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, contents: { type: "string" } },
      required: ["path", "contents"],
    },
  },
  "file.patch": {
    description: "Edit an existing workspace text file by replacing exactly one occurrence of oldText with newText. Fails if oldText is missing or appears more than once.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        oldText: { type: "string" },
        newText: { type: "string" },
      },
      required: ["path", "oldText", "newText"],
    },
  },
  "terminal.run": {
    description: "Run one short Node command or npm test and wait for it to finish. Never use this to start a website/dev server or append &: use browser.check for web previews.",
    parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
  },
  "process.start": {
    description: "Start a long-running non-browser workspace process when explicitly needed. For website/dev-server previews, use browser.check instead; CodeMe owns preview startup and reuse.",
    parameters: {
      type: "object",
      properties: { command: { type: "string" } },
      required: [],
    },
  },
  "process.status": {
    description: "Read the status of the latest CodeMe-owned long-running process in this workspace. Returns running, exited, failed, exitCode, command, and timestamps.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  "process.logs": {
    description: "Read the bounded, redacted recent stdout/stderr of the latest CodeMe-owned long-running process in this workspace. Use this after a process error instead of guessing from the terminal UI.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  "tests.run": {
    description: "Run npm test, or node on one workspace test file. No shell syntax.",
    parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
  },
};

class ToolProvider {
  async call() {
    throw Object.assign(new Error("ToolProvider.call is not implemented"), { code: "not_implemented" });
  }
}

class ReadOnlyToolProvider extends ToolProvider {
  constructor(host) {
    super();
    this.host = host;
  }

  async call(name, args) {
    return executeReadOnly(this.host, name, args || {});
  }

  definitions() {
    return availableTools(READ_ONLY_TOOLS, this.host).map((name) => ({ name, ...DEFINITIONS[name] }));
  }
}

class ControlledToolProvider extends ToolProvider {
  constructor(host) {
    super();
    this.host = host;
  }

  async call(name, args) {
    return executeControlled(this.host, name, args || {});
  }

  definitions() {
    return availableTools(CONTROLLED_TOOLS, this.host).map((name) => ({ name, ...DEFINITIONS[name] }));
  }
}

function availableTools(names, host) {
  return names.filter((name) => {
    if (name === "workspace.inspect") return Boolean(host && typeof host.inspectWorkspace === "function");
    if (name === "file.patch") return Boolean(host && typeof host.patchFile === "function");
    if (name === "process.start") return Boolean(host && typeof host.startProcess === "function");
    if (name === "process.status") return Boolean(host && typeof host.processStatus === "function");
    if (name === "process.logs") return Boolean(host && typeof host.processLogs === "function");
    if (name === "browser.interact") return Boolean(host && typeof host.browserInteract === "function");
    return true;
  });
}

class ToolRegistry {
  constructor(provider) {
    if (!provider || typeof provider.call !== "function") {
      throw Object.assign(new Error("ToolRegistry requires a ToolProvider"), { code: "invalid_args" });
    }
    this.provider = provider;
  }

  definitions() {
    if (typeof this.provider.definitions === "function") return this.provider.definitions();
    return READ_ONLY_TOOLS.map((name) => ({ name, ...DEFINITIONS[name] }));
  }

  async call(name, args) {
    return this.provider.call(name, args || {});
  }
}

module.exports = { ToolProvider, ReadOnlyToolProvider, ControlledToolProvider, ToolRegistry };
