const fs = require("fs");
const http = require("http");
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
