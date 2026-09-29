const assert = require("assert");
const http = require("http");
const { OllamaModelProvider } = require("../model-provider");

function toolDefinition() {
  return {
    name: "file.read",
    description: "Read a workspace file",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
    },
  };
}

async function withServer(responses, run) {
  const queue = responses.slice();
  const requests = [];
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/api/chat") {
      res.writeHead(404);
      res.end();
      return;
    }
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push(JSON.parse(body));
      const next = queue.shift();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(next));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`, requests);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function runNativeToolCall() {
  await withServer([
    {
      message: {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            function: {
              name: "file_read",
              arguments: { path: "server.js" },
            },
          },
        ],
      },
    },
  ], async (baseUrl) => {
    const provider = new OllamaModelProvider({ baseUrl });
    const result = await provider.complete({
      model: "fixture",
      messages: [{ role: "user", content: "Read server.js" }],
      tools: [toolDefinition()],
    });

    assert.strictEqual(result.text, "");
    assert.deepStrictEqual(result.toolCalls, [
      { name: "file.read", args: { path: "server.js" } },
    ]);
  });
}

async function runJsonContentFallback() {
  await withServer([
    {
      message: {
        role: "assistant",
        content: JSON.stringify({
          name: "file_read",
          arguments: { path: "server.js" },
        }),
      },
    },
  ], async (baseUrl) => {
    const provider = new OllamaModelProvider({ baseUrl });
    const result = await provider.complete({
      model: "fixture",
      messages: [{ role: "user", content: "Read server.js" }],
      tools: [toolDefinition()],
    });

    assert.strictEqual(result.text, "");
    assert.deepStrictEqual(result.toolCalls, [
      { name: "file.read", args: { path: "server.js" } },
    ]);
  });
}

async function runFencedJsonContentFallback() {
  await withServer([
    {
      message: {
        role: "assistant",
        content: `\`\`\`json
{
  "name": "file_read",
  "arguments": { "path": "server.js" }
}
\`\`\``,
      },
    },
  ], async (baseUrl) => {
    const provider = new OllamaModelProvider({ baseUrl });
    const result = await provider.complete({
      model: "fixture",
      messages: [{ role: "user", content: "Read server.js" }],
      tools: [toolDefinition()],
    });

    assert.strictEqual(result.text, "");
    assert.deepStrictEqual(result.toolCalls, [
      { name: "file.read", args: { path: "server.js" } },
    ]);
  });
}

async function runProseWrappedFencedJsonFallback() {
  await withServer([
    {
      message: {
        role: "assistant",
        content: `I'll list the workspace first.

\`\`\`json
{"name":"dir_list","arguments":{"path":"."}}
\`\`\``,
      },
    },
  ], async (baseUrl) => {
    const provider = new OllamaModelProvider({ baseUrl });
    const result = await provider.complete({
      model: "fixture",
      messages: [{ role: "user", content: "Read all the files" }],
      tools: [{
        name: "dir.list",
        description: "List a directory",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      }],
    });

    assert.strictEqual(result.text, "");
    assert.deepStrictEqual(result.toolCalls, [
      { name: "dir.list", args: { path: "." } },
    ]);
  });
}

async function runMultipleFencedJsonFallback() {
  await withServer([
    {
      message: {
        role: "assistant",
        content: `I'll inspect each project folder.

\`\`\`json
{"name":"dir_list","arguments":{"path":"data"}}
\`\`\`

\`\`\`json
{"name":"dir_list","arguments":{"path":"lib"}}
\`\`\`

\`\`\`json
{"name":"dir_list","arguments":{"path":"public"}}
\`\`\`

\`\`\`json
{"name":"dir_list","arguments":{"path":"test"}}
\`\`\``,
      },
    },
  ], async (baseUrl) => {
    const provider = new OllamaModelProvider({ baseUrl });
    const result = await provider.complete({
      model: "fixture",
      messages: [{ role: "user", content: "Read all the files" }],
      tools: [{
        name: "dir.list",
        description: "List a directory",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      }],
    });

    assert.strictEqual(result.text, "");
    assert.deepStrictEqual(result.toolCalls, [
      { name: "dir.list", args: { path: "data" } },
      { name: "dir.list", args: { path: "lib" } },
      { name: "dir.list", args: { path: "public" } },
      { name: "dir.list", args: { path: "test" } },
    ]);
  });
}

