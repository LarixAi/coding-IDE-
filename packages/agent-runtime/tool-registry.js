const { executeControlled, executeReadOnly, READ_ONLY_TOOLS, CONTROLLED_TOOLS } = require("../agent-tools");

const DEFINITIONS = {
  "workspace.inspect": {
    description: "Inspect the active workspace without changing it. Reports whether it is empty, an existing project, or a general folder, plus root file names (including README.md and .gitignore when present), project markers, languages, frameworks, package manager, scripts, and Git presence.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  "file.read": {
    description: "Read a workspace-relative text file.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  "file.readRange": {
    description: "Read a line range from a workspace-relative text file. Lines are 1-based and inclusive.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, startLine: { type: "integer" }, endLine: { type: "integer" } },
      required: ["path", "startLine", "endLine"],
    },
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
    description: "Start the workspace preview if needed and check a local page. Returns status, title, visible text, console errors, failed requests, and a screenshot. Use the site URL from the project, or a workspace HTML path.",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  "dir.create": {
    description: "Create one workspace-relative folder. Parent folders are created with it. This does not use the shell.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  "dir.list": {
    description: "List files and folders inside the workspace. Use path \".\" for the whole workspace. This does not search file text and does not use the shell.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  "file.patch": {
    description: "Replace one expected snippet, or one line range, in an existing workspace file. If the file no longer matches, nothing is written.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        expected: { type: "string" },
        replacement: { type: "string" },
        startLine: { type: "integer" },
        endLine: { type: "integer" },
      },
      required: ["path", "replacement"],
    },
  },
  "file.write": {
    description: "Write a new workspace file, or replace a small file in full. Parent folders are created for the file. The path must stay inside the workspace.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, contents: { type: "string" } },
      required: ["path", "contents"],
    },
  },
  "terminal.run": {
    description: "Run node on one workspace file, or node --check on one workspace file. No shell syntax.",
    parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
  },
  "tests.run": {
    description: "Run npm test, or node on one workspace test file. No shell syntax.",
    parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
  },
  "process.run": {
    description: "Run npm, npx, node, pnpm, or yarn in the workspace. Pass executable and args. No shell string.",
    parameters: {
      type: "object",
      properties: {
        executable: { type: "string" },
        args: { type: "array", items: { type: "string" } },
      },
      required: ["executable", "args"],
    },
  },
  "process.start": {
    description: "Start a long-running workspace process such as a dev server. Returns a process id.",
    parameters: {
      type: "object",
      properties: {
        executable: { type: "string" },
        args: { type: "array", items: { type: "string" } },
      },
      required: ["executable", "args"],
    },
  },
  "process.status": {
    description: "Read the status of a process started in this workspace.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  "process.stop": {
    description: "Stop a process started in this workspace.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
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
  return names.filter((name) => name !== "workspace.inspect" || (host && typeof host.inspectWorkspace === "function"));
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
    return availableTools(READ_ONLY_TOOLS, this.provider && this.provider.host).map((name) => ({ name, ...DEFINITIONS[name] }));
  }

  async call(name, args) {
    return this.provider.call(name, args || {});
  }
}

module.exports = { ToolProvider, ReadOnlyToolProvider, ControlledToolProvider, ToolRegistry };
