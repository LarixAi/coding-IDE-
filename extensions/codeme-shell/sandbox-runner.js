const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const crypto = require("crypto");

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 120000;
const MAX_FILES = 5000;
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_OUTPUT = 50000;
const EXCLUDED = new Set([".git", "node_modules", ".tools", ".codeme", ".DS_Store"]);

function sandboxError(code, message) {
  return Object.assign(new Error(message), { code });
}

function safeRelative(value) {
  const text = String(value || "").trim();
  if (!text || text.startsWith("-") || path.isAbsolute(text) || /^[A-Za-z]:[\\/]/.test(text) || text.includes("\0")) return false;
  const normalized = path.normalize(text);
  return normalized !== ".." && !normalized.startsWith(`..${path.sep}`);
}

function parseSandboxCommand(command) {
  const text = String(command || "").trim();
  if (!text) throw sandboxError("invalid_args", "sandbox.run requires a command");
  if (/[\0\n\r;&|\`$<>]/.test(text) || /["']/.test(text)) {
    throw sandboxError("command_rejected", "Sandbox commands do not support shell syntax, quoting, pipes, redirects, or backgrounding");
  }

  const parts = text.split(/\s+/);
  const program = parts.shift();
  const args = parts.slice();

  if (program === "node") {
    if (args.length === 1 && safeRelative(args[0])) {
      return { program, args };
    }
    if (args.length === 2 && args[0] === "--check" && safeRelative(args[1])) {
      return { program, args };
    }
    if (args.length <= 2 && args[0] === "--test" && (!args[1] || safeRelative(args[1]))) {
      return { program, args };
    }
    throw sandboxError("command_rejected", "sandbox.run supports node <file>, node --check <file>, or node --test [file]");
  }

  if (program === "npm") {
    if (args.length === 1 && args[0] === "test") return { program, args };
    if (args.length === 2 && args[0] === "run" && /^[A-Za-z0-9:_-]+$/.test(args[1])) return { program, args };
    throw sandboxError("command_rejected", "sandbox.run supports npm test or npm run <script>");
  }

  if (program === "python3") {
    if (args.length === 1 && safeRelative(args[0]) && /\.py$/i.test(args[0])) return { program, args };
    if (
      args.length >= 2
      && args.length <= 3
      && args[0] === "-m"
      && args[1] === "pytest"
      && (!args[2] || safeRelative(args[2]))
    ) {
      return { program, args };
    }
    throw sandboxError("command_rejected", "sandbox.run supports python3 <file.py> or python3 -m pytest [path]");
  }

  throw sandboxError("command_rejected", "sandbox.run allows node, npm, or python3 commands only");
}

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function copyWorkspace(root, destination) {
  const hashes = {};
  const stats = { files: 0, bytes: 0, skippedSymlinks: 0 };

  function copyDir(source, target, relative) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      if (EXCLUDED.has(entry.name)) continue;
      const sourcePath = path.join(source, entry.name);
      const targetPath = path.join(target, entry.name);
      const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
      const info = fs.lstatSync(sourcePath);

      if (info.isSymbolicLink()) {
        stats.skippedSymlinks += 1;
        continue;
      }
      if (info.isDirectory()) {
        copyDir(sourcePath, targetPath, relativePath);
        continue;
      }
      if (!info.isFile()) continue;

      stats.files += 1;
      stats.bytes += info.size;
      if (stats.files > MAX_FILES || stats.bytes > MAX_BYTES) {
        throw sandboxError(
          "sandbox_too_large",
          `Workspace sandbox copy exceeds the limit of ${MAX_FILES} files or ${Math.round(MAX_BYTES / 1024 / 1024)} MB`,
        );
      }
      fs.copyFileSync(sourcePath, targetPath);
      try { fs.chmodSync(targetPath, info.mode); } catch {}
      hashes[relativePath.replace(/\\/g, "/")] = hashBuffer(fs.readFileSync(targetPath));
    }
  }

  copyDir(root, destination, "");
  return { hashes, stats };
}

function snapshotFiles(root) {
  const hashes = {};
  let files = 0;
  let bytes = 0;

  function walk(directory, relative) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = path.join(directory, entry.name);
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const info = fs.lstatSync(full);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        walk(full, rel);
        continue;
      }
      if (!info.isFile()) continue;
      files += 1;
      bytes += info.size;
      if (files > MAX_FILES || bytes > MAX_BYTES * 2) continue;
      hashes[rel.replace(/\\/g, "/")] = hashBuffer(fs.readFileSync(full));
    }
  }

  walk(root, "");
  return hashes;
}

function changedPaths(before, after) {
  const names = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return Array.from(names)
    .filter((name) => before[name] !== after[name])
    .sort()
    .slice(0, 200);
}

function findExecutable(name) {
  const envPath = String(process.env.PATH || "");
  for (const directory of envPath.split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  return "";
}

function isolationBackend() {
  if (process.platform === "darwin" && fs.existsSync("/usr/bin/sandbox-exec")) {
    return {
      kind: "macos-sandbox-exec",
      securityBoundary: true,
      network: "denied",
      executable: "/usr/bin/sandbox-exec",
    };
  }
  if (process.platform === "linux") {
    const bwrap = findExecutable("bwrap");
    if (bwrap) {
      return {
        kind: "bubblewrap-readonly-host",
        securityBoundary: false,
        network: "denied",
        executable: bwrap,
      };
    }
  }
  return {
    kind: "workspace-copy",
    securityBoundary: false,
    network: "best_effort_blocked",
    executable: "",
  };
}

function isSyntaxOnly(parsed) {
  return Boolean(
    parsed
    && parsed.program === "node"
    && Array.isArray(parsed.args)
    && parsed.args.length === 2
    && parsed.args[0] === "--check"
  );
}

function executableInfo(program) {
  const found = findExecutable(program);
  if (!found) return { executable: program, readRoot: "" };
  let resolved = found;
  try { resolved = fs.realpathSync(found); } catch {}
  const normalized = resolved.replace(/\\/g, "/");
  if (normalized.startsWith("/opt/homebrew/")) return { executable: resolved, readRoot: "/opt/homebrew" };
  if (normalized.startsWith("/usr/") || normalized.startsWith("/bin/") || normalized.startsWith("/sbin/")) {
    return { executable: resolved, readRoot: "" };
  }
  return { executable: resolved, readRoot: path.dirname(path.dirname(resolved)) };
}

function sandboxEnvironment(root) {
  const home = path.join(root, ".home");
  const temporary = path.join(root, ".tmp");
  const cache = path.join(root, ".npm-cache");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(temporary, { recursive: true });
  fs.mkdirSync(cache, { recursive: true });

  return {
    PATH: String(process.env.PATH || ""),
    LANG: String(process.env.LANG || "C"),
    LC_ALL: String(process.env.LC_ALL || ""),
    HOME: home,
    TMPDIR: temporary,
    TMP: temporary,
    TEMP: temporary,
    CI: "1",
    npm_config_cache: cache,
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
    npm_config_offline: "true",
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    ALL_PROXY: "http://127.0.0.1:9",
    NO_PROXY: "",
  };
}

function macProfile(root, runtimeRoot, extraReadRoots = []) {
  const quote = (value) => String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const readable = [
    root,
    "/System",
    "/usr",
    "/bin",
    "/sbin",
    "/Library/Frameworks",
    "/Library/Apple",
    "/opt/homebrew",
    "/private/var/db/dyld",
    "/dev",
  ];
  if (runtimeRoot) readable.push(runtimeRoot);
  for (const item of extraReadRoots) {
    if (item) readable.push(item);
  }
  const readRules = [...new Set(readable)]
    .filter((item) => item && fs.existsSync(item))
    .map((item) => `(subpath "${quote(item)}")`)
    .join(" ");
  return [
    "(version 1)",
    "(deny default)",
    "(allow process*)",
    "(allow signal)",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    `(allow file-read* ${readRules})`,
    `(allow file-write* (subpath "${quote(root)}"))`,
    "(deny network*)",
  ].join("");
}

function commandForBackend(backend, sandboxRoot, parsed, extraReadRoots = []) {
  const program = executableInfo(parsed.program);
  if (backend.kind === "macos-sandbox-exec") {
    return {
      executable: backend.executable,
      args: ["-p", macProfile(sandboxRoot, program.readRoot, extraReadRoots), program.executable, ...parsed.args],
    };
  }
  if (backend.kind === "bubblewrap-readonly-host") {
    return {
      executable: backend.executable,
      args: [
        "--die-with-parent",
        "--unshare-net",
        "--ro-bind", "/", "/",
        "--bind", sandboxRoot, sandboxRoot,
        "--chdir", sandboxRoot,
        "--proc", "/proc",
        "--dev", "/dev",
        "--",
        program.executable,
        ...parsed.args,
      ],
    };
  }
  return { executable: program.executable, args: parsed.args };
}

function executeCommand(spec, options) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let child;

    try {
      child = cp.spawn(spec.executable, spec.args, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({
        exitCode: 127,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        timedOut: false,
      });
      return;
    }

    const append = (current, chunk) => (current + String(chunk || "")).slice(-MAX_OUTPUT);
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.once("error", (error) => {
      finish({
        exitCode: 127,
        stdout,
        stderr: append(stderr, error instanceof Error ? error.message : String(error)),
        timedOut,
      });
    });

    child.once("close", (code, signal) => {
      finish({
        exitCode: typeof code === "number" ? code : (timedOut ? 124 : 1),
        stdout,
        stderr,
        timedOut,
        signal: signal || null,
      });
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGKILL"); } catch {}
    }, options.timeoutMs);
  });
}

function linkDependencies(workspaceRoot, sandboxRoot, backend) {
  if (!backend.securityBoundary) return "";
  const source = path.join(workspaceRoot, "node_modules");
  const target = path.join(sandboxRoot, "node_modules");
  if (!fs.existsSync(source) || fs.existsSync(target)) return "";
  try {
    fs.symlinkSync(source, target, "dir");
    return source;
  } catch {
    return "";
  }
}

function createSandboxRunner(options = {}) {
  const allowSoftExecution = options.allowSoftExecution === true;
  return {
    async run(workspaceRoot, input) {
      const root = path.resolve(String(workspaceRoot || ""));
      if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        throw sandboxError("no_workspace", "sandbox.run requires an existing workspace folder");
      }

      const args = input && typeof input === "object" ? input : {};
      const parsed = parseSandboxCommand(args.command);
      const requestedTimeout = Number(args.timeoutMs);
      const timeoutMs = Number.isFinite(requestedTimeout)
        ? Math.max(1000, Math.min(MAX_TIMEOUT_MS, requestedTimeout))
        : DEFAULT_TIMEOUT_MS;

      const containerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-sandbox-"));
      const sandboxRoot = path.join(containerRoot, "workspace");
      fs.mkdirSync(sandboxRoot, { recursive: true });

      let copied;
      try {
        copied = copyWorkspace(root, sandboxRoot);
        const backend = isolationBackend();
        if (!backend.securityBoundary && !allowSoftExecution && !isSyntaxOnly(parsed)) {
          return {
            available: false,
            code: "sandbox_unavailable",
            message: "A strong OS sandbox is not available for executable project code. Only node --check syntax validation is allowed without one.",
            command: String(args.command || ""),
            isolation: backend.kind,
            securityBoundary: false,
            network: backend.network,
            workspace: "ephemeral_copy",
            discarded: true,
            changedPaths: [],
          };
        }
        const dependencyRoot = linkDependencies(root, sandboxRoot, backend);
        const dependenciesAvailable = Boolean(dependencyRoot);
        const env = sandboxEnvironment(sandboxRoot);
        const spec = commandForBackend(
          backend,
          sandboxRoot,
          parsed,
          dependencyRoot ? [dependencyRoot] : [],
        );
        const executed = await executeCommand(spec, { cwd: sandboxRoot, env, timeoutMs });
        const after = snapshotFiles(sandboxRoot);
        const changes = changedPaths(copied.hashes, after);
        const output = [executed.stdout, executed.stderr].filter(Boolean).join(
          executed.stdout && executed.stderr ? "\n" : "",
        );

        return {
          available: true,
          command: String(args.command || ""),
          exitCode: executed.exitCode,
          stdout: executed.stdout,
          stderr: executed.stderr,
          output,
          timedOut: Boolean(executed.timedOut),
          isolation: backend.kind,
          securityBoundary: backend.securityBoundary,
          network: backend.network,
          workspace: "ephemeral_copy",
          discarded: true,
          changedPaths: changes,
          copiedFiles: copied.stats.files,
          copiedBytes: copied.stats.bytes,
          skippedSymlinks: copied.stats.skippedSymlinks,
          dependenciesAvailable,
        };
      } finally {
        try { fs.rmSync(containerRoot, { recursive: true, force: true }); } catch {}
      }
    },
  };
}

module.exports = {
  parseSandboxCommand,
  isSyntaxOnly,
  isolationBackend,
  copyWorkspace,
  changedPaths,
  createSandboxRunner,
};
