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

  const staticPath = !start.command ? staticPreviewPath(root) : "/";
  let url = resolved.url;
  const raw = String(requestedUrl || "").trim();
  if (!start.command && staticPath !== "/" && (!raw || raw === "index.html" || raw === "./index.html" || /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/?$/i.test(raw))) {
    url = new URL(staticPath, origin).toString();
  }

  return {
    ok: true,
    origin,
    url,
    command: start.command,
    shouldStart: resolved.local && resolved.port === port,
    port,
    staticPath,
  };
}

function staticPreviewPath(root) {
  const candidates = [
    ["index.html", "/"],
    [path.join("public", "index.html"), "/public/"],
    [path.join("dist", "index.html"), "/dist/"],
    [path.join("build", "index.html"), "/build/"],
  ];
  for (const [file, pathname] of candidates) {
    try {
      if (fs.statSync(path.join(root, file)).isFile()) return pathname;
    } catch {}
  }
  return "/";
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
  return String(value || "").replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
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

function isPreviewAssetPath(value) {
  let pathname = String(value || "");
  try {
    if (/^https?:\/\//i.test(pathname)) pathname = new URL(pathname).pathname;
  } catch {}
  pathname = pathname.split("?")[0].split("#")[0].toLowerCase();
  return /\.(?:css|js|mjs|cjs|map|json|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|mp4|webm|mp3|wav)$/i.test(pathname);
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
    const requestedAsset = isPreviewAssetPath(parsed.pathname);
    if (requestedAsset) {
      parsed.pathname = "/";
      parsed.search = "";
      parsed.hash = "";
    }
    return {
      ok: true,
      url: parsed.toString(),
      local: true,
      port: Number(parsed.port || 80),
      canonicalizedFromAsset: requestedAsset ? raw : "",
    };
  }
  const relative = workspaceFilePath(root, raw);
  if (!relative) return { ok: false, code: "invalid_url", message: "That preview path is outside the workspace." };
  const page = relative.replace(/^src\//, "").replace(/\\/g, "/");
  const requestedAsset = isPreviewAssetPath(page);
  const suffix = requestedAsset || !page || page === "index.html" ? "/" : `/${page}`;
  return {
    ok: true,
    url: `${origin}${suffix}`,
    local: true,
    port: Number(new URL(origin).port || 80),
    canonicalizedFromAsset: requestedAsset ? raw : "",
  };
}

function resolveOwnedPreviewUrl(session, requestedUrl) {
  const requested = String(requestedUrl || "").trim();
  const owned = session && session.status === "running"
    ? String(session.url || session.origin || "")
    : "";
  if (!owned) return requested;
  if (!requested) return owned;

  try {
    const parsed = new URL(requested);
    if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsed.hostname)) return requested;
    const pathname = parsed.pathname || "/";
    if (pathname === "/" || pathname === "/index.html") return owned;
    const target = new URL(owned);
    target.pathname = pathname;
    target.search = parsed.search;
    target.hash = parsed.hash;
    return target.toString();
  } catch {
    return owned;
  }
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

async function fetchPage(url) {
  const page = await fetchResource(url);
  const body = page.body;
  const pageMime = String(page.contentType || "").toLowerCase();
  if (page.statusCode < 200 || page.statusCode >= 400) {
    return {
      available: false,
      code: "page_status",
      message: `Preview page returned HTTP ${page.statusCode}`,
      url,
      statusCode: page.statusCode,
      contentType: page.contentType,
      assets: [],
    };
  }
  const looksHtml = pageMime.includes("text/html")
    || (!/(?:text\/css|javascript|ecmascript|image\/|font\/|application\/json)/.test(pageMime)
      && /<!doctype\s+html|<html\b|<head\b|<body\b|<[a-z][^>]*>/i.test(body));
  if (!looksHtml) {
    return {
      available: false,
      code: "preview_not_html",
      message: `browser.check must verify an HTML page, but this URL returned ${page.contentType || "non-HTML content"}`,
      url,
      statusCode: page.statusCode,
      contentType: page.contentType,
      assets: [],
    };
  }
  const title = (body.match(/<title>([^<]*)<\/title>/i) || [])[1] || "";
  const refs = extractLocalAssets(body, url);
  const assets = [];

  for (const ref of refs) {
    let asset;
    try {
      asset = await fetchResource(ref.url);
    } catch (error) {
      return {
        available: false,
        code: "asset_unavailable",
        message: `${ref.kind} asset ${ref.path} could not be loaded: ${error.message || "unavailable"}`,
        url,
        statusCode: page.statusCode,
        title: title.trim(),
        assets,
      };
    }

    const mime = String(asset.contentType || "").toLowerCase();
    const mimeOk = ref.kind === "style"
      ? mime.includes("text/css")
      : (mime.includes("javascript") || mime.includes("ecmascript"));

    const record = {
      kind: ref.kind,
      path: ref.path,
      url: ref.url,
      statusCode: asset.statusCode,
      contentType: asset.contentType,
      ok: asset.statusCode >= 200 && asset.statusCode < 400 && mimeOk,
    };
    assets.push(record);

    if (asset.statusCode < 200 || asset.statusCode >= 400) {
      return {
        available: false,
        code: "asset_status",
        message: `${ref.kind} asset ${ref.path} returned HTTP ${asset.statusCode}`,
        url,
        statusCode: page.statusCode,
        title: title.trim(),
        assets,
      };
    }
    if (!mimeOk) {
      return {
        available: false,
        code: "asset_mime",
        message: `${ref.kind} asset ${ref.path} was served as ${asset.contentType || "an unknown content type"}`,
        url,
        statusCode: page.statusCode,
        title: title.trim(),
        assets,
      };
    }
  }

  return {
    available: true,
    url,
    statusCode: page.statusCode,
    title: title.trim(),
    assets,
  };
}

function fetchResource(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 2500 }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          url,
          statusCode: Number(res.statusCode || 0),
          contentType: String(res.headers["content-type"] || ""),
          body: Buffer.concat(chunks).toString("utf8"),
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

function extractLocalAssets(html, pageUrl) {
  const items = [];
  const seen = new Set();
  const add = (kind, value) => {
    const raw = String(value || "").trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("data:") || raw.startsWith("javascript:")) return;
    let resolved;
    try {
      resolved = new URL(raw, pageUrl);
    } catch {
      return;
    }
    const page = new URL(pageUrl);
    if (resolved.origin !== page.origin) return;
    const key = `${kind}:${resolved.href}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      kind,
      path: decodeURIComponent(resolved.pathname.replace(/^\/+/, "")),
      url: resolved.href,
    });
  };

  const linkPattern = /<link\b[^>]*>/gi;
  for (const match of String(html || "").matchAll(linkPattern)) {
    const tag = match[0];
    const rel = (tag.match(/\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i) || []);
    const relValue = rel[1] || rel[2] || rel[3] || "";
    if (!/(^|\s)stylesheet(\s|$)/i.test(relValue.trim())) continue;
    const href = (tag.match(/\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i) || []);
    add("style", href[1] || href[2] || href[3] || "");
  }

  const scriptPattern = /<script\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi;
  for (const match of String(html || "").matchAll(scriptPattern)) {
    add("script", match[1] || match[2] || match[3] || "");
  }

  return items;
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

function recoverFlagSocket(root) {
  const candidate = path.join(root, "--port");
  let stat;
  try {
    stat = fs.lstatSync(candidate);
  } catch {
    return false;
  }
  if (!stat.isSocket()) return false;
  try {
    fs.unlinkSync(candidate);
  } catch {}
  return true;
}

function createPreviewRunner(vscode) {
  return {
    async check(root, requestedUrl) {
      const plan = previewPlan(root, requestedUrl);
      if (!plan.ok) {
        return {
          available: false,
          code: plan.code,
          message: plan.message,
          url: requestedUrl,
        };
      }

      let page;
      try {
        page = await fetchPage(plan.url);
      } catch (error) {
        return {
          available: false,
          code: "preview_not_running",
          cause: error && error.code ? String(error.code) : "connection_refused",
          message: error && error.message ? String(error.message) : "The preview is not reachable",
          url: plan.url,
          statusCode: null,
        };
      }

      // browser.check is verification only. An HTTP response, including 4xx/5xx,
      // proves a server answered and must never trigger a hidden start/restart here.
      if (!page.available) return page;

      await openPreview(vscode, plan.url);
      return page;
    },
  };
}

async function probe(url) {
  try {
    return await fetchPage(url);
  } catch (error) {
    return {
      available: false,
      code: "preview_not_running",
      cause: error && error.code ? String(error.code) : "connection_refused",
      message: error && error.message ? String(error.message) : "The preview is not reachable",
      url,
      statusCode: null,
    };
  }
}

async function openPreview(vscode, url) {
  // This only opens the already-running site in the IDE. It never starts,
  // restarts, kills, or otherwise owns an application process.
  try {
    // The CodeMe Start panel normally fills an empty editor group. Dispose it
    // before Simple Browser opens so its tab-change listener cannot reveal Start
    // back over the preview while the browser tab is materializing.
    try {
      await vscode.commands.executeCommand("codeme.hideStart");
    } catch {
      // Older shells may not expose the command; opening the browser should still work.
    }
    await vscode.commands.executeCommand("simpleBrowser.show", url);
    return { opened: true, surface: "simpleBrowser" };
  } catch (error) {
    return {
      opened: false,
      surface: "simpleBrowser",
      code: "internal_browser_unavailable",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function isAssetFailure(result) {
  return Boolean(result && ["asset_unavailable", "asset_status", "asset_mime"].includes(result.code));
}


module.exports = {
  PREVIEW_TERMINAL,
  previewPlan,
  staticPreviewPath,
  resolvePreviewUrl,
  resolveOwnedPreviewUrl,
  isPreviewAssetPath,
  portFromText,
  entryPointFromStartScript,
  portFromSourceText,
  extractLocalAssets,
  recoverFlagSocket,
  ensureStaticPreview,
  fetchPage,
  probe,
  isAssetFailure,
  createPreviewRunner,
};
