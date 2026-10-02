const assert = require("assert");
const { renderSettings } = require("../settings-view");
const { DEFAULTS } = require("../settings-store");

const state = {
  workspace: { name: "demo", path: "/tmp/demo" },
  settings: {
    scope: "global",
    effective: JSON.parse(JSON.stringify(DEFAULTS)),
  },
  health: {
    paperclip: { status: "online", detail: "Bridge, control plane and configured team are ready." },
    n8n: { status: "online", detail: "n8n MCP connected with 4 discovered tool(s)." },
    model: { status: "online", detail: "Local · Qwen 3.5 9B is ready." },
  },
  models: {
    selected: { label: "Local · Qwen 3.5 9B", id: "qwen3.5:9b" },
    sources: [{ id: "local", label: "Local", url: "http://127.0.0.1:11434", available: true, count: 1 }],
    available: [{ label: "Local · Qwen 3.5 9B", id: "qwen3.5:9b", provider: "ollama-local" }],
  },
  n8n: {
    mcpEnabled: true,
    mcpUrl: "http://127.0.0.1:5678/mcp-server/http",
    autoEnhance: true,
    enhanceWebhookUrl: "http://127.0.0.1:5678/webhook/prompt.enrich",
    tokenConfigured: true,
    toolCount: 4,
    safeToolCount: 4,
    categories: { research: 2, knowledge: 2 },
    imageUploadAllowed: false,
  },
  paperclip: {
    configured: true,
    apiUrl: "http://127.0.0.1:3100",
    bridgeUrl: "http://127.0.0.1:7788",
    controller: { active: [] },
    team: {
      mode: "multi-agent",
      agents: [
        { role: "controller", label: "CodeMe Controller", mode: "code", configured: true },
        { role: "cto", label: "CTO Agent", mode: "ask", configured: true },
      ],
    },
    orchestration: { enabled: true, active: [] },
  },
};

const html = renderSettings(state, "settings-nonce");
assert.ok(html.includes("CodeMe Settings"));
assert.ok(html.includes("Models &amp; Providers"));
assert.ok(html.includes("Agents &amp; Teams"));
assert.ok(html.includes("Paperclip"));
assert.ok(html.includes("n8n &amp; Automation"));
assert.ok(html.includes("MCP &amp; Tools"));
assert.ok(html.includes("Research &amp; Web"));
assert.ok(html.includes("Memory &amp; Knowledge"));
assert.ok(html.includes("Workspace"));
assert.ok(html.includes("Terminal"));
assert.ok(html.includes("Browser &amp; Preview"));
assert.ok(html.includes("Git &amp; GitHub"));
assert.ok(html.includes("Chat &amp; Activity"));
assert.ok(html.includes("Permissions"));
assert.ok(html.includes("Secrets &amp; Connections"));
assert.ok(html.includes("Diagnostics"));
assert.ok(html.includes("Backup &amp; Advanced"));
assert.ok(html.includes("activity only when used"));
assert.ok(html.includes("REQUIRED") === false);
assert.ok(html.includes("Local · Qwen 3.5 9B"));
assert.ok(html.includes("http://127.0.0.1:3100"));
assert.ok(html.includes("http://127.0.0.1:5678/mcp-server/http"));
assert.ok(html.includes("Configured — leave blank to keep"));
assert.ok(!html.includes("PAPERCLIP_API_KEY"));
assert.ok(!html.includes("CODEME_N8N_MCP_TOKEN"));
assert.ok(!html.includes("secret-value"));

const script = html.match(/<script nonce="settings-nonce">([\s\S]*?)<\/script>/);
assert.ok(script, "settings script");
new Function(script[1]);

console.log("ok CodeMe settings view");
