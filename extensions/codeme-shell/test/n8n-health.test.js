const assert = require("assert");
const {
  N8nIntegration,
  n8nServiceCandidates,
  probeN8nService,
  fetchWithLoopbackFallback,
} = require("../n8n-integration");

function state(value) {
  return {
    get() { return value; },
    async update() {},
  };
}

async function main() {
  const candidates = n8nServiceCandidates({
    enhanceWebhookUrl: "http://127.0.0.1:5678/webhook/prompt.enrich",
    mcpUrl: "http://127.0.0.1:5678/mcp-server/http",
  });
  assert.deepStrictEqual(candidates.slice(0, 2), [
    "http://127.0.0.1:5678",
    "http://localhost:5678",
  ]);

  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    const value = String(url);
    calls.push(value);
    if (value.includes("127.0.0.1")) throw new TypeError("fetch failed");
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const service = await probeN8nService({
      enhanceWebhookUrl: "http://127.0.0.1:5678/webhook/prompt.enrich",
      mcpUrl: "http://127.0.0.1:5678/mcp-server/http",
    }, 500);
    assert.strictEqual(service.connected, true);
    assert.strictEqual(service.endpoint, "http://localhost:5678");
    assert.ok(calls.some((url) => url === "http://127.0.0.1:5678/healthz"));
    assert.ok(calls.some((url) => url === "http://localhost:5678/healthz"));

    calls.length = 0;
    const fallback = await fetchWithLoopbackFallback(
      "http://127.0.0.1:5678/webhook/prompt.enrich",
      { method: "POST" },
    );
    assert.strictEqual(fallback.response.ok, true);
    assert.strictEqual(fallback.url, "http://localhost:5678/webhook/prompt.enrich");
    assert.strictEqual(calls.length, 2);

    const integration = new N8nIntegration({
      globalState: state({
        mcpEnabled: false,
        mcpUrl: "http://127.0.0.1:5678/mcp-server/http",
        autoEnhance: true,
        enhanceWebhookUrl: "http://127.0.0.1:5678/webhook/prompt.enrich",
      }),
      secrets: {
        async get() { return ""; },
        async store() {},
        async delete() {},
      },
    });
    const status = await integration.connectionStatus();
    assert.strictEqual(status.connected, false);
    assert.strictEqual(status.serviceConnected, true);
    assert.strictEqual(status.serviceEndpoint, "http://localhost:5678");
    assert.strictEqual(status.error.code, "disabled");
  } finally {
    global.fetch = originalFetch;
  }

  console.log("ok n8n health separates service reachability from MCP and retries loopback hosts");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
