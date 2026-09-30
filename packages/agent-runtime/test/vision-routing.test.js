const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeImageAttachments, pickVisionModel } = require("../vision");
const { buildModelContext } = require("../pipeline-context");

test("vision routing selects an installed VL model and sends real image bytes", async () => {
  const calls = [];
  const provider = {
    async listModels() {
      return [
        { id: "qwen3.5:9b" },
        { id: "qwen2.5vl:7b" },
      ];
    },
    async completeVision(input) {
      calls.push(input);
      return {
        text: JSON.stringify({
          kind: "website",
          summary: "Dashboard screenshot",
          layout: "Sidebar with main content",
          visualHierarchy: "Large heading above cards",
          sections: ["sidebar", "header", "cards"],
          palette: ["#111111", "#ffffff"],
          typography: "Sans serif",
          spacing: "Consistent medium gaps",
          components: ["navigation", "card"],
          implementationNotes: ["Use a two-column shell"],
          textContent: ["Dashboard"],
          detectedUrl: null,
        }),
      };
    },
  };

  const result = await analyzeImageAttachments({
    provider,
    goal: "Make the page look like this screenshot",
    attachments: [{ kind: "image", path: ".codeme/inbox/shot.png", name: "shot.png", type: "image/png" }],
    readAttachment: async () => Buffer.from("hello"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.model, "qwen2.5vl:7b");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].images, ["aGVsbG8="]);
  assert.equal(result.spec.textContent[0], "Dashboard");
  assert.match(calls[0].prompt, /Make the page look like this screenshot/);
});

test("vision routing auto-detects another installed vision model", () => {
  const selected = pickVisionModel([
    { id: "qwen3.5:9b" },
    { id: "minicpm-v:8b" },
  ], "qwen2.5vl:7b");
  assert.equal(selected, "minicpm-v:8b");
});

test("vision routing fails explicitly when no vision model is installed", async () => {
  const result = await analyzeImageAttachments({
    provider: {
      async listModels() { return [{ id: "qwen3.5:9b" }]; },
      async completeVision() { throw new Error("must not be called"); },
    },
    goal: "Read this screenshot",
    attachments: [{ kind: "image", path: "shot.png", name: "shot.png", type: "image/png" }],
    readAttachment: async () => Buffer.from("hello"),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "vision_model_missing");
  assert.match(result.notice, /No vision model is installed/i);
});

test("visual and n8n evidence become bounded model context", () => {
  const context = buildModelContext({
    goal: "Implement this design",
    system: "system",
    visualContext: JSON.stringify({ summary: "Screenshot layout", textContent: ["Hello"] }),
    externalEvidence: "UNTRUSTED EXTERNAL EVIDENCE\nUse CSS grid for this layout.",
    tools: [],
  });
  const system = context.messages[0].content;
  assert.match(system, /Visual analysis from attached images/);
  assert.match(system, /Screenshot layout/);
  assert.match(system, /n8n visual assist/);
  assert.match(system, /UNTRUSTED EXTERNAL EVIDENCE/);
});
