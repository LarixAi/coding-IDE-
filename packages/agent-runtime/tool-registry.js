const { executeControlled, executeReadOnly, READ_ONLY_TOOLS, CONTROLLED_TOOLS } = require("../agent-tools");

const DEFINITIONS = {
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
    description: "Check a running page. Unavailable until a preview runner exists.",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  "file.write": {
    description: "Write a workspace-relative text file. The path must stay inside the workspace.",
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
    return READ_ONLY_TOOLS.map((name) => ({ name, ...DEFINITIONS[name] }));
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
    return CONTROLLED_TOOLS.map((name) => ({ name, ...DEFINITIONS[name] }));
  }
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
