const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseEnvText, findCodeMeRoot, loadRuntimeEnv } = require("../runtime-config");

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-runtime-env-"));
  fs.mkdirSync(path.join(root, "packages", "agent-runtime"), { recursive: true });
  fs.mkdirSync(path.join(root, "extensions", "codeme-shell"), { recursive: true });
  fs.writeFileSync(path.join(root, ".env.example"), "CODEME_LOCAL_OLLAMA_URL=http://127.0.0.1:11434\n");
  return root;
}

const parsed = parseEnvText([
  "# comment",
  "CODEME_SERVER_OLLAMA_URL=http://100.81.117.90:11434",
  "export CODEME_N8N_MCP_URL='http://127.0.0.1:5678/mcp-server/http'",
  'CODEME_N8N_MCP_TOKEN="secret-value"',
  "IGNORED_LINE",
].join("\n"));
assert.strictEqual(parsed.CODEME_SERVER_OLLAMA_URL, "http://100.81.117.90:11434");
assert.strictEqual(parsed.CODEME_N8N_MCP_URL, "http://127.0.0.1:5678/mcp-server/http");
assert.strictEqual(parsed.CODEME_N8N_MCP_TOKEN, "secret-value");

const root = makeRoot();
fs.writeFileSync(path.join(root, ".env"), [
  "CODEME_LOCAL_OLLAMA_URL=http://127.0.0.1:11434",
  "CODEME_SERVER_OLLAMA_URL=http://100.81.117.90:11434",
  "CODEME_N8N_MCP_URL=http://127.0.0.1:5678/mcp-server/http",
  "CODEME_N8N_MCP_TOKEN=test-token",
].join("\n") + "\n");

assert.strictEqual(findCodeMeRoot({ root }), root);

const env = {};
const loaded = loadRuntimeEnv({ root, env });
assert.strictEqual(loaded.loaded, true);
assert.ok(loaded.keys.includes("CODEME_SERVER_OLLAMA_URL"));
assert.strictEqual(env.CODEME_SERVER_OLLAMA_URL, "http://100.81.117.90:11434");
assert.strictEqual(env.CODEME_N8N_MCP_URL, "http://127.0.0.1:5678/mcp-server/http");
assert.strictEqual(env.CODEME_N8N_MCP_TOKEN, "test-token");

const preserved = { CODEME_SERVER_OLLAMA_URL: "http://already-set:11434" };
loadRuntimeEnv({ root, env: preserved });
assert.strictEqual(
  preserved.CODEME_SERVER_OLLAMA_URL,
  "http://already-set:11434",
  "explicit process environment must win over .env by default",
);

loadRuntimeEnv({ root, env: preserved, override: true });
assert.strictEqual(preserved.CODEME_SERVER_OLLAMA_URL, "http://100.81.117.90:11434");

console.log("ok extension-host runtime env loading");
