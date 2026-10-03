const assert = require("assert");
const http = require("http");
const {
  N8nMcpProvider,
  wireName,
  parseMcpBody,
  classifyN8nTool,
  buildImageArguments,
  safeMcpContent,
  loopbackCandidates,
} = require("../mcp");

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

function runMetadataTests() {
  const imageTool = {
    name: "vision.read",
    description: "Analyze a screenshot and return visible UI details",
    inputSchema: {
      type: "object",
      properties: {
        imageBase64: { type: "string", description: "Base64 image bytes" },
        prompt: { type: "string" },
      },
      required: ["imageBase64"],
    },
  };
  const meta = classifyN8nTool(imageTool);
  assert.strictEqual(meta.category, "image");
  assert.strictEqual(meta.acceptsImage, true);
  assert.strictEqual(meta.sideEffect, false);

  const args = buildImageArguments(imageTool.inputSchema, [{
    name: "shot.png",
    mimeType: "image/png",
    base64: "aGVsbG8=",
    dataUri: "data:image/png;base64,aGVsbG8=",
  }], "Read this screenshot");
  assert.deepStrictEqual(args, {
    imageBase64: "aGVsbG8=",
    prompt: "Read this screenshot",
  });

  const actionMeta = classifyN8nTool({
    name: "send.email",
    description: "Send an email message",
    inputSchema: { type: "object", properties: { to: { type: "string" } } },
  });
  assert.strictEqual(actionMeta.sideEffect, true);

  const safe = safeMcpContent([
    { type: "text", text: "Visible heading: Dashboard" },
    { type: "image", mimeType: "image/png", data: "A".repeat(2000) },
  ]);
  assert.ok(safe.output.includes("Dashboard"));
  assert.strictEqual(safe.media.length, 1);
  assert.ok(!safe.output.includes("A".repeat(100)), "binary image data must not be echoed into model context");
}

async function main() {
  runMetadataTests();

  assert.deepStrictEqual(loopbackCandidates("http://127.0.0.1:5678/mcp-server/http"), [
    "http://127.0.0.1:5678/mcp-server/http",
    "http://localhost:5678/mcp-server/http",
  ]);
  assert.deepStrictEqual(loopbackCandidates("http://localhost:5678/mcp-server/http"), [
    "http://localhost:5678/mcp-server/http",
    "http://127.0.0.1:5678/mcp-server/http",
  ]);

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
    calls.push({ method: body.method, params: body.params });
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
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          tools: [
            {
              name: "research.problem",
              description: "Research a current problem",
              inputSchema: {
                type: "object",
                properties: { problem: { type: "string" } },
                required: ["problem"],
              },
            },
            {
              name: "vision.read",
              description: "Analyze a screenshot and describe the visible UI",
              inputSchema: {
                type: "object",
                properties: {
                  imageBase64: { type: "string", description: "Base64 image bytes" },
                  prompt: { type: "string" },
                },
                required: ["imageBase64"],
              },
            },
            {
              name: "send.email",
              description: "Send an email message",
              inputSchema: {
                type: "object",
                properties: {
                  to: { type: "string" },
                  text: { type: "string" },
                },
                required: ["to", "text"],
              },
            },
          ],
        },
      }));
      return;
    }

    if (body.method === "tools/call") {
      if (body.params.name === "research.problem") {
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
      if (body.params.name === "vision.read") {
        assert.strictEqual(body.params.arguments.imageBase64, "aGVsbG8=");
        assert.strictEqual(body.params.arguments.prompt, "Explain the screenshot");
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [{ type: "text", text: "The screenshot shows a dashboard with a sidebar." }],
            isError: false,
          },
        }));
        return;
      }
      if (body.params.name === "send.email") {
        throw new Error("blocked action tool must not reach n8n");
      }
    }

    res.statusCode = 404;
    res.end("{}");
  });

  const url = `http://127.0.0.1:${server.address().port}/mcp-server/http`;
  try {
    const provider = new N8nMcpProvider({
      url,
      token: "test-token",
      timeoutMs: 1500,
      allowImageUpload: true,
      allowActions: false,
    });
    const status = await provider.connectionStatus();
    assert.strictEqual(status.connected, true);
    assert.strictEqual(status.toolCount, 3);
    assert.strictEqual(status.toolRecords.filter((item) => item.acceptsImage).length, 1);
    assert.strictEqual(status.toolRecords.filter((item) => item.sideEffect).length, 1);
    assert.strictEqual(status.imageUploadAllowed, true);
    assert.strictEqual(status.actionsAllowed, false);

    const definitions = await provider.listTools();
    assert.strictEqual(definitions.length, 3);
    assert.ok(definitions.some((item) => item.name === "mcp_n8n_research_problem"));
    assert.ok(definitions.some((item) => item.external && item.external.category === "image"));

    const research = await provider.call(
      "mcp_n8n_research_problem",
      { problem: "button bug" },
    );
    assert.strictEqual(research.ok, true);
    assert.strictEqual(research.trusted, false);
    assert.strictEqual(research.data.tool, "research.problem");
    assert.ok(research.data.output.includes("DOMContentLoaded"));

    const image = await provider.assistImages({
      goal: "Explain the screenshot",
      attachments: [{ kind: "image", path: "shot.png", name: "shot.png", type: "image/png" }],
      readAttachment: async () => Buffer.from("hello"),
    });
    assert.strictEqual(image.ok, true);
    assert.strictEqual(image.externalName, "vision.read");
    assert.ok(image.data.output.includes("dashboard"));

    const blocked = await provider.call(
      "mcp_n8n_send_email",
      { to: "test@example.com", text: "hello" },
    );
    assert.strictEqual(blocked.ok, false);
    assert.strictEqual(blocked.error.code, "external_action_permission_required");
    assert.ok(!calls.some((call) => call.method === "tools/call" && call.params && call.params.name === "send.email"));

    const noToken = new N8nMcpProvider({ url, token: "", timeoutMs: 1500 });
    const denied = await noToken.connectionStatus();
    assert.strictEqual(denied.connected, false);
    assert.strictEqual(denied.error.code, "auth_required");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log("ok direct n8n MCP tools, image bridge, and action permissions");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
