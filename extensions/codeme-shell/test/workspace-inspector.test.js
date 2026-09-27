const assert = require("assert");
const path = require("path");
const { inspectWorkspace } = require("../workspace-inspector");

const DIRECTORY = 2;
const FILE = 1;

function createVscode(tree, rootPath = "/workspace", rootName = "workspace") {
  const writes = [];
  function uri(value) {
    return { fsPath: value, path: value, toString: () => `file://${value}` };
  }
  function childPath(parent, name) {
    return path.join(parent.fsPath, name);
  }
  function nodeAt(target) {
    return tree[target.fsPath];
  }
  return {
    writes,
    vscode: {
      FileType: { File: FILE, Directory: DIRECTORY },
      Uri: {
        joinPath(parent, ...parts) {
          return uri(path.join(parent.fsPath, ...parts));
        },
      },
      workspace: {
        workspaceFolders: [{ name: rootName, uri: uri(rootPath) }],
        fs: {
          async readDirectory(target) {
            const node = nodeAt(target);
            if (!node || node.type !== "dir") throw new Error(`missing directory: ${target.fsPath}`);
            return Object.entries(node.children || {}).map(([name, type]) => [name, type === "dir" ? DIRECTORY : FILE]);
          },
          async readFile(target) {
            const node = nodeAt(target);
            if (!node || node.type !== "file") throw new Error(`missing file: ${target.fsPath}`);
            return Buffer.from(node.contents || "", "utf8");
          },
          async writeFile() {
            writes.push("write");
            throw new Error("workspace inspection must not write");
          },
          async createDirectory() {
            writes.push("mkdir");
            throw new Error("workspace inspection must not create directories");
          },
        },
        asRelativePath(target) {
          return path.relative(rootPath, target.fsPath);
        },
      },
    },
  };
}

function dir(children = {}) {
  return { type: "dir", children };
}

function file(contents = "") {
  return { type: "file", contents };
}

async function main() {
  {
    const mock = createVscode({
      "/workspace": dir({ ".DS_Store": "file" }),
      "/workspace/.DS_Store": file("metadata"),
    }, "/workspace", "new-site");
    const result = await inspectWorkspace(mock.vscode);
    assert.deepStrictEqual(result, {
      state: "empty",
      root: "new-site",
      entries: 0,
      files: [],
      git: false,
      projectMarkers: [],
      languages: [],
      frameworks: [],
      packageManager: null,
      scripts: {},
    });
    assert.strictEqual(mock.writes.length, 0);
  }

  {
    const packageJson = JSON.stringify({
      scripts: { dev: "vite", build: "vite build", test: "vitest" },
      dependencies: { react: "^19.0.0" },
      devDependencies: { vite: "^7.0.0", typescript: "^5.0.0" },
    });
    const mock = createVscode({
      "/workspace": dir({
        ".git": "dir",
        "package.json": "file",
        "package-lock.json": "file",
        "vite.config.ts": "file",
        src: "dir",
      }),
      "/workspace/.git": dir(),
      "/workspace/package.json": file(packageJson),
      "/workspace/package-lock.json": file("{}"),
      "/workspace/vite.config.ts": file("export default {}"),
      "/workspace/src": dir({ "App.tsx": "file" }),
      "/workspace/src/App.tsx": file("export function App() { return null; }"),
    }, "/workspace", "existing-app");
    const result = await inspectWorkspace(mock.vscode);
    assert.strictEqual(result.state, "project");
    assert.strictEqual(result.root, "existing-app");
    assert.strictEqual(result.git, true);
    assert.ok(result.projectMarkers.includes("package.json"));
    assert.ok(result.languages.includes("typescript"));
    assert.deepStrictEqual(result.frameworks, ["react", "vite"]);
    assert.strictEqual(result.packageManager, "npm");
    assert.deepStrictEqual(result.scripts, { dev: "vite", build: "vite build", test: "vitest" });
    assert.ok(result.files.includes("package.json"));
    assert.strictEqual(mock.writes.length, 0);
  }

  {
    const mock = createVscode({
      "/workspace": dir({ "README.md": "file", ".gitignore": "file" }),
      "/workspace/README.md": file("# shop\n"),
      "/workspace/.gitignore": file("node_modules/\n.DS_Store\n"),
    }, "/workspace", "shop");
    const result = await inspectWorkspace(mock.vscode);
    assert.strictEqual(result.state, "folder");
    assert.deepStrictEqual(result.files, [".gitignore", "README.md"]);
    assert.strictEqual(result.entries, 2);
    assert.strictEqual(mock.writes.length, 0);
  }

  {
    const mock = createVscode({
      "/workspace": dir({ notes: "dir", "todo.txt": "file" }),
      "/workspace/notes": dir({ "ideas.md": "file" }),
      "/workspace/notes/ideas.md": file("# ideas"),
      "/workspace/todo.txt": file("later"),
    }, "/workspace", "notes");
    const result = await inspectWorkspace(mock.vscode);
    assert.strictEqual(result.state, "folder");
    assert.deepStrictEqual(result.projectMarkers, []);
    assert.strictEqual(result.packageManager, null);
    assert.strictEqual(mock.writes.length, 0);
  }

  console.log("ok workspace understanding");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
