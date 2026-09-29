const assert = require("assert");
const http = require("http");
const { ComposerSession, listOllamaModels } = require("../composer-session");

async function withOllama(models, fn) {
  const server = http.createServer((req, res) => {
    if (req.url !== "/api/tags") {
      res.statusCode = 404;
      res.end("{}");
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      models: models.map((name) => ({ name })),
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  await withOllama([
    "qwen2.5-coder:14b",
    "qwen3.5:9b",
    "deepseek-coder-v2:16b",
  ], async (url) => {
    const models = await listOllamaModels(url, "ollama-server", "Server", { strict: true });
    assert.deepStrictEqual(
      models.map((item) => item.id),
      ["qwen2.5-coder:14b", "qwen3.5:9b", "deepseek-coder-v2:16b"],
    );
    assert.ok(models.every((item) => item.provider === "ollama-server"));
    assert.ok(models.every((item) => item.source === "Server"));
    assert.ok(models.every((item) => item.label.startsWith("Server · ")));
  });

  const selection = {
    value: { provider: "ollama-server", id: "qwen2.5-coder:14b" },
  };
  let round = 0;
  const responses = [
    {
      models: [
        { provider: "ollama-local", id: "qwen3.5:9b", source: "Local", label: "Local · Qwen 3.5 9B" },
        { provider: "ollama-server", id: "qwen2.5-coder:14b", source: "Server", label: "Server · Qwen 2.5 Coder 14B" },
        { provider: "ollama-server", id: "deepseek-coder-v2:16b", source: "Server", label: "Server · Deepseek Coder V 2 16B" },
      ],
      sources: [
        { id: "local", label: "Local", configured: true, available: true, count: 1, message: "1 model" },
        { id: "server", label: "Server", configured: true, available: true, count: 2, message: "2 models" },
      ],
    },
    {
      models: [
        { provider: "ollama-local", id: "qwen3.5:9b", source: "Local", label: "Local · Qwen 3.5 9B" },
      ],
      sources: [
        { id: "local", label: "Local", configured: true, available: true, count: 1, message: "1 model" },
        { id: "server", label: "Server", configured: true, available: false, count: 0, message: "connection refused" },
      ],
    },
    {
      models: [
        { provider: "ollama-local", id: "qwen3.5:9b", source: "Local", label: "Local · Qwen 3.5 9B" },
        { provider: "ollama-server", id: "qwen2.5-coder:14b", source: "Server", label: "Server · Qwen 2.5 Coder 14B" },
      ],
      sources: [
        { id: "local", label: "Local", configured: true, available: true, count: 1, message: "1 model" },
        { id: "server", label: "Server", configured: true, available: true, count: 1, message: "1 model" },
      ],
    },
  ];

  const session = new ComposerSession({
    store: {},
    selectionStore: {
      get: () => selection.value,
      set: (value) => { selection.value = value; },
    },
    listModels: async () => responses[Math.min(round++, responses.length - 1)],
    createProvider: () => null,
    createRegistry: () => null,
    root: "/tmp/codeme-model-selection",
    onChange: () => {},
  });

  await session.refreshModels();
  assert.strictEqual(session.models.length, 3);
  assert.strictEqual(session.selected.provider, "ollama-server");
  assert.strictEqual(session.selected.id, "qwen2.5-coder:14b");
  assert.strictEqual(session.modelSources.find((item) => item.id === "server").count, 2);

  await session.refreshModels();
  assert.strictEqual(session.selected.provider, "ollama-local");
  assert.strictEqual(session.modelSources.find((item) => item.id === "server").available, false);
  assert.deepStrictEqual(
    selection.value,
    { provider: "ollama-server", id: "qwen2.5-coder:14b" },
    "temporary server failure must not overwrite saved Server preference",
  );

  await session.refreshModels();
  assert.strictEqual(session.selected.provider, "ollama-server");
  assert.strictEqual(session.selected.id, "qwen2.5-coder:14b");

  console.log("ok local and server Ollama model selection");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
