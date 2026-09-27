const fs = require("fs");
const http = require("http");
const path = require("path");

const PREVIEW_TERMINAL = "CodeMe Preview";
const STATIC_SERVERS = new Map();

function previewPlan(root, requestedUrl) {
  const start = readStartScript(root);
  const port = start.port || portFromText(readReadme(root)) || 4173;
  const origin = `http://127.0.0.1:${port}`;
  const resolved = resolvePreviewUrl(root, requestedUrl, origin);
  if (!resolved.ok) return resolved;
  return {
    ok: true,
    origin,
    url: resolved.url,
    command: start.command,
    shouldStart: resolved.local && resolved.port === port,
    port,
  };
}

function readStartScript(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const script = pkg && pkg.scripts && typeof pkg.scripts.start === "string" ? pkg.scripts.start : "";
    if (!script) return { command: "", port: 0, entry: "" };
    const entry = entryPointFromStartScript(script) || (typeof pkg.main === "string" ? pkg.main : "");
    const port = portFromText(script) || portFromEntryPoint(root, entry);
    return { command: "npm start", port, entry };
  } catch {
    return { command: "", port: 0, entry: "" };
  }
}

function entryPointFromStartScript(script) {
  const text = String(script || "").trim();
  const match = text.match(/(?:^|\s)node\s+(?:--[\w-]+\s+)*([^\s;&|]+)/);
  if (!match) return "";
  return String(match[1] || "").replace(/^[\'"]|[\'"]$/g, "");
}

function portFromEntryPoint(root, entry) {
  const relative = String(entry || "").trim();
  if (!relative || path.isAbsolute(relative) || relative.includes("..")) return 0;
  try {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    return portFromSourceText(source);
  } catch {
    return 0;
  }
}

function portFromSourceText(text) {
  const source = String(text || "");
  const urlPort = portFromText(source);
  if (urlPort) return urlPort;

  const directListen = source.match(/\.listen\s*\(\s*(\d{2,5})\b/);
  if (directListen) return Number(directListen[1]);

  const fallback = source.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:Number\s*\([^)]*\)\s*\|\||parseInt\s*\([^)]*\)\s*\|\||[^;\n]*?\|\|)\s*(\d{2,5})\b/);
  if (fallback) {
    const variable = fallback[1];
    const port = Number(fallback[2]);
    const used = new RegExp("\\.listen\\s*\\(\\s*" + escapeRegExp(variable) + "\\b").test(source);
    if (used) return port;
  }

  const assigned = source.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(\d{2,5})\b/);
  if (assigned) {
    const variable = assigned[1];
    const port = Number(assigned[2]);
    const used = new RegExp("\\.listen\\s*\\(\\s*" + escapeRegExp(variable) + "\\b").test(source);
    if (used) return port;
  }

  return 0;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\function readStartScript(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const script = pkg && pkg.scripts && typeof pkg.scripts.start === "string" ? pkg.scripts.start : "";
    if (!script) return { command: "", port: 0 };
    return { command: "npm start", port: portFromText(script) };
  } catch {
    return { command: "", port: 0 };
  }
}
");
}

function readReadme(root) {
  try {
    return fs.readFileSync(path.join(root, "README.md"), "utf8");
  } catch {
    return "";
  }
}

function portFromText(text) {
  const match = String(text || "").match(/localhost:(\d{2,5})|127\.0\.0\.1:(\d{2,5})|--port[=\s]+(\d{2,5})|-l\s+(\d{2,5})|-p\s+(\d{2,5})/);
  if (!match) return 0;
  return Number(match[1] || match[2] || match[3] || match[4] || match[5] || 0);
}

function resolvePreviewUrl(root, requestedUrl, origin) {
  const raw = String(requestedUrl || "").trim();
  if (!raw) return { ok: false, code: "invalid_args", message: "browser.check requires a URL" };
  if (/^https?:\/\//i.test(raw)) {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      return { ok: false, code: "invalid_url", message: "That URL is not valid." };
    }
    if (parsed.protocol !== "http:") {
      return { ok: false, code: "invalid_url", message: "Only local http preview URLs are allowed." };
    }
    if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
      return { ok: false, code: "invalid_url", message: "Only localhost preview URLs are allowed." };
    }
    parsed.hostname = "127.0.0.1";
    return { ok: true, url: parsed.toString(), local: true, port: Number(parsed.port || 80) };
  }
  const relative = workspaceFilePath(root, raw);
  if (!relative) return { ok: false, code: "invalid_url", message: "That preview path is outside the workspace." };
  const page = relative.replace(/^src\//, "").replace(/\\/g, "/");
  const suffix = !page || page === "index.html" ? "/" : `/${page}`;
  return { ok: true, url: `${origin}${suffix}`, local: true, port: Number(new URL(origin).port || 80) };
}

function workspaceFilePath(root, candidate) {
  let value = String(candidate || "");
  if (value.startsWith("file:")) {
    try {
      value = decodeURIComponent(new URL(value).pathname);
    } catch {
      return "";
    }
  }
  value = value.replace(/^\/workspace\//, "");
  if (root && value.startsWith(root)) value = path.relative(root, value);
  if (path.isAbsolute(value) || value.includes("\0")) return "";
  const normalized = path.normalize(value);
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) return "";
  return normalized.split(path.sep).join("/");
}

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 2500 }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const title = (body.match(/<title>([^<]*)<\/title>/i) || [])[1] || "";
        resolve({
          available: true,
          url,
          statusCode: res.statusCode,
          title: title.trim(),
        });
      });
    });
    req.on("timeout", () => {
      req.destroy();
      reject(Object.assign(new Error("The preview did not answer"), { code: "timeout" }));
    });
    req.on("error", (error) => {
      reject(Object.assign(new Error(error.message || "The preview is not reachable"), { code: error.code || "connection_refused" }));
    });
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
  };
  return types[ext] || "application/octet-stream";
}

