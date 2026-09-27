const assert = require("assert");
const path = require("path");
const { validateProjectName, createProject } = require("../project-manager");

function uri(value) {
  return { fsPath: value, path: value, toString: () => `file://${value}` };
}

function mockVscode(options = {}) {
  const events = [];
  const files = new Map();
  const directories = new Set(options.existing || []);
  const errors = [];
  const vscode = {
    Uri: {
      joinPath(base, ...parts) {
        return uri(path.join(base.fsPath, ...parts));
      },
    },
    window: {
      async showInputBox() { return options.name; },
      async showOpenDialog() { return options.parent === undefined ? undefined : [uri(options.parent)]; },
      async showErrorMessage(message) { errors.push(message); },
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
      },
    },
  };
  return { vscode, events, files, directories, errors };
}

async function main() {
  for (const bad of ["", "   ", ".", "..", "foo/bar", "foo\\bar", "bad:name", "bad?name", "bad."]) {
    assert.strictEqual(validateProjectName(bad).ok, false, bad);
  }
  assert.deepStrictEqual(validateProjectName(" car-market "), { ok: true, name: "car-market" });

  const success = mockVscode({ name: "car-market", parent: "/projects" });
  const result = await createProject(success.vscode);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.root, path.join("/projects", "car-market"));
  assert.strictEqual(result.state, "workspace_opening");
  assert.strictEqual(success.files.get(path.join("/projects", "car-market", "README.md")), "# car-market\n");
  assert.strictEqual(success.files.get(path.join("/projects", "car-market", ".gitignore")), "node_modules/\n");
  assert.deepStrictEqual(success.events, [
    ["mkdir", path.join("/projects", "car-market")],
    ["write", path.join("/projects", "car-market", "README.md")],
    ["write", path.join("/projects", "car-market", ".gitignore")],
    ["command", "vscode.openFolder", path.join("/projects", "car-market")],
  ]);

  const duplicate = mockVscode({ name: "existing", parent: "/projects", existing: [path.join("/projects", "existing")] });
  const duplicateResult = await createProject(duplicate.vscode);
  assert.strictEqual(duplicateResult.code, "project_exists");
  assert.strictEqual(duplicate.events.length, 0);
  assert.strictEqual(duplicate.errors.length, 1);

  const invalid = mockVscode({ name: "bad/name", parent: "/projects" });
  const invalidResult = await createProject(invalid.vscode);
  assert.strictEqual(invalidResult.code, "invalid_project_name");
  assert.strictEqual(invalid.events.length, 0);

  const cancelName = mockVscode({ name: undefined, parent: "/projects" });
  assert.deepStrictEqual(await createProject(cancelName.vscode), { ok: false, cancelled: true, stage: "name" });
  assert.strictEqual(cancelName.events.length, 0);

  const cancelLocation = mockVscode({ name: "new-project", parent: undefined });
  assert.deepStrictEqual(await createProject(cancelLocation.vscode), { ok: false, cancelled: true, stage: "location" });
  assert.strictEqual(cancelLocation.events.length, 0);

  console.log("ok project lifecycle");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
