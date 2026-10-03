const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  analyzeImages,
  normalizeVisionSpec,
  formatVisionSpec,
  safeAttachmentPath,
} = require("../vision-integration");

async function main() {
  const normalized = normalizeVisionSpec({
    kind: "website",
    summary: "Dealer page",
    layout: "Hero and stock grid",
    visualHierarchy: "Headline dominant",
    sections: ["hero", "inventory"],
    palette: ["#111111", "#ffffff"],
    typography: "Serif headings",
    spacing: "8px grid",
    components: ["navbar", "vehicle card"],
    textContent: ["Premium Used Cars"],
    implementationNotes: ["sticky nav"],
    detectedUrl: "https://dealer.example",
  });
  assert.strictEqual(normalized.kind, "website");
  assert.strictEqual(normalized.visualHierarchy, "Headline dominant");
  assert.deepStrictEqual(normalized.textContent, ["Premium Used Cars"]);
  assert.match(formatVisionSpec(normalized), /detectedUrl/);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-vision-"));
  fs.writeFileSync(path.join(root, "shot.png"), Buffer.from("fake-image"));
  assert.strictEqual(safeAttachmentPath(root, "shot.png"), path.join(root, "shot.png"));
  assert.throws(() => safeAttachmentPath(root, "../outside.png"), /escaped/);

  const originalFetch = global.fetch;
  const oldLocal = process.env.CODEME_LOCAL_OLLAMA_URL;
  const oldServer = process.env.CODEME_SERVER_OLLAMA_URL;
  process.env.CODEME_LOCAL_OLLAMA_URL = "http://127.0.0.1:11434";
  delete process.env.CODEME_SERVER_OLLAMA_URL;

  const calls = [];
  global.fetch = async (url, init = {}) => {
    const target = new URL(String(url));
    calls.push({ path: target.pathname, init });
    if (target.pathname === "/api/tags") {
      return new Response(JSON.stringify({ models: [{ name: "qwen2.5vl:7b" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (target.pathname === "/api/chat") {
      const body = JSON.parse(String(init.body || "{}"));
      assert.strictEqual(body.model, "qwen2.5vl:7b");
      assert.strictEqual(body.think, false);
      assert.ok(Array.isArray(body.messages[0].images));
      assert.strictEqual(body.messages[0].images.length, 1);
      return new Response(JSON.stringify({
        message: {
          content: JSON.stringify({
            kind: "website",
            summary: "Dealer screenshot",
            layout: "Hero then inventory",
            visualHierarchy: "Hero title first",
            sections: ["hero", "inventory"],
            palette: ["black", "white"],
            typography: "serif",
            spacing: "generous",
            components: ["nav", "card"],
            textContent: ["Browse vehicles"],
            errors: [],
            implementationNotes: ["responsive grid"],
            detectedUrl: "https://dealer.example",
          }),
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const result = await analyzeImages(
      root,
      [{ kind: "image", path: "shot.png", name: "shot.png", type: "image/png" }],
      "Rebuild this page",
    );
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.model, "qwen2.5vl:7b");
    assert.strictEqual(result.imageCount, 1);
    assert.strictEqual(result.spec.visualHierarchy, "Hero title first");
    assert.deepStrictEqual(result.spec.textContent, ["Browse vehicles"]);
    assert.strictEqual(result.spec.detectedUrl, "https://dealer.example");
    assert.ok(calls.some((call) => call.path === "/api/chat"));
  } finally {
    global.fetch = originalFetch;
    if (oldLocal === undefined) delete process.env.CODEME_LOCAL_OLLAMA_URL;
    else process.env.CODEME_LOCAL_OLLAMA_URL = oldLocal;
    if (oldServer === undefined) delete process.env.CODEME_SERVER_OLLAMA_URL;
    else process.env.CODEME_SERVER_OLLAMA_URL = oldServer;
  }

  console.log("ok local vision routing produces enriched coder evidence");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
