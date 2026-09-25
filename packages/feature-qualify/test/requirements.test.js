const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ModelProvider, RunStore, startAgentRun, ControlledToolProvider, ToolRegistry } = require("../../agent-runtime");
const { createWorkspaceHost } = require("../../coding-qualify/host");
const { REQUIREMENTS } = require("../acceptance");
const { executeControlled } = require("../../agent-tools");

class ScriptedModelProvider extends ModelProvider {
  constructor(steps) {
    super("scripted");
    this.steps = [...steps];
    this.calls = 0;
  }

  async complete(input) {
    this.calls += 1;
    const step = this.steps.shift();
    return { text: step.text || "", toolCalls: step.toolCalls || [] };
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
  await test("an unverified requirement blocks completion", async () => {
    const store = new RunStore(fs.mkdtempSync(path.join(os.tmpdir(), "codeme-feature-")));
    const provider = new ScriptedModelProvider([{ text: "done" }, { text: "done" }]);
    let checks = 0;
    const run = await startAgentRun({
      goal: "Add registration",
      model: "scripted",
      providerName: "scripted",
      mode: "controlled",
      requirements: REQUIREMENTS,
      provider,
      registry: new ToolRegistry(new ControlledToolProvider({ async readFile() { return { contents: "" }; } })),
      store,
      verify(runState) {
        checks += 1;
        if (checks > 1) {
          for (const item of runState.requirements) item.status = "satisfied";
        }
        return { status: "passed", summary: "claimed", evidence: [] };
      },
    }).done;
    assert.strictEqual(run.lifecycle, "completed");
    assert.strictEqual(provider.calls, 2);
    assert.strictEqual(run.verificationHistory[0].status, "failed");
    assert.ok(run.verificationHistory[0].summary.includes("registration-endpoint"));
    assert.ok(run.requirements.every((item) => item.status === "satisfied"));
  });

  await test("the fixture suite fails before the feature exists", async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-feature-app-"));
    const workspace = path.join(parent, "fixture");
    fs.cpSync(path.join(__dirname, "../fixture"), workspace, { recursive: true });
    const result = await executeControlled(createWorkspaceHost(workspace), "tests.run", { command: "npm test" });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, "exit_status");
    const host = { async writeFile() { throw new Error("wrote"); } };
    const escaped = await executeControlled(host, "file.write", { path: "../outside.txt", contents: "x" });
    assert.strictEqual(escaped.error.code, "path_escape");
  });

  if (process.exitCode) process.exit(process.exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
