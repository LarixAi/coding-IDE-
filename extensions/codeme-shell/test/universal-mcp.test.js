const assert = require("assert");
const {
  SETTINGS_KEY,
  validateServer,
  UniversalMcpRegistry,
} = require("../universal-mcp");

function memoryState(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get(key) { return map.get(key); },
    async update(key, value) { map.set(key, value); },
  };
}

async function main() {
  assert.strictEqual(validateServer({ name: "GitHub", transport: "http", url: "https://example.test/mcp" }), null);
  assert.match(validateServer({ name: "Bad", transport: "http", url: "ftp://example.test" }), /http/i);
  assert.strictEqual(validateServer({ name: "Files", transport: "stdio", command: "mcp-files" }), null);

  const context = {
    globalState: memoryState({
      [SETTINGS_KEY]: [
        { id: "github", name: "GitHub", enabled: true, transport: "http", url: "https://example.test/mcp", allowActions: false },
      ],
    }),
    secrets: {
      async get() { return ""; },
      async store() {},
      async delete() {},
    },
  };

  const primaryCalls = [];
  const primary = {
    async listTools() {
      return [{ name: "mcp_n8n_research", description: "research", parameters: { type: "object", properties: {} } }];
    },
    async call(name, args) {
      primaryCalls.push({ name, args });
      return { ok: true, tool: name, trusted: false, data: { output: "n8n ok" } };
    },
    snapshot() { return { imageUploadAllowed: false }; },
  };

  const localCalls = [];
  const local = {
    async listTools() {
      return [{ name: "terminal.failures", description: "trusted terminal evidence", parameters: { type: "object", properties: {} } }];
    },
    async call(name, args) {
      localCalls.push({ name, args });
      return { ok: true, tool: name, trusted: true, data: { failures: [] } };
    },
  };

  const registry = new UniversalMcpRegistry(context, primary, [local]);
  registry.clients.set("github", {
    async listTools() {
      return [
        { name: "search_issues", description: "Search issues", inputSchema: { type: "object", properties: { q: { type: "string" } } } },
        { name: "delete_issue", description: "Delete an issue", inputSchema: { type: "object", properties: {} } },
      ];
    },
    async callTool(name, args) {
      return { ok: true, output: name + ":" + JSON.stringify(args) };
    },
  });

  const tools = await registry.listTools();
  const names = tools.map((tool) => tool.name);
  assert.ok(names.includes("mcp_n8n_research"));
  assert.ok(names.includes("terminal.failures"));
  assert.ok(names.includes("mcp_github_search_issues"));
  assert.ok(!names.includes("mcp_github_delete_issue"), "external action tools stay blocked unless explicitly enabled");

  const n8n = await registry.call("mcp_n8n_research", { q: "react" });
  assert.strictEqual(n8n.ok, true);
  assert.strictEqual(primaryCalls.length, 1);

  const terminal = await registry.call("terminal.failures", {});
  assert.strictEqual(terminal.ok, true);
  assert.strictEqual(terminal.trusted, true);
  assert.strictEqual(localCalls.length, 1);

  const external = await registry.call("mcp_github_search_issues", { q: "timeout" });
  assert.strictEqual(external.ok, true);
  assert.strictEqual(external.trusted, false);
  assert.match(external.data.output, /search_issues/);

  const status = await registry.connectionStatus();
  assert.strictEqual(status.connected, true);
  assert.ok(status.servers.some((item) => item.name === "GitHub" && item.ok));
  assert.ok(status.toolCount >= 3);

  console.log("ok universal MCP aggregates n8n, local observers, and custom servers");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
