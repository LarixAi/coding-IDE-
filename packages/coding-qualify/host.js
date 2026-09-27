const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const { validateCommand, readRangeFromText, patchText, createProcessRunner } = require("../agent-tools");

function createWorkspaceHost(root) {
  const rootReal = fs.realpathSync(root);
  const processes = createProcessRunner(rootReal);
  return {
    async readFile(filePath) {
      const full = resolveInside(rootReal, filePath);
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
        throw Object.assign(new Error(`File not found: ${filePath}`), { code: "not_found" });
      }
      return { path: filePath, contents: fs.readFileSync(full, "utf8") };
    },
    async createDirectory(dirPath) {
      const full = resolveInside(rootReal, dirPath);
      fs.mkdirSync(full, { recursive: true });
      return { path: dirPath };
    },
    async listDirectory(dirPath) {
      const full = dirPath === "." ? rootReal : resolveInside(rootReal, dirPath);
      if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
        throw Object.assign(new Error(`Folder not found: ${dirPath}`), { code: "not_found" });
      }
      const entries = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === ".git" || entry.name === "node_modules") continue;
          const child = path.join(dir, entry.name);
          const relative = path.relative(rootReal, child).split(path.sep).join("/");
          entries.push({ path: relative, type: entry.isDirectory() ? "dir" : "file" });
          if (entries.length >= 200) return;
          if (entry.isDirectory()) walk(child);
          if (entries.length >= 200) return;
        }
      };
      walk(full);
      return { path: dirPath, entries };
    },
    async readRange(filePath, startLine, endLine) {
      const file = await this.readFile(filePath);
      return readRangeFromText(filePath, file.contents, startLine, endLine);
    },
    async patchFile(filePath, patch) {
      const file = await this.readFile(filePath);
      const next = patchText(file.contents, patch);
      if (next === file.contents) return { path: filePath, bytes: Buffer.byteLength(next), changed: false };
      const written = await this.writeFile(filePath, next);
      return { ...written, changed: true };
    },
    async writeFile(filePath, contents) {
      const full = resolveInside(rootReal, filePath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      const resolved = resolveInside(rootReal, filePath);
      fs.writeFileSync(resolved, contents);
      return { path: filePath, bytes: Buffer.byteLength(contents) };
    },
    async search(query) {
      const matches = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === ".git" || entry.name === "node_modules") continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.isFile()) {
            const text = fs.readFileSync(full, "utf8");
            text.split(/\r?\n/).forEach((line, index) => {
              if (line.includes(query) && matches.length < 20) {
                matches.push({ path: path.relative(rootReal, full), line: index + 1, text: line });
              }
            });
          }
        }
      };
      walk(rootReal);
      return { query, matches };
    },
    async runTerminal(command) {
      return runPolicyCommand(rootReal, command);
    },
    async runTests(command) {
      return runPolicyCommand(rootReal, command);
    },
    async runProcess(spec) {
      return processes.run(spec);
    },
    async startProcess(spec) {
      return processes.start(spec);
    },
    processStatus(id) {
      return processes.status(id);
    },
    stopProcess(id) {
      return processes.stop(id);
    },
    async diagnostics() {
      const items = [];
      const files = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === ".git" || entry.name === "node_modules") continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.name.endsWith(".js")) files.push(full);
        }
      };
      walk(rootReal);
      for (const file of files) {
        const result = await spawnChecked(process.execPath, ["--check", file], rootReal);
        if (result.exitCode !== 0) {
          items.push({ path: path.relative(rootReal, file), message: result.stderr || result.stdout });
        }
      }
      return { items };
    },
    async gitStatus() {
      const result = await spawnChecked("git", ["status", "--porcelain"], rootReal);
      return { porcelain: result.stdout, exitCode: result.exitCode };
    },
    async gitDiff() {
      const result = await spawnChecked("git", ["diff"], rootReal);
      return { diff: result.stdout, exitCode: result.exitCode };
    },
  };
}

function resolveInside(rootReal, filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw Object.assign(new Error("Path is required"), { code: "invalid_args" });
  }
  if (path.isAbsolute(filePath) || filePath.includes("\0")) {
    throw Object.assign(new Error("Path must stay inside the workspace"), { code: "absolute_path" });
  }
  const full = path.resolve(rootReal, filePath);
  const relative = path.relative(rootReal, full);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw Object.assign(new Error("Path escapes the workspace"), { code: "path_escape" });
  }
  const parent = nearestExisting(path.dirname(full));
  const parentReal = fs.realpathSync(parent);
  if (parentReal !== rootReal && !parentReal.startsWith(`${rootReal}${path.sep}`)) {
    throw Object.assign(new Error("Path escapes the workspace"), { code: "path_escape" });
  }
  return full;
}

function nearestExisting(dir) {
  let current = dir;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

function runPolicyCommand(root, command) {
  const commandError = validateCommand(command);
  if (commandError) {
    throw Object.assign(new Error(commandError.message), { code: commandError.code });
  }
  const parts = command.trim().split(/\s+/);
  return createProcessRunner(root).run({ executable: parts[0], args: parts.slice(1) }).then((result) => ({
    command,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  }));
}

function spawnChecked(binary, args, cwd) {
  return new Promise((resolve) => {
    const child = cp.spawn(binary, args, { cwd, shell: false, env: process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
    child.stdout.on("data", (chunk) => {
      stdout = (stdout + chunk).slice(0, 8000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(0, 8000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: 127, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code === null ? 1 : code, stdout, stderr });
    });
  });
}

module.exports = { createWorkspaceHost, resolveInside };
