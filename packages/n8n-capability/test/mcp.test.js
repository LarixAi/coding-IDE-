const assert = require("assert");
const http = require("http");
const { N8nMcpProvider, wireName, parseMcpBody } = require("../mcp");

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function main() {
  assert.strictEqual(wireName("Research Docs / Current"), "mcp_n8n_Research_Docs___Current");
  assert.deepStrictEqual(
    parseMcpBody('data: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}\n\n', 7),
    { jsonrpc: "2.0", id: 7, result: { ok: true } },
  );

  const calls = [];
  const server = await listen(async (req, res) => {
    if (req.headers.authorization !== "Bearer test-token") {
      res.statusCode = 401;
      res.end("unauthorized");
      return;
    }
    const body = await readJson(req);
    calls.push(body.method);
    res.setHeader("content-type", "application/json");
    res.setHeader("mcp-session-id", "session-test");

    if (body.method === "notifications/initialized") {
      res.statusCode = 202;
      res.end("");
      return;
    }

    if (body.method === "initialize") {
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "n8n", version: "test" },
        },
      }));
      return;
    }

    if (body.method === "tools/list") {
      const tools = [{
        name: "research.problem",
        description: "Research a current problem",
        inputSchema: {
          type: "object",
          properties: { problem: { type: "string" } },
          required: ["problem"],
        },
      }];
      for (let index = 1; index < 39; index += 1) {
        tools.push({
          name: "workflow." + index,
          description: "Large n8n workflow description " + index + " " + "x".repeat(2200),
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "q".repeat(120) },
            },
          },
        });
      }
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { tools },
      }));
      return;
    }

    if (body.method === "tools/call") {
      assert.strictEqual(body.params.name, "research.problem");
      assert.deepStrictEqual(body.params.arguments, { problem: "button bug" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          content: [{ type: "text", text: "Use DOMContentLoaded before binding the button." }],
          isError: false,
        },
      }));
      return;
    }

    res.statusCode = 404;
    res.end("{}");
  });

  const url = `http://127.0.0.1:${server.address().port}/mcp-server/http`;
  try {
    const provider = new N8nMcpProvider({ url, token: "test-token", timeoutMs: 1500 });
    const status = await provider.connectionStatus();
    assert.strictEqual(status.connected, true);
    assert.strictEqual(status.toolCount, 39);
    assert.strictEqual(status.tools[0], "mcp_n8n_research_problem");

    const definitions = await provider.listTools();
    assert.strictEqual(definitions.length, 39);
    assert.strictEqual(definitions[0].name, "mcp_n8n_research_problem");
    assert.deepStrictEqual(definitions[0].parameters.required, ["problem"]);
    assert.ok(definitions[1].description.length < 600);

    const result = await provider.call(
      "mcp_n8n_research_problem",
      { problem: "button bug" },
    );
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.trusted, false);
    assert.strictEqual(result.data.tool, "research.problem");
    assert.ok(result.data.output.includes("DOMContentLoaded"));
    assert.ok(calls.includes("initialize"));
    assert.ok(calls.includes("tools/list"));
    assert.ok(calls.includes("tools/call"));

    const noToken = new N8nMcpProvider({ url, token: "", timeoutMs: 1500 });
    const denied = await noToken.connectionStatus();
    assert.strictEqual(denied.connected, false);
    assert.strictEqual(denied.error.code, "auth_required");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log("ok direct n8n MCP tools");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
