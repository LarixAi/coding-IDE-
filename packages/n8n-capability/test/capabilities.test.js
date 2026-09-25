const assert = require("assert");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { researchProblem } = require("../capabilities/research");
const { lookupKnowledge } = require("../capabilities/knowledge");
const { decomposeGoal } = require("../capabilities/decompose");
const { N8nCapabilityProvider, ROUTES } = require("../index.js");

function body(capability, input) {
  return { protocolVersion: 1, requestId: "req_test", capability, input, context: {}, timeout: 10000 };
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
  await test("research returns excerpts and does not invent a fix", async () => {
    const calls = [];
    const httpRequest = async (options) => {
      calls.push(options.url);
      if (options.url.includes("duckduckgo")) {
        return { Heading: "Webhook signatures", AbstractText: "Compare the signature header.", AbstractURL: "https://docs.example.com/webhooks", RelatedTopics: [] };
      }
      if (options.url.includes("api.github.com")) {
        return { items: [{ title: "Signature mismatch", html_url: "https://github.com/example/repo/issues/4", body: "The timestamp drifted." }] };
      }
      if (options.url.includes("stackoverflow")) {
        return { items: [{ title: "Verify the header", link: "https://stackoverflow.com/questions/1" }] };
      }
      throw new Error(`unexpected url ${options.url}`);
    };
    const result = await researchProblem(body("research.problem", { problem: "Stripe webhook signature verification failing" }), httpRequest);
    assert.strictEqual(result.status, "ok");
    assert.strictEqual(result.data.likely_cause, null);
    assert.strictEqual(result.data.recommended_fix, null);
    assert.strictEqual(result.data.confidence, "medium");
    assert.strictEqual(result.data.evidence.length, 3);
    assert.ok(calls.every((url) => url.startsWith("https://api.duckduckgo.com/") || url.startsWith("https://api.github.com/") || url.startsWith("https://api.stackexchange.com/")));
  });

  await test("a failed source becomes a warning instead of a fabricated cause", async () => {
    const result = await researchProblem(body("research.problem", { problem: "missing docs" }), async () => {
      throw new Error("offline");
    });
    assert.strictEqual(result.status, "ok");
    assert.deepStrictEqual(result.data.evidence, []);
    assert.strictEqual(result.data.confidence, "low");
    assert.ok(result.warnings.some((warning) => warning.includes("offline")));
  });

  await test("knowledge lookup finds a seeded note and remember stays in the store", async () => {
    const store = { entries: [] };
    const found = lookupKnowledge(body("knowledge.lookup", { query: "who edits workspace files" }), store);
    assert.strictEqual(found.status, "ok");
    assert.ok(found.data.matches.some((entry) => entry.title === "CodeMe owns local files"));
    const saved = lookupKnowledge(body("knowledge.lookup", { action: "remember", entry: { title: "Retry note", text: "The second test failure needed a null check.", tags: ["tests"] } }), store);
    assert.strictEqual(saved.status, "ok");
    const again = lookupKnowledge(body("knowledge.lookup", { query: "null check" }), store);
    assert.ok(again.data.matches.some((entry) => entry.title === "Retry note"));
  });

  await test("decompose keeps a valid graph and rejects a non-plan", async () => {
    const goal = "Build a page that lists cars, accepts a bid, and lets an admin remove a listing.";
    const good = await decomposeGoal(body("task.decompose", { goal }), async () => ({
      message: {
        content: JSON.stringify({
          project: "Listings",
          tasks: [
            { id: "01", title: "List cars", dependsOn: [], objective: "Show the cars", doneWhen: "The list renders" },
            { id: "02", title: "Accept a bid", dependsOn: ["01", "99"], objective: "Store one bid", doneWhen: "A bid is saved" },
          ],
        }),
      },
    }));
    assert.strictEqual(good.status, "ok");
    assert.deepStrictEqual(good.data.tasks[1].dependsOn, ["01"]);
    const bad = await decomposeGoal(body("task.decompose", { goal }), async () => ({ message: { content: "I would start by writing the app." } }));
    assert.strictEqual(bad.status, "error");
    assert.strictEqual(bad.error.code, "invalid_plan");
    assert.strictEqual(bad.data, null);
  });

  await test("discovery exposes only routed capabilities", async () => {
    assert.deepStrictEqual(Object.keys(ROUTES).sort(), ["hub.health", "knowledge.lookup", "research.problem", "task.decompose"]);
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        protocolVersion: 1,
        requestId: request.requestId,
        status: "ok",
        data: {
          capabilities: [
            ...Object.keys(ROUTES).map((name) => ({ name, description: name })),
            { name: "review.code", description: "reserved but not routed" },
          ],
        },
        sources: [],
        warnings: [],
        error: null,
        duration: 1,
      }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const hub = new N8nCapabilityProvider({ baseUrl: `http://127.0.0.1:${server.address().port}`, retries: 0 });
      const listed = await hub.listCapabilities();
      assert.deepStrictEqual(listed.map((item) => item.name).sort(), Object.keys(ROUTES).sort());
      assert.ok(!listed.some((item) => item.name === "review.code"));
    } finally {
      server.close();
    }
  });

  await test("published workflows contain the capability handlers", async () => {
    const research = JSON.parse(fs.readFileSync(path.join(__dirname, "../workflows/research-problem.json"), "utf8"));
    const knowledge = JSON.parse(fs.readFileSync(path.join(__dirname, "../workflows/knowledge-lookup.json"), "utf8"));
    const decompose = JSON.parse(fs.readFileSync(path.join(__dirname, "../workflows/task-decompose.json"), "utf8"));
    const discovery = JSON.parse(fs.readFileSync(path.join(__dirname, "../workflows/capabilities.json"), "utf8"));
    const code = (workflow) => workflow.nodes.find((node) => node.type === "n8n-nodes-base.code").parameters.jsCode;
    assert.ok(code(research).includes("research.problem"));
    assert.ok(code(research).includes("api.duckduckgo.com"));
    assert.ok(!code(research).includes("writeFile"));
    assert.ok(code(knowledge).includes("knowledge.lookup"));
    assert.ok(code(decompose).includes("task.decompose"));
    assert.ok(code(decompose).includes("host.docker.internal:11434"));
    assert.ok(code(discovery).includes("research.problem"));
    assert.ok(code(discovery).includes("task.decompose"));
  });

  if (process.exitCode) process.exit(process.exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
