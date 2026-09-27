const cp = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const PREVIEW_TERMINAL = "CodeMe Preview";

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
    if (!script) return { command: "", port: 0 };
    return { command: "npm start", port: portFromText(script) };
  } catch {
    return { command: "", port: 0 };
  }
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
  return readHttp(url).then(async (page) => {
    const body = page.body || "";
    const title = (body.match(/<title>([^<]*)<\/title>/i) || [])[1] || "";
    const inspected = await inspectInBrowser(url).catch(() => null);
    const failedRequests = mergeFailures(
      inspected && inspected.failedRequests,
      await failedResourceRequests(url, body),
    );
    return {
      available: true,
      url,
      statusCode: page.statusCode,
      title: title.trim() || (inspected && inspected.title) || "",
      text: clipText((inspected && inspected.text) || textFromHtml(body), 4000),
      consoleErrors: (inspected && inspected.consoleErrors || []).slice(0, 20),
      failedRequests: failedRequests.slice(0, 20),
      screenshot: inspected && inspected.screenshot ? inspected.screenshot : null,
    };
  });
}

function readHttp(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 2500 }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString("utf8") });
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

function textFromHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function resourceUrls(pageUrl, html) {
  const found = [];
  const pattern = /\s(?:src|href)=["']([^"']+)["']/gi;
  let match;
  while ((match = pattern.exec(html))) {
    try {
      const target = new URL(match[1], pageUrl);
      if (target.origin === new URL(pageUrl).origin) found.push(target.toString());
    } catch {
      // Ignore malformed resource URLs.
    }
  }
  return [...new Set(found)].slice(0, 20);
}

async function failedResourceRequests(pageUrl, html) {
  const failures = [];
  for (const resource of resourceUrls(pageUrl, html)) {
    try {
      const response = await readHttp(resource);
      if (response.statusCode >= 400) failures.push({ url: resource, statusCode: response.statusCode });
    } catch (error) {
      failures.push({ url: resource, statusCode: 0, message: error.message || "request failed" });
    }
  }
  return failures;
}

function mergeFailures(primary, extra) {
  const seen = new Set();
  const merged = [];
  for (const item of [...(primary || []), ...(extra || [])]) {
    if (!item || !item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    merged.push({ url: item.url, statusCode: item.statusCode || 0 });
  }
  return merged;
}

function findBrowser() {
  const candidates = [
    process.env.CODEME_BROWSER,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function inspectInBrowser(url) {
  const binary = findBrowser();
  if (!binary || typeof WebSocket !== "function") return Promise.resolve(null);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-preview-"));
  const child = cp.spawn(binary, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--remote-debugging-port=0",
    "--remote-allow-origins=*",
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: "ignore" });
  let settled = false;
  const done = (callback) => {
    if (settled) return;
    settled = true;
    try { child.kill("SIGKILL"); } catch { /* already exited */ }
    callback();
    setTimeout(() => {
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* the browser may still be releasing the profile */ }
    }, 400);
  };
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(() => resolve(null)), 15000);
    readDebugPort(profile).then(async (port) => {
      try {
        const targets = await readJson(`http://127.0.0.1:${port}/json/list`);
        const page = (Array.isArray(targets) ? targets : []).find((item) => item.type === "page" && item.webSocketDebuggerUrl);
        if (!page) throw new Error("The browser did not open a page");
        const result = await capturePage(page.webSocketDebuggerUrl, url);
        clearTimeout(timer);
        done(() => resolve(result));
      } catch {
        clearTimeout(timer);
        done(() => resolve(null));
      }
    }).catch(() => {
      clearTimeout(timer);
      done(() => resolve(null));
    });
  });
}

function readDebugPort(profile) {
  const file = path.join(profile, "DevToolsActivePort");
  const deadline = Date.now() + 8000;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (fs.existsSync(file)) {
        const port = Number(String(fs.readFileSync(file, "utf8")).split("\n")[0]);
        if (port) return resolve(port);
      }
      if (Date.now() > deadline) return reject(new Error("The browser did not open a debugging port"));
      setTimeout(tick, 100);
    };
    tick();
  });
}

