const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { validateProjectName, createProject, openFolder } = require("../project-manager");

function uri(value) {
  return { fsPath: value, path: value, toString: () => `file://${value}` };
}

function mockVscode(options = {}) {
  const events = [];
  const errors = [];
  const calls = [];
  const files = new Map(Object.entries(options.files || {}));
  const vscode = {
    Uri: {
      joinPath(base, ...parts) {
        return uri(path.join(base.fsPath, ...parts));
      },
    },
    window: {
      async showOpenDialog(opts) {
        calls.push(["showOpenDialog", opts]);
        return options.parent === undefined ? undefined : [uri(options.parent)];
      },
      async showErrorMessage(message) { errors.push(message); },
    },
    workspace: {
      fs: {
        async stat(target) {
          if (files.has(target.fsPath)) return { type: 1 };
          const error = new Error(`not found: ${target.fsPath}`);
          error.code = "FileNotFound";
          throw error;
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
        if (options.openError) throw new Error(options.openError);
      },
    },
  };
  return { vscode, events, errors, calls, files };
}

async function main() {
  for (const bad of ["", "   ", ".", "..", "foo/bar", "foo\\bar", "bad:name", "bad?name", "bad."]) {
    assert.strictEqual(validateProjectName(bad).ok, false, bad);
  }
  assert.deepStrictEqual(validateProjectName(" car-market "), { ok: true, name: "car-market" });
  assert.strictEqual(validateProjectName(".").message, "Project name cannot be '.' or '..'.");

  const missing = await createProject();
  assert.strictEqual(missing.code, "vscode_unavailable");
  assert.strictEqual((await openFolder(null)).code, "vscode_unavailable");

  const success = mockVscode({ parent: "/projects/car-market" });
  const result = await createProject(success.vscode);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.root, "/projects/car-market");
  assert.strictEqual(result.name, "car-market");
  assert.strictEqual(result.state, "workspace_opening");
  assert.deepStrictEqual(result.created, ["README.md", ".gitignore"]);
  assert.strictEqual(success.files.get(path.join("/projects", "car-market", "README.md")), "# car-market\n");
  assert.strictEqual(success.files.get(path.join("/projects", "car-market", ".gitignore")), "node_modules/\n.DS_Store\n");
  assert.deepStrictEqual(success.events, [
    ["write", path.join("/projects", "car-market", "README.md")],
    ["write", path.join("/projects", "car-market", ".gitignore")],
    ["command", "vscode.openFolder", "/projects/car-market"],
  ]);
  const createDialog = success.calls.find((call) => call[0] === "showOpenDialog")[1];
  assert.strictEqual(createDialog.title, "Create Project");
  assert.strictEqual(createDialog.openLabel, "Open Project");
  assert.strictEqual(createDialog.canSelectFolders, true);
  assert.strictEqual(createDialog.canSelectFiles, false);

  const opened = mockVscode({ parent: "/projects/existing" });
  const openResult = await openFolder(opened.vscode);
  assert.strictEqual(openResult.ok, true);
  assert.strictEqual(openResult.state, "workspace_opening");
  assert.strictEqual(openResult.root, "/projects/existing");
  assert.deepStrictEqual(opened.events, [["command", "vscode.openFolder", "/projects/existing"]]);
  const openDialog = opened.calls.find((call) => call[0] === "showOpenDialog")[1];
  assert.strictEqual(openDialog.title, "Open Folder");
  assert.strictEqual(openDialog.openLabel, "Open");

  const cancelOpen = mockVscode({ parent: undefined });
  assert.deepStrictEqual(await openFolder(cancelOpen.vscode), { ok: false, cancelled: true, stage: "location" });
  assert.strictEqual(cancelOpen.events.length, 0);
  assert.deepStrictEqual(await createProject(cancelOpen.vscode), { ok: false, cancelled: true, stage: "location" });

  const openFailed = mockVscode({ parent: "/projects/existing", openError: "window failed" });
  const failedOpen = await openFolder(openFailed.vscode);
  assert.strictEqual(failedOpen.code, "open_failed");
  assert.strictEqual(failedOpen.message, "window failed");
  assert.strictEqual(openFailed.errors.length, 1);

  const createOpenFailed = mockVscode({ parent: "/projects/site", openError: "could not switch" });
  const created = await createProject(createOpenFailed.vscode);
  assert.strictEqual(created.code, "open_failed");
  assert.strictEqual(created.message, "could not switch");
  assert.ok(createOpenFailed.files.has(path.join("/projects", "site", "README.md")));

  const existingReadme = path.join("/projects", "kept", "README.md");
  const kept = mockVscode({
    parent: "/projects/kept",
    files: { [existingReadme]: "# already here\n" },
  });
  const seeded = await createProject(kept.vscode);
  assert.strictEqual(seeded.ok, true);
  assert.deepStrictEqual(seeded.created, [".gitignore"]);
  assert.strictEqual(kept.files.get(existingReadme), "# already here\n");

  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-welcome-"));
  const root = path.join(parent, "real-project");
  fs.mkdirSync(root);
  const disk = mockVscode({ parent: root });
  disk.vscode.workspace.fs.stat = async (target) => fs.promises.stat(target.fsPath);
  disk.vscode.workspace.fs.writeFile = async (target, bytes) => fs.promises.writeFile(target.fsPath, bytes);
  const onDisk = await createProject(disk.vscode);
  assert.strictEqual(onDisk.ok, true);
  assert.strictEqual(onDisk.root, root);
  assert.strictEqual(onDisk.name, "real-project");
  assert.deepStrictEqual(onDisk.created, ["README.md", ".gitignore"]);
  assert.strictEqual(fs.readFileSync(path.join(root, "README.md"), "utf8"), "# real-project\n");
  assert.strictEqual(fs.readFileSync(path.join(root, ".gitignore"), "utf8"), "node_modules/\n.DS_Store\n");
  const openedDisk = await openFolder(mockVscode({ parent: root }).vscode);
  assert.strictEqual(openedDisk.ok, true);
  assert.strictEqual(openedDisk.root, root);
  fs.rmSync(parent, { recursive: true, force: true });

  console.log("ok project lifecycle");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
