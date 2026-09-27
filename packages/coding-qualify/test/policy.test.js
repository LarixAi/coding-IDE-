const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { executeControlled, validateCommand, validateProcess } = require("../../agent-tools");
const { ModelProvider, ControlledToolProvider, ToolRegistry, RunStore, startAgentRun } = require("../../agent-runtime");
const { createWorkspaceHost } = require("../host");

const FIXTURE = path.join(__dirname, "../fixture");

class ScriptedModelProvider extends ModelProvider {
  constructor(steps) {
    super("scripted");
    this.steps = [...steps];
  }

  async complete(input) {
    if (input.signal && input.signal.aborted) {
      throw Object.assign(new Error("model call cancelled"), { code: "cancelled" });
    }
    const step = this.steps.shift();
    if (step && step.waitForAbort) {
      await new Promise((resolve, reject) => {
        const fail = () => reject(Object.assign(new Error("model call cancelled"), { code: "cancelled" }));
        if (input.signal && input.signal.aborted) return fail();
        input.signal.addEventListener("abort", fail);
      });
    }
    return { text: step && step.text || "", toolCalls: step && step.toolCalls || [] };
  }
}

function tempWorkspace() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-policy-"));
  const workspace = path.join(parent, "fixture");
  fs.cpSync(FIXTURE, workspace, { recursive: true });
  fs.writeFileSync(path.join(parent, "outside.txt"), "untouched");
  return { parent, workspace, outside: path.join(parent, "outside.txt") };
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
  await test("rejects shell syntax and paths outside the workspace", async () => {
    for (const command of ["npm test | cat", "npm test; touch outside.txt", "node ../outside.js", "node /tmp/outside.js", "bash -c npm test", "node -e process.exit(0)"]) {
      const error = validateCommand(command);
      assert.ok(error, command);
    }
    assert.strictEqual(validateCommand("npm test"), null);
    assert.strictEqual(validateCommand("node test/greet.test.js"), null);
    assert.strictEqual(validateCommand("node --check src/greet.js"), null);

    const { workspace, outside } = tempWorkspace();
    let spawned = false;
    const host = {
      async runTerminal() {
        spawned = true;
      },
      async runTests() {
        spawned = true;
      },
      async writeFile() {
        spawned = true;
      },
    };
    const piped = await executeControlled(host, "terminal.run", { command: "npm test | cat" });
    assert.strictEqual(piped.ok, false);
    assert.strictEqual(piped.error.code, "command_rejected");
    const escaped = await executeControlled(host, "file.write", { path: "../outside.txt", contents: "changed" });
    assert.strictEqual(escaped.ok, false);
    assert.strictEqual(escaped.error.code, "path_escape");
    assert.strictEqual(spawned, false);
    assert.strictEqual(fs.readFileSync(outside, "utf8"), "untouched");

    fs.symlinkSync(path.dirname(workspace), path.join(workspace, "link"));
    const linked = await executeControlled(createWorkspaceHost(workspace), "file.write", { path: "link/pwned.txt", contents: "changed" });
    assert.strictEqual(linked.ok, false);
    assert.strictEqual(linked.error.code, "path_escape");
    assert.strictEqual(fs.existsSync(path.join(path.dirname(workspace), "pwned.txt")), false);
    const mkdir = await executeControlled(createWorkspaceHost(workspace), "dir.create", { path: "../outside" });
    assert.strictEqual(mkdir.ok, false);
    assert.strictEqual(mkdir.error.code, "path_escape");
    const created = await executeControlled(createWorkspaceHost(workspace), "dir.create", { path: "website test 2" });
    assert.strictEqual(created.ok, true);
    assert.ok(fs.statSync(path.join(workspace, "website test 2")).isDirectory());
    const escapedList = await executeControlled(createWorkspaceHost(workspace), "dir.list", { path: "../outside" });
    assert.strictEqual(escapedList.ok, false);
    assert.strictEqual(escapedList.error.code, "path_escape");
    const listed = await executeControlled(createWorkspaceHost(workspace), "dir.list", { path: "." });
    assert.strictEqual(listed.ok, true);
    assert.ok(listed.data.entries.some((entry) => entry.path === "package.json" && entry.type === "file"));
  });

  await test("the fixture test fails before any edit", async () => {
    const { workspace, outside } = tempWorkspace();
    const host = createWorkspaceHost(workspace);
    const result = await executeControlled(host, "tests.run", { command: "npm test" });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, "exit_status");
    assert.ok(`${result.data.stdout}\n${result.data.stderr}`.includes("Hello, Ada"));
    assert.strictEqual(fs.readFileSync(outside, "utf8"), "untouched");
    assert.strictEqual(fs.readFileSync(path.join(workspace, "src/greet.js"), "utf8").includes('return "Hi"'), true);
  });

  await test("controlled mode still stops at the iteration limit and on cancel", async () => {
    const { workspace } = tempWorkspace();
    const store = new RunStore(fs.mkdtempSync(path.join(os.tmpdir(), "codeme-policy-runs-")));
    const registry = new ToolRegistry(new ControlledToolProvider(createWorkspaceHost(workspace)));
    const limited = await startAgentRun({
      goal: "search forever",
      model: "scripted",
      providerName: "scripted",
      mode: "controlled",
      provider: new ScriptedModelProvider(["package.json", "README.md", "src/greet.js"].map((file) => ({ toolCalls: [{ name: "file.read", args: { path: file } }] }))),
      registry,
      store,
      maxIterations: 3,
      maxIdenticalActions: 10,
      maxRetries: 10,
    }).done;
    assert.strictEqual(limited.outcome.reason, "iteration_limit");
    assert.strictEqual(limited.filesChanged.length, 0);

    const cancelling = startAgentRun({
      goal: "wait",
      model: "scripted",
      providerName: "scripted",
      mode: "controlled",
      provider: new ScriptedModelProvider([{ waitForAbort: true }]),
      registry,
      store,
    });
    cancelling.cancel();
    const cancelled = await cancelling.done;
    assert.strictEqual(cancelled.lifecycle, "cancelled");
    assert.strictEqual(cancelled.toolCalls.length, 0);
  });

  await test("filesChanged records paths from the git diff", async () => {
    const store = new RunStore(fs.mkdtempSync(path.join(os.tmpdir(), "codeme-policy-runs-")));
    const host = {
      async gitDiff() {
        return { diff: "diff --git a/src/greet.js b/src/greet.js\n+return \"Hello, Ada\";\n" };
      },
    };
    const run = await startAgentRun({
      goal: "show the diff",
      model: "scripted",
      providerName: "scripted",
      mode: "controlled",
      provider: new ScriptedModelProvider([{ toolCalls: [{ name: "git.diff", args: {} }] }, { text: "diff seen" }]),
      registry: new ToolRegistry(new ControlledToolProvider(host)),
      store,
      verify(runState, text) {
        if (runState.filesChanged.includes("src/greet.js") && text.includes("diff seen")) {
          return { status: "passed", summary: "diff recorded", evidence: ["git.diff"] };
        }
        return { status: "failed", summary: "diff was not recorded", evidence: [] };
      },
    }).done;
    assert.strictEqual(run.lifecycle, "completed");
    assert.deepStrictEqual(run.filesChanged, ["src/greet.js"]);
    assert.ok(run.transitions.some((item) => item.to === "executing_tool"));
    assert.ok(run.decisions.length >= 2);
  });

  await test("read-only grants stay closed and the capability hub stays empty", async () => {
    const { ReadOnlyToolProvider, ExternalCapabilityProvider } = require("../../agent-runtime");
    const readOnly = new ToolRegistry(new ReadOnlyToolProvider({})).definitions().map((tool) => tool.name);
    const controlled = new ToolRegistry(new ControlledToolProvider({})).definitions().map((tool) => tool.name);
    assert.ok(!readOnly.includes("file.write"));
    assert.ok(!readOnly.includes("dir.create"));
    assert.ok(readOnly.includes("dir.list"));
    assert.ok(readOnly.includes("file.readRange"));
    assert.ok(!readOnly.includes("file.patch"));
    assert.ok(controlled.includes("file.write"));
    assert.ok(controlled.includes("file.patch"));
    assert.ok(controlled.includes("dir.list"));
    assert.ok(controlled.includes("dir.create"));
    assert.ok(controlled.includes("tests.run"));
    assert.ok(controlled.includes("browser.check"));
    assert.ok(controlled.includes("process.run"));
    assert.ok(!readOnly.includes("process.run"));
    const hub = new ExternalCapabilityProvider();
    assert.deepStrictEqual(await hub.listCapabilities(), []);
    assert.strictEqual((await hub.invoke("workflow.run")).error.code, "capability_unavailable");
    const source = fs.readFileSync(path.join(__dirname, "../../agent-runtime/capability.js"), "utf8");
    assert.strictEqual(source.includes("n8n"), false);
  });

  await test("process.run npm test succeeds and a dev server can be stopped", async () => {
    assert.strictEqual(validateProcess({ executable: "npm", args: ["run", "build"] }), null);
    const { parent, workspace } = tempWorkspace();
    fs.writeFileSync(path.join(workspace, "src/greet.js"), "function greet(name) {\n  return `Hello, ${name}`;\n}\n\nmodule.exports = { greet };\n");
    fs.writeFileSync(path.join(workspace, "hold.js"), "setInterval(() => {}, 1000);\n");
    const host = createWorkspaceHost(workspace);
    const tested = await executeControlled(host, "process.run", { executable: "npm", args: ["test"] });
    assert.strictEqual(tested.ok, true);
    assert.strictEqual(tested.data.exitCode, 0);
    const piped = await executeControlled(host, "process.run", { executable: "npm", args: ["test", "|", "cat"] });
    assert.strictEqual(piped.ok, false);
    assert.strictEqual(piped.error.code, "command_rejected");
    const escaped = await executeControlled(host, "process.run", { executable: "node", args: ["../outside.js"] });
    assert.strictEqual(escaped.ok, false);
    assert.strictEqual(escaped.error.code, "path_escape");
    const started = await executeControlled(host, "process.start", { executable: "node", args: ["hold.js"] });
    assert.strictEqual(started.ok, true);
    const status = await executeControlled(host, "process.status", { id: started.data.id });
    assert.strictEqual(status.data.running, true);
    const stopped = await executeControlled(host, "process.stop", { id: started.data.id });
    assert.strictEqual(stopped.ok, true);
    const foreign = await executeControlled(host, "process.stop", { id: "proc_missing" });
    assert.strictEqual(foreign.ok, false);
    fs.rmSync(parent, { recursive: true, force: true });
  });

  await test("a patch changes only the named CSS rules in a large file", async () => {
    const { parent, workspace } = tempWorkspace();
    const nav = "nav{background:#111111;}";
    const button = "button{border-radius:2px;}";
    const filler = `/* ${"pad ".repeat(40)} */\n`.repeat(400);
    const css = `${nav}\n${filler}${button}\n`;
    assert.ok(Buffer.byteLength(css) > 25 * 1024);
    fs.writeFileSync(path.join(workspace, "site.css"), css);
    const host = createWorkspaceHost(workspace);
    const before = fs.readFileSync(path.join(workspace, "site.css"));
    const range = await executeControlled(host, "file.readRange", { path: "site.css", startLine: 1, endLine: 1 });
    assert.strictEqual(range.ok, true);
    assert.strictEqual(range.data.contents, nav);
    const navPatch = await executeControlled(host, "file.patch", {
      path: "site.css",
      expected: nav,
      replacement: "nav{background:#0a3d2e;}",
    });
    assert.strictEqual(navPatch.ok, true);
    const buttonPatch = await executeControlled(host, "file.patch", {
      path: "site.css",
      expected: button,
      replacement: "button{border-radius:8px;}",
    });
    assert.strictEqual(buttonPatch.ok, true);
    const after = fs.readFileSync(path.join(workspace, "site.css"));
    const restored = Buffer.from(after.toString("utf8").replace("nav{background:#0a3d2e;}", nav).replace("button{border-radius:8px;}", button));
    assert.deepStrictEqual(restored, before);
    const stale = await executeControlled(host, "file.patch", {
      path: "site.css",
      expected: nav,
      replacement: "nav{background:#ffffff;}",
    });
    assert.strictEqual(stale.ok, false);
    assert.strictEqual(stale.error.code, "conflict");
    assert.deepStrictEqual(fs.readFileSync(path.join(workspace, "site.css")), after);
    fs.rmSync(parent, { recursive: true, force: true });
  });

  if (process.exitCode) process.exit(process.exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