function staticRequestFile(root, requestUrl) {
  let pathname = "/";
  try {
    pathname = decodeURIComponent(new URL(requestUrl, "http://127.0.0.1").pathname);
  } catch {
    return "";
  }
  const relative = pathname.replace(/^\/+/, "") || "index.html";
  const resolvedRoot = path.resolve(root);
  let candidate = path.resolve(resolvedRoot, relative);
  if (candidate !== resolvedRoot && !candidate.startsWith(resolvedRoot + path.sep)) return "";
  try {
    if (fs.statSync(candidate).isDirectory()) candidate = path.join(candidate, "index.html");
  } catch {}
  if (candidate !== resolvedRoot && !candidate.startsWith(resolvedRoot + path.sep)) return "";
  return candidate;
}

function createStaticServer(root, port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const file = staticRequestFile(root, req.url || "/");
      if (!file) {
        res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
        res.end("Forbidden");
        return;
      }
      fs.readFile(file, (error, bytes) => {
        if (error) {
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "content-type": contentType(file), "cache-control": "no-store" });
        res.end(bytes);
      });
    });
    const onError = (error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      if (typeof server.unref === "function") server.unref();
      const address = server.address();
      resolve({ server, port: address && typeof address === "object" ? address.port : port });
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

async function ensureStaticPreview(root, preferredPort) {
  const key = path.resolve(root);
  const existing = STATIC_SERVERS.get(key);
  if (existing && existing.server && existing.server.listening) return existing;

  let started;
  try {
    started = await createStaticServer(root, preferredPort || 4173);
  } catch (error) {
    if (!error || error.code !== "EADDRINUSE") throw error;
    started = await createStaticServer(root, 0);
  }
  STATIC_SERVERS.set(key, started);
  return started;
}

async function waitForPage(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      return await fetchPage(url);
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  return {
    available: false,
    code: last && last.code ? last.code : "timeout",
    message: last && last.message ? last.message : "The preview did not start",
    url,
  };
}

function recoverFlagSocket(vscode, root) {
  const candidate = path.join(root, "--port");
  let stat;
  try {
    stat = fs.lstatSync(candidate);
  } catch {
    return false;
  }
  if (!stat.isSocket()) return false;

  for (const terminal of vscode.window.terminals || []) {
    if (terminal && terminal.name === PREVIEW_TERMINAL && typeof terminal.dispose === "function") {
      try { terminal.dispose(); } catch {}
    }
  }
  try {
    fs.unlinkSync(candidate);
  } catch {}
  return true;
}

function createPreviewRunner(vscode) {
  return {
    async check(root, requestedUrl) {
      if (recoverFlagSocket(vscode, root)) {
        return {
          available: false,
          code: "invalid_port_binding",
          message: "The server treated --port as a Unix socket path. Fix server.js so server.listen() receives a numeric port such as 4173, then retry the preview.",
          url: requestedUrl,
        };
      }
      const plan = previewPlan(root, requestedUrl);
      if (!plan.ok) {
        return {
          available: false,
          code: plan.code,
          message: plan.message,
          url: requestedUrl,
        };
      }
      if (plan.shouldStart) {
        if (!plan.command) {
          try {
            const staticPreview = await ensureStaticPreview(root, plan.port);
            const parsed = new URL(plan.url);
            parsed.hostname = "127.0.0.1";
            parsed.port = String(staticPreview.port);
            const staticUrl = parsed.toString();
            await openPreview(vscode, staticUrl);
            return await waitForPage(staticUrl, 5000);
          } catch (error) {
            return {
              available: false,
              code: error && error.code ? String(error.code) : "preview_unavailable",
              message: error instanceof Error ? error.message : String(error),
              url: plan.url,
            };
          }
        }

        const running = await probe(plan.url);
        if (!running.available) {
          startPreview(vscode, root, plan.command);
          await openPreview(vscode, plan.url);
          return await waitForPage(plan.url, 45000);
        }
        await openPreview(vscode, plan.url);
        return running;
      }
      try {
        const page = await fetchPage(plan.url);
        await openPreview(vscode, plan.url);
        return page;
      } catch (error) {
        return {
          available: false,
          code: error.code || "connection_refused",
          message: error.message || "The preview is not reachable",
          url: plan.url,
        };
      }
    },
  };
}

async function probe(url) {
  try {
    return await fetchPage(url);
  } catch (error) {
    return { available: false, code: error.code || "connection_refused", message: error.message, url };
  }
}

async function openPreview(vscode, url) {
  const uri = vscode.Uri.parse(url);
  await vscode.commands.executeCommand("vscode.open", uri).catch(() => {});
  if (vscode.env && typeof vscode.env.openExternal === "function") {
    await vscode.env.openExternal(uri).catch(() => {});
  }
}

function startPreview(vscode, root, command) {
  const existing = vscode.window.terminals.find((item) => item.name === PREVIEW_TERMINAL);
  const terminal = existing || vscode.window.createTerminal({ name: PREVIEW_TERMINAL, cwd: root });
  terminal.show(true);
  terminal.sendText(command);
}

module.exports = {
  PREVIEW_TERMINAL,
  previewPlan,
  resolvePreviewUrl,
  portFromText,
  entryPointFromStartScript,
  portFromSourceText,
  recoverFlagSocket,
  ensureStaticPreview,
  createPreviewRunner,
};