async function runXmlToolCallFallback() {
  await withServer([
    {
      message: {
        role: "assistant",
        content: `<tool_call>
{"name":"file_read","arguments":{"path":"server.js"}}
</tool_call>`,
      },
    },
  ], async (baseUrl) => {
    const provider = new OllamaModelProvider({ baseUrl });
    const result = await provider.complete({
      model: "fixture",
      messages: [{ role: "user", content: "Read server.js" }],
      tools: [toolDefinition()],
    });

    assert.strictEqual(result.text, "");
    assert.deepStrictEqual(result.toolCalls, [
      { name: "file.read", args: { path: "server.js" } },
    ]);
  });
}

async function runQwen3XmlToolCallFallback() {
  await withServer([
    {
      message: {
        role: "assistant",
        content: `I will patch the heading now.
<tool_call>
<function=file_patch>
<parameter=path>
public/index.html
</parameter>
<parameter=oldText>
Old Heading
</parameter>
<parameter=newText>
CodeMe Test Heading
</parameter>
</function>
</tool_call>`,
      },
    },
  ], async (baseUrl) => {
    const provider = new OllamaModelProvider({ baseUrl });
    const result = await provider.complete({
      model: "fixture",
      messages: [{ role: "user", content: "Change the heading" }],
      tools: [{
        name: "file.patch",
        description: "Patch a file",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            oldText: { type: "string" },
            newText: { type: "string" },
          },
          required: ["path", "oldText", "newText"],
        },
      }],
    });

    assert.strictEqual(result.text, "");
    assert.deepStrictEqual(result.toolCalls, [{
      name: "file.patch",
      args: {
        path: "public/index.html",
        oldText: "Old Heading",
        newText: "CodeMe Test Heading",
      },
    }]);
  });
}

async function runProseBareJsonFallback() {
  await withServer([
    {
      message: {
        role: "assistant",
        content: 'I will read it now. {"name":"file_read","arguments":{"path":"server.js"}}',
      },
    },
  ], async (baseUrl) => {
    const provider = new OllamaModelProvider({ baseUrl });
    const result = await provider.complete({
      model: "fixture",
      messages: [{ role: "user", content: "Read server.js" }],
      tools: [toolDefinition()],
    });

    assert.deepStrictEqual(result.toolCalls, [
      { name: "file.read", args: { path: "server.js" } },
    ]);
  });
}

async function runQwen25SystemToolMode() {
  await withServer([
    {
      message: {
        role: "assistant",
        content: '<tool_call>{"name":"file_read","arguments":{"path":"server.js"}}</tool_call>',
      },
    },
  ], async (baseUrl, requests) => {
    const provider = new OllamaModelProvider({ baseUrl });
    const result = await provider.complete({
      model: "qwen2.5-coder:14b",
      messages: [
        { role: "system", content: "You are CodeMe." },
        { role: "user", content: "Read server.js" },
      ],
      tools: [toolDefinition()],
    });

    assert.strictEqual(result.toolMode, "system");
    assert.strictEqual(Object.prototype.hasOwnProperty.call(requests[0], "tools"), false);
    const system = requests[0].messages.find((message) => message.role === "system");
    assert.ok(system.content.includes("CODEME TOOL PROTOCOL"));
    assert.ok(system.content.includes("file_read"));
    assert.deepStrictEqual(result.toolCalls, [
      { name: "file.read", args: { path: "server.js" } },
    ]);
  });
}

async function runNativeModeStillUsesOllamaTools() {
  await withServer([
    {
      message: {
        role: "assistant",
        content: "",
        tool_calls: [{ function: { name: "file_read", arguments: { path: "server.js" } } }],
      },
    },
  ], async (baseUrl, requests) => {
    const provider = new OllamaModelProvider({ baseUrl });
    const result = await provider.complete({
      model: "qwen3-coder:30b",
      messages: [{ role: "user", content: "Read server.js" }],
      tools: [toolDefinition()],
    });

    assert.strictEqual(result.toolMode, "native");
    assert.ok(Array.isArray(requests[0].tools));
    assert.strictEqual(requests[0].tools[0].function.name, "file_read");
  });
}

