const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ModelProvider, RunStore, startAgentRun, ToolRegistry, ControlledToolProvider } = require("../index.js");
const { buildModelContext } = require("../context-manager");

class ScriptedModelProvider extends ModelProvider {
  constructor(steps) {
    super("scripted");
    this.steps = [...steps];
    this.calls = [];
  }

  async complete(input) {
    this.calls.push(input);
    const step = this.steps.shift();
    if (!step) throw Object.assign(new Error("no scripted decision"), { code: "model_disconnected" });
    return { text: step.text || "", toolCalls: step.toolCalls || [] };
  }
}

function joined(call) {
  return (call.messages || []).map((message) => String(message.content || "")).join("\n");
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
  await test("a model turn is built from the goal, plan, ranges, and failures", async () => {
    const filler = "Z".repeat(9000);
    const messages = buildModelContext({
      goal: "Repair the greeting.",
      plan: [{ id: "inspect", title: "Inspect the repository", status: "in_progress" }],
      requirements: [],
      filesChanged: ["src/site.css"],
      verificationHistory: [{ status: "failed", summary: "The layout write is not complete until browser.check succeeds" }],
      diagnoses: [],
      messages: [
        { role: "system", content: "Use the workspace tools." },
        { role: "user", content: "Repair the greeting." },
        { role: "assistant", content: "UNIQUE-ASSISTANT-CHATTER" },
        { role: "user", content: "Workspace files: src/site.css." },
      ],
      toolCalls: [
        {
          name: "file.read",
          args: { path: "src/old.js" },
          result: { ok: true, tool: "file.read", data: { path: "src/old.js", contents: filler } },
        },
        {
          name: "file.readRange",
          args: { path: "src/site.css", startLine: 4, endLine: 6 },
          result: { ok: true, tool: "file.readRange", data: { path: "src/site.css", startLine: 4, endLine: 6, contents: "nav{background:#111;}\nbutton{border-radius:2px;}" } },
        },
        {
          name: "file.read",
          args: { path: "src/missing.js" },
          result: { ok: false, tool: "file.read", error: { code: "not_found", message: "File not found: src/missing.js" } },
        },
        {
          name: "browser.check",
          args: { url: "http://127.0.0.1:4173/" },
          result: {
            ok: true,
            tool: "browser.check",
            data: {
              text: "Bid now",
              consoleErrors: ["bid failed"],
              failedRequests: [{ url: "http://127.0.0.1:4173/missing.png", statusCode: 404 }],
              screenshot: { path: "/tmp/codeme-preview.png", bytes: 1200 },
            },
          },
        },
      ],
    });
    const text = messages.map((message) => String(message.content || "")).join("\n");
    assert.ok(text.includes("Goal: Repair the greeting."));
    assert.ok(text.includes("Inspect the repository"));
    assert.ok(text.includes("src/site.css lines 4-6"));
    assert.ok(text.includes("nav{background:#111;}"));
    assert.ok(text.includes("not_found"));
    assert.ok(text.includes("Bid now"));
    assert.ok(text.includes("bid failed"));
    assert.ok(text.includes("missing.png"));
    assert.ok(text.includes("/tmp/codeme-preview.png"));
    assert.ok(!text.includes('"bytes":1200'));
    assert.ok(text.includes("Workspace files:"));
    assert.ok(!text.includes("UNIQUE-ASSISTANT-CHATTER"));
    assert.ok(!text.includes("Z".repeat(8000)));
    const dumped = JSON.stringify({ ok: true, tool: "file.read", data: { path: "src/old.js", contents: filler } }).slice(0, 8000);
    assert.ok(!messages.some((message) => String(message.content || "") === dumped));
    assert.ok(messages.some((message) => message.role === "tool" && String(message.content).includes('"ok":false')));
  });

  await test("a live turn omits assistant chatter and the raw tool dump", async () => {
    const filler = "Z".repeat(9000);
    const provider = new ScriptedModelProvider([
      { text: "UNIQUE-ASSISTANT-CHATTER", toolCalls: [{ name: "file.read", args: { path: "big.js" } }] },
      { text: "Checking the missing file.", toolCalls: [{ name: "file.read", args: { path: "missing.js" } }] },
      { text: "The greeting is repaired." },
    ]);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-context-"));
    const run = await startAgentRun({
      goal: "Repair the greeting. The test is failing.",
      model: "scripted",
      providerName: "scripted",
      mode: "controlled",
      provider,
      registry: new ToolRegistry(new ControlledToolProvider({
        async readFile(filePath) {
          if (filePath === "big.js") return { path: filePath, contents: filler };
          throw Object.assign(new Error(`File not found: ${filePath}`), { code: "not_found" });
        },
        async writeFile(filePath, contents) { return { path: filePath, bytes: Buffer.byteLength(contents) }; },
        async listDirectory() { return { path: ".", entries: [{ path: "big.js", type: "file" }] }; },
        async search(query) { return { query, matches: [] }; },
        async runTerminal() { return { exitCode: 0, stdout: "", stderr: "" }; },
        async runTests() { return { exitCode: 0, stdout: "", stderr: "" }; },
        async diagnostics() { return { items: [] }; },
        async gitStatus() { return { porcelain: "", exitCode: 0 }; },
        async gitDiff() { return { diff: "", exitCode: 0 }; },
        async browserCheck(url) { return { url, available: true, statusCode: 200 }; },
        async createDirectory(dirPath) { return { path: dirPath }; },
      })),
      store: new RunStore(path.join(directory, "runs")),
      verify: (_run, text) => (
        String(text).includes("repaired")
          ? { status: "passed", summary: "the repair is recorded", evidence: ["file.read"] }
          : { status: "failed", summary: "still failing", evidence: [] }
      ),
    }).done;
    assert.strictEqual(run.lifecycle, "completed");
    const afterRead = joined(provider.calls[1]);
    const afterFailure = joined(provider.calls[2]);
    assert.ok(afterRead.includes("Goal: Repair the greeting."));
    assert.ok(afterRead.includes("Plan:"));
    assert.ok(afterRead.includes("Relevant ranges:"));
    assert.ok(!afterRead.includes("UNIQUE-ASSISTANT-CHATTER"));
    assert.ok(!afterRead.includes("Z".repeat(8000)));
    assert.ok(afterFailure.includes("Failures:"));
    assert.ok(afterFailure.includes("not_found"));
    assert.ok(provider.calls[2].messages.some((message) => message.role === "tool" && String(message.content).includes('"ok":false')));
    const stored = JSON.stringify(run.toolCalls.find((call) => call.args && call.args.path === "big.js").result).slice(0, 8000);
    assert.ok(!provider.calls[2].messages.some((message) => String(message.content || "").includes(stored.slice(0, 3000)) && String(message.content).includes("Z".repeat(8000))));
  });

  if (process.exitCode) process.exit(process.exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
