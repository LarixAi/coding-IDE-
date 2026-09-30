const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { N8nIntegration, listWorkspaceHints } = require("../n8n-integration");
const { renderComposer } = require("../composer-view");

function fakeContext() {
  const state = new Map();
  const secrets = new Map();
  return {
    globalState: {
      get(key) { return state.get(key); },
      async update(key, value) { state.set(key, value); },
    },
    secrets: {
      async get(key) { return secrets.get(key); },
      async store(key, value) { secrets.set(key, value); },
      async delete(key) { secrets.delete(key); },
    },
    _state: state,
    _secrets: secrets,
  };
}

async function main() {
  const context = fakeContext();
  const n8n = new N8nIntegration(context);

  await n8n.update({
    mcpEnabled: true,
    mcpUrl: "http://127.0.0.1:5678/mcp-server/http",
    autoEnhance: true,
    enhanceWebhookUrl: "",
    mcpToken: "secret-token-not-for-public-state",
  });

  const snap = n8n.snapshot();
  assert.strictEqual(snap.mcpEnabled, true);
  assert.strictEqual(snap.autoEnhance, true);
  assert.strictEqual(snap.tokenConfigured, true);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(snap, "mcpToken"), false);
  assert.ok(!JSON.stringify(snap).includes("secret-token-not-for-public-state"));
  assert.strictEqual(await context.secrets.get("codeme.n8n.mcpToken"), "secret-token-not-for-public-state");

  const enhanced = await n8n.enhanceIfEnabled("can you run it", {
    conversation: [
      { role: "user", text: "read the website files" },
      { role: "assistant", text: "I found public/index.html and public/script.js" },
    ],
    workspace: { files: ["public/index.html", "public/script.js"] },
  });
  assert.strictEqual(enhanced.source, "local");
  assert.ok(enhanced.prompt.includes("Run the existing website"));
  assert.ok(enhanced.prompt.includes("Do not recreate"));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-n8n-hints-"));
  fs.mkdirSync(path.join(root, "public"));
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.writeFileSync(path.join(root, "public", "index.html"), "<h1>x</h1>");
  fs.writeFileSync(path.join(root, "server.js"), "console.log('x')");
  fs.writeFileSync(path.join(root, "node_modules", "ignored.js"), "ignored");
  const hints = listWorkspaceHints(root);
  assert.ok(hints.includes("public/index.html"));
  assert.ok(hints.includes("server.js"));
  assert.ok(!hints.some((item) => item.includes("node_modules")));

  await n8n.update({ mcpToken: "" });
  assert.strictEqual(await context.secrets.get("codeme.n8n.mcpToken"), undefined);

  const html = renderComposer("n8n-test-nonce");
  assert.ok(html.includes('id="n8n-toggle"'));
  assert.ok(html.includes('id="n8n-panel"'));
  assert.ok(html.includes('id="n8n-test"'));
  assert.ok(html.includes('id="n8n-auto"'));
  assert.ok(html.includes('id="enhance"'));
  assert.ok(html.includes('type: "n8n-test"'));
  assert.ok(html.includes('type: "enhance-prompt"'));
  const scripts = [...html.matchAll(/<script[^>]*>([\\s\\S]*?)<\\/script>/g)];
  assert.ok(scripts.length >= 1);
  for (const script of scripts) new Function(script[1]);

  console.log("n8n integration settings and preflight passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