async function runRepairsInvalidHtmlEscapesInToolJson() {
  await withServer([
    {
      message: {
        role: "assistant",
        content: String.raw`{"name":"file_write","arguments":{"path":"public/index.html","contents":"\<!doctype html>\n\<html>\n\<h1>CodeMe Test Heading\</h1>\n\</html>"}}`,
      },
    },
  ], async (baseUrl) => {
    const provider = new OllamaModelProvider({ baseUrl });
    const result = await provider.complete({
      model: "qwen2.5-coder:14b",
      messages: [{ role: "user", content: "Change the heading" }],
      tools: [{
        name: "file.write",
        description: "Write a workspace file",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            contents: { type: "string" },
          },
          required: ["path", "contents"],
        },
      }],
    });

    assert.strictEqual(result.toolCalls.length, 1);
    assert.strictEqual(result.toolCalls[0].name, "file.write");
    assert.strictEqual(result.toolCalls[0].args.path, "public/index.html");
    assert.ok(result.toolCalls[0].args.contents.includes("<!doctype html>"));
    assert.ok(result.toolCalls[0].args.contents.includes("<h1>CodeMe Test Heading</h1>"));
  });
}

async function runAcceptsDottedContractNamesFromQwenFencedJson() {
  await withServer([
    {
      message: {
        role: "assistant",
        content: `\`\`\`json
{
  "name": "file.write",
  "arguments": {
    "path": "public/index.html",
    "contents": "<!doctype html>\\n<html><body><h1>CodeMe Test Heading</h1></body></html>"
  }
}
\`\`\`

\`\`\`json
{
  "name": "browser.check",
  "arguments": {
    "path": "public/index.html"
  }
}
\`\`\``,
      },
    },
  ], async (baseUrl) => {
    const provider = new OllamaModelProvider({ baseUrl });
    const result = await provider.complete({
      model: "qwen2.5-coder:14b",
      messages: [{ role: "user", content: "Change the heading and verify it." }],
      tools: [{
        name: "file.write",
        description: "Write a workspace file",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            contents: { type: "string" },
          },
          required: ["path", "contents"],
        },
      }],
    });

    assert.strictEqual(result.toolCalls.length, 1);
    assert.strictEqual(result.toolCalls[0].name, "file.write");
    assert.strictEqual(result.toolCalls[0].args.path, "public/index.html");
    assert.ok(result.toolCalls[0].args.contents.includes("CodeMe Test Heading"));
  });
}

async function runRejectsUnofferedTool() {
  const raw = JSON.stringify({
    name: "terminal_run",
    arguments: { command: "rm -rf ." },
  });
  await withServer([
    { message: { role: "assistant", content: raw } },
  ], async (baseUrl) => {
    const provider = new OllamaModelProvider({ baseUrl });
    const result = await provider.complete({
      model: "fixture",
      messages: [{ role: "user", content: "Read server.js" }],
      tools: [toolDefinition()],
    });

    assert.strictEqual(result.text, raw);
    assert.deepStrictEqual(result.toolCalls, []);
  });
}

async function runRejectsInvalidArguments() {
  const raw = JSON.stringify({
    name: "file_read",
    arguments: { path: 42 },
  });
  await withServer([
    { message: { role: "assistant", content: raw } },
  ], async (baseUrl) => {
    const provider = new OllamaModelProvider({ baseUrl });
    const result = await provider.complete({
      model: "fixture",
      messages: [{ role: "user", content: "Read server.js" }],
      tools: [toolDefinition()],
    });

    assert.strictEqual(result.text, raw);
    assert.deepStrictEqual(result.toolCalls, []);
  });
}

async function main() {
  await runNativeToolCall();
  await runJsonContentFallback();
  await runFencedJsonContentFallback();
  await runProseWrappedFencedJsonFallback();
  await runMultipleFencedJsonFallback();
  await runXmlToolCallFallback();
  await runQwen3XmlToolCallFallback();
  await runProseBareJsonFallback();
  await runQwen25SystemToolMode();
  await runNativeModeStillUsesOllamaTools();
  await runRepairsInvalidHtmlEscapesInToolJson();
  await runAcceptsDottedContractNamesFromQwenFencedJson();
  await runRejectsUnofferedTool();
  await runRejectsInvalidArguments();
  console.log("model provider tool-call compatibility passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