function readJson(url) {
  return readHttp(url).then((page) => JSON.parse(page.body));
}

function capturePage(wsUrl, pageUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const consoleErrors = [];
    const failedRequests = [];
    let nextId = 1;
    let loaded = null;
    let closed = false;
    const send = (method, params) => {
      const id = nextId;
      nextId += 1;
      return new Promise((ok, fail) => {
        pending.set(id, { ok, fail });
        ws.send(JSON.stringify({ id, method, params }));
      });
    };
    const finish = (error, value) => {
      if (closed) return;
      closed = true;
      try { ws.close(); } catch { /* already closed */ }
      if (error) reject(error);
      else resolve(value);
    };
    ws.addEventListener("error", () => finish(new Error("The browser connection failed")));
    ws.addEventListener("message", (event) => {
      const raw = typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8");
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      if (message.id && pending.has(message.id)) {
        const waiter = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) waiter.fail(new Error(message.error.message || "browser command failed"));
        else waiter.ok(message.result || {});
        return;
      }
      noteBrowserEvent(message, consoleErrors, failedRequests);
      if (message.method === "Page.loadEventFired" && loaded) loaded();
    });
    ws.addEventListener("open", async () => {
      try {
        await send("Page.enable");
        await send("Runtime.enable");
        await send("Network.enable");
        await send("Log.enable");
        const load = new Promise((ok) => {
          loaded = ok;
          setTimeout(ok, 8000);
        });
        await send("Page.navigate", { url: pageUrl });
        await load;
        await new Promise((ok) => setTimeout(ok, 300));
        const text = await send("Runtime.evaluate", {
          expression: "document.body ? document.body.innerText : ''",
          returnByValue: true,
        });
        const title = await send("Runtime.evaluate", {
          expression: "document.title || ''",
          returnByValue: true,
        });
        const shot = await send("Page.captureScreenshot", { format: "png" });
        const png = Buffer.from(shot.data || "", "base64");
        const file = path.join(os.tmpdir(), `codeme-preview-${Date.now()}.png`);
        if (png.length) fs.writeFileSync(file, png);
        finish(null, {
          text: text.result && text.result.value ? String(text.result.value) : "",
          title: title.result && title.result.value ? String(title.result.value) : "",
          consoleErrors,
          failedRequests,
          screenshot: png.length ? { path: file, bytes: png.length } : null,
        });
      } catch (error) {
        finish(error);
      }
    });
  });
}

function noteBrowserEvent(message, consoleErrors, failedRequests) {
  if (!message || message.method === "Runtime.exceptionThrown") {
    const details = message && message.params && message.params.exceptionDetails;
    const text = details && (details.exception && details.exception.description || details.text);
    if (text) consoleErrors.push(String(text).slice(0, 300));
  }
  if (message && message.method === "Runtime.consoleAPICalled" && message.params && message.params.type === "error") {
    const args = message.params.args || [];
    const text = args.map((item) => item.value || item.description || item.type || "").join(" ").trim();
    if (text) consoleErrors.push(text.slice(0, 300));
  }
  if (message && message.method === "Log.entryAdded") {
    const entry = message.params && message.params.entry;
    if (entry && entry.level === "error" && entry.text) consoleErrors.push(String(entry.text).slice(0, 300));
  }
  if (message && message.method === "Network.responseReceived") {
    const response = message.params && message.params.response;
    if (response && response.status >= 400) failedRequests.push({ url: response.url, statusCode: response.status });
  }
}

function clipText(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? text.slice(0, limit) : text;
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
      if (plan.shouldStart) {
        const running = await probe(plan.url);
        if (!running.available) {
          if (!plan.command) {
            return {
              available: false,
              code: "preview_unavailable",
              message: "This workspace has no npm start script, so the preview cannot start.",
              url: plan.url,
            };
          }
          startPreview(vscode, root, plan.command);
          await openPreview(vscode, plan.url);
          const page = await waitForPage(plan.url, 45000);
          if (page.available) return page;
          return page;
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
  createPreviewRunner,
};
