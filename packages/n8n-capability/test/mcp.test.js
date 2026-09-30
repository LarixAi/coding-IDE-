const assert = require("assert");
const http = require("http");
const { CompositeToolProvider, ToolRegistry, ToolProvider } = require("../../agent-runtime/tool-registry");
const {
  McpHttpClient,
  N8nMcpToolProvider,
  enhancePrompt,
  localEnhance,
  parseMcpBody,
  wireName,
} = require("../mcp");

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function readText(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

class LocalProvider extends ToolProvider {
  definitions() {
    return [{ name: "file.read", description: "Read", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }];
  }
  async call(name, args) {
    return { ok: name === "file.read", tool: name, data: { path: args.path, contents: "local" } };
  }
}

async function test(name, fn) {
  try {
    await fn();
    console.log("ok", name);
  } catch (error) {
    console.error("fail", name);
    console.error(error);
    process.exitCode = 1;
  }
}

async function main() {
  await test("parses SSE MCP messages", async () => {
    const body = 'event: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}\n\n';
    assert.deepStrictEqual(parseMcpBody(body, 7).result, { ok: true });
    assert.strictEqual(wireName("Docs Search / GitHub"), "mcp_n8n_Docs_Search_GitHub");
  });

  await test("discovers n8n MCP tools and executes them through one session", async () => {
    const methods = [];
    const sessions = [];
    const auth = [];
    const server = await listen(async (req, res) => {
      const raw = await readText(req);
      const body = JSON.parse(raw || "{}");
      methods.push(body.method);
      sessions.push(req.headers["mcp-session-id"] || "");
      auth.push(req.headers.authorization || "");
      res.setHeader("content-type", "text/event-stream");
      res.setHeader("mcp-session-id", "session-1");
      if (!Object.prototype.hasOwnProperty.call(body, "id")) {
        res.statusCode = 202;
        res.end("");
        return;
      }
      let result = {};
      if (body.method === "initialize") {
        result = { protocolVersion: "2025-03-26" };
      } else if (body.method === "tools/list") {
        result = {
          tools: [
            {
              name: "docs search",
              description: "Search current docs",
              inputSchema: {
                type: "object",
                properties: { query: { type: "string" } },
                required: ["query"],
              },
            },
            {
              name: "schema lookup",
              description: "Look up a database schema",
              inputSchema: { type: "object", properties: { table: { type: "string" } } },
            },
          ],
        };
      } else if (body.method === "tools/call") {
        result = {
          content: [{ type: "text", text: `docs for ${body.params.arguments.query || body.params.arguments.table}` }],
          isError: false,
        };
      }
      res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result })}\n\n`);
    });
    const url = `http://127.0.0.1:${server.address().port}/mcp-server/http`;
    try {
      const provider = new N8nMcpToolProvider({ url, token: "test-token", timeoutMs: 1500 });
      const defs = await provider.discover();
      assert.strictEqual(defs.length, 2);
      assert.strictEqual(defs[0].name, "mcp_n8n_docs_search");
      assert.strictEqual(defs[0].external, true);
      assert.strictEqual(defs[0].externalKind, "mcp");
      assert.strictEqual(defs[0].parameters.required[0], "query");

      const combined = new ToolRegistry(new CompositeToolProvider([new LocalProvider(), provider]));
      assert.ok(combined.definitions().some((tool) => tool.name === "file.read"));
      assert.ok(combined.definitions().some((tool) => tool.name === "mcp_n8n_docs_search"));

      const local = await combined.call("file.read", { path: "README.md" });
      assert.strictEqual(local.ok, true);

      const mcp = await combined.call("mcp_n8n_docs_search", { query: "React boundaries" });
      assert.strictEqual(mcp.ok, true);
      assert.strictEqual(mcp.kind, "mcp");
      assert.strictEqual(mcp.trusted, false);
      assert.strictEqual(mcp.data.workflow, "docs search");
      assert.ok(mcp.data.output.includes("React boundaries"));

      assert.deepStrictEqual(methods.slice(0, 4), [
        "initialize",
        "notifications/initialized",
        "tools/list",
        "tools/call",
      ]);
      assert.strictEqual(sessions[0], "");
      assert.ok(sessions.slice(1).some((value) => value === "session-1"));
      assert.ok(auth.every((value) => value === "Bearer test-token"));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  await test("prompt enhancer sends recent conversation and workspace context to n8n", async () => {
    let requestBody = null;
    const server = await listen(async (req, res) => {
      requestBody = JSON.parse(await readText(req));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        resolved_goal: "Run the existing website and open the current preview. Do not recreate the project.",
      }));
    });
    try {
      const result = await enhancePrompt("can you run it", {
        webhookUrl: `http://127.0.0.1:${server.address().port}/enhance`,
        context: {
          conversation: [
            { role: "user", text: "read the website files" },
            { role: "assistant", text: "I found public/index.html" },
          ],
          workspace: { files: ["public/index.html", "public/style.css"] },
        },
      });
      assert.strictEqual(result.source, "n8n");
      assert.ok(result.prompt.includes("Run the existing website"));
      assert.strictEqual(requestBody.raw_prompt, "can you run it");
      assert.strictEqual(requestBody.recent_conversation.length, 2);
      assert.deepStrictEqual(requestBody.workspace.files, ["public/index.html", "public/style.css"]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  await test("local preflight resolves a short run follow-up without rebuilding", async () => {
    const enhanced = localEnhance("can you run it", {
      conversation: [
        { role: "user", text: "read the website in the folder" },
        { role: "assistant", text: "The website contains index.html and script.js" },
      ],
      workspace: { files: ["public/index.html", "public/script.js"] },
    });
    assert.ok(enhanced.includes("Run the existing website"));
    assert.ok(enhanced.includes("Do not recreate"));
    assert.ok(enhanced.includes("public/index.html"));
  });

  if (process.exitCode) process.exit(process.exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
