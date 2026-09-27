const assert = require("assert");
const path = require("path");
const { handleWelcomeAction } = require("../welcome-actions");
const { renderWelcome } = require("../welcome");

function uri(value) {
  return { fsPath: value, path: value, toString: () => `file://${value}` };
}

function mockVscode(options = {}) {
  const events = [];
  const files = new Map();
  const directories = new Set();
  const messages = [];
  const vscode = {
    Uri: {
      joinPath(base, ...parts) {
        return uri(path.join(base.fsPath, ...parts));
      },
    },
    window: {
      async showInputBox() { return options.name; },
      async showOpenDialog() { return options.parent === undefined ? undefined : [uri(options.parent)]; },
      async showErrorMessage(message) { messages.push(["error", message]); },
      async showInformationMessage(message) { messages.push(["info", message]); },
    },
    workspace: {
      fs: {
        async stat(target) {
          if (directories.has(target.fsPath) || files.has(target.fsPath)) return { type: 2 };
          const error = new Error(`not found: ${target.fsPath}`);
          error.code = "FileNotFound";
          throw error;
        },
        async createDirectory(target) {
          events.push(["mkdir", target.fsPath]);
          directories.add(target.fsPath);
        },
        async writeFile(target, bytes) {
          events.push(["write", target.fsPath]);
          files.set(target.fsPath, Buffer.from(bytes).toString("utf8"));
        },
      },
    },
    commands: {
      async executeCommand(command, target) {
        events.push(["command", command, target && target.fsPath]);
        if (options.commandError && command === options.commandError) throw new Error("command failed");
      },
    },
  };
  return { vscode, events, files, messages };
}

async function main() {
  const html = renderWelcome({ detail: "Qwen 3.5 9B is selected." }, "abc");
  assert.ok(html.includes(">Code Me<"));
  assert.ok(html.includes("data-action=\"open\""));
  assert.ok(html.includes("data-action=\"create\""));
  assert.ok(html.includes("data-action=\"clone\""));
  assert.ok(html.includes("data-action=\"connect\""));
  assert.ok(html.includes("Qwen 3.5 9B is selected."));
  assert.ok(html.includes("welcome-done"));
  assert.ok(html.includes("Opening folder…"));
  assert.ok(html.includes("Choosing project folder…"));
  assert.ok(html.includes("README.md and .gitignore"));
  assert.ok(!html.includes("GitHub Copilot"));

  assert.deepStrictEqual(await handleWelcomeAction({}, "ready"), { ok: true, action: "ready" });
  assert.strictEqual((await handleWelcomeAction(null, "open")).code, "vscode_unavailable");

  const open = mockVscode({ parent: "/work/app" });
  const opened = await handleWelcomeAction(open.vscode, "open");
  assert.strictEqual(opened.ok, true);
  assert.strictEqual(opened.root, "/work/app");
  assert.deepStrictEqual(open.events, [["command", "vscode.openFolder", "/work/app"]]);

  const create = mockVscode({ parent: "/work/shop" });
  const created = await handleWelcomeAction(create.vscode, "create");
  assert.strictEqual(created.ok, true);
  assert.strictEqual(created.root, "/work/shop");
  assert.strictEqual(created.name, "shop");
  assert.deepStrictEqual(created.created, ["README.md", ".gitignore"]);
  assert.strictEqual(create.files.get(path.join("/work", "shop", "README.md")), "# shop\n");
  assert.deepStrictEqual(create.events[create.events.length - 1], ["command", "vscode.openFolder", "/work/shop"]);

  const cancel = mockVscode({ parent: undefined });
  assert.deepStrictEqual(await handleWelcomeAction(cancel.vscode, "open"), { ok: false, cancelled: true, stage: "location" });

  const busy = { current: "create" };
  const locked = await handleWelcomeAction(open.vscode, "open", { busy });
  assert.strictEqual(locked.code, "busy");
  assert.strictEqual(busy.current, "create");

  const gate = { current: "" };
  const first = handleWelcomeAction(mockVscode({ parent: "/work/one" }).vscode, "create", { busy: gate });
  const second = await handleWelcomeAction(open.vscode, "open", { busy: gate });
  assert.strictEqual(second.code, "busy");
  const finished = await first;
  assert.strictEqual(finished.ok, true);
  assert.strictEqual(gate.current, "");

  const clone = mockVscode();
  assert.deepStrictEqual(await handleWelcomeAction(clone.vscode, "clone"), { ok: true, action: "clone" });
  assert.deepStrictEqual(clone.events, [["command", "git.clone", undefined]]);

  const cloneFail = mockVscode({ commandError: "git.clone" });
  const cloned = await handleWelcomeAction(cloneFail.vscode, "clone");
  assert.strictEqual(cloned.code, "clone_failed");
  assert.strictEqual(cloneFail.messages[0][0], "error");

  const connect = mockVscode();
  const connected = await handleWelcomeAction(connect.vscode, "connect", { detail: "A local model is selected." });
  assert.deepStrictEqual(connected, { ok: true, action: "connect" });
  assert.deepStrictEqual(connect.messages, [["info", "A local model is selected."]]);

  assert.strictEqual((await handleWelcomeAction(open.vscode, "nope")).code, "unknown_action");

  console.log("ok welcome actions");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
