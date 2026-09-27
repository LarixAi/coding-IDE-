const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const CDP_WAIT_MS = 10000;
const ACTION_WAIT_MS = 250;
const HOLD_VISIBLE_MS = 2500;

function browserCandidates() {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return [
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      path.join(home, "Applications/Brave Browser.app/Contents/MacOS/Brave Browser"),
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      path.join(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      path.join(home, "Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || "";
    const programFiles = process.env.PROGRAMFILES || "";
    const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "";
    return [
      path.join(local, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      path.join(programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
    ];
  }
  return [
    "/usr/bin/brave-browser",
    "/usr/bin/brave",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
  ];
}

function findBrowserExecutable() {
  const override = process.env.CODEME_BROWSER || process.env.CHROME_PATH;
  if (override && fs.existsSync(override)) return override;
  return browserCandidates().find((candidate) => candidate && fs.existsSync(candidate)) || "";
}

function shouldRunHeaded() {
  if (process.env.CODEME_BROWSER_HEADLESS === "1") return false;
  if (process.env.CODEME_BROWSER_HEADED === "1") return true;
  return !process.env.CI;
}

function validateLocalUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    return { ok: false, code: "invalid_url", message: "browser.interact requires a valid local preview URL." };
  }
  if (parsed.protocol !== "http:") {
    return { ok: false, code: "invalid_url", message: "browser.interact only supports local HTTP previews." };
  }
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    return { ok: false, code: "invalid_url", message: "browser.interact only supports localhost previews." };
  }
  parsed.hostname = "127.0.0.1";
  return { ok: true, url: parsed.toString() };
}

function createBrowserInteractionRunner(options = {}) {
  const findExecutable = options.findExecutable || findBrowserExecutable;
  const spawnBrowser = options.spawnBrowser || spawn;

  return {
    async interact(input) {
      const action = String(input && input.action || "").trim().toLowerCase();
      if (action !== "click") {
        return {
          available: false,
          code: "unsupported_browser_action",
          message: "browser.interact currently supports the click action.",
        };
      }

      const checked = validateLocalUrl(input && input.url);
      if (!checked.ok) return { available: false, ...checked };

      const selector = String(input && input.selector || "").trim();
      const targetText = String(input && input.targetText || "").trim();
      const expectedText = String(input && input.expectedText || "").trim();
      if (!selector && !targetText) {
        return {
          available: false,
          code: "invalid_args",
          message: "browser.interact click requires selector or targetText.",
          url: checked.url,
        };
      }

      const executable = findExecutable();
      if (!executable) {
        return {
          available: false,
          code: "browser_driver_unavailable",
          message: "No supported Chromium browser was found. Install Brave, Chrome, Edge, or Chromium.",
          url: checked.url,
        };
      }

      if (typeof WebSocket !== "function") {
        return {
          available: false,
          code: "browser_driver_unavailable",
          message: "This CodeMe runtime does not provide the WebSocket support required for browser automation.",
          url: checked.url,
        };
      }

      const profile = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-browser-"));
      let child = null;
      let client = null;
      try {
        const headed = shouldRunHeaded();
        child = spawnBrowser(executable, [
          ...(headed ? ["--new-window"] : ["--headless=new", "--disable-gpu"]),
          ...(process.env.CI ? ["--no-sandbox", "--disable-dev-shm-usage", "--disable-setuid-sandbox"] : []),
          "--remote-allow-origins=*",
          "--remote-debugging-port=0",
          `--user-data-dir=${profile}`,
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-background-networking",
          "--disable-sync",
          "--disable-extensions",
          "--disable-features=Translate",
          checked.url,
        ], {
          stdio: "ignore",
          detached: false,
        });

        const endpoint = await waitForDevTools(profile, child, CDP_WAIT_MS);
        const targets = await getJson(`http://127.0.0.1:${endpoint.port}/json/list`);
        const target = (targets || []).find((item) => (
          item
          && item.type === "page"
          && item.webSocketDebuggerUrl
          && /^http:\/\/127\.0\.0\.1|^http:\/\/localhost/.test(String(item.url || ""))
        )) || (targets || []).find((item) => item && item.type === "page" && item.webSocketDebuggerUrl);

        if (!target) {
          return {
            available: false,
            code: "browser_target_unavailable",
            message: "The browser window started, but CodeMe could not find a page target.",
            url: checked.url,
          };
        }

        client = new CdpClient(target.webSocketDebuggerUrl);
        await client.connect();
        const consoleErrors = [];
        client.onEvent((message) => collectBrowserError(message, consoleErrors));

        await client.send("Runtime.enable");
        await client.send("Log.enable");
        await client.send("Page.enable");
        await client.send("Page.navigate", { url: checked.url });
        await waitForDocumentReady(client, CDP_WAIT_MS);

        const click = await performVisibleClick(client, selector, targetText);
        if (!click || !click.ok) {
          return {
            available: false,
            code: click && click.code ? click.code : "browser_target_not_found",
            message: click && click.message ? click.message : "The requested browser target was not found.",
            url: checked.url,
            action,
            selector,
            targetText,
            expectedText,
            consoleErrors,
          };
        }

        const observed = await waitForObservedResult(client, expectedText, expectedText ? 2500 : ACTION_WAIT_MS);
        const afterText = observed && typeof observed.afterText === "string" ? observed.afterText : "";
        const matched = expectedText ? Boolean(observed && observed.matched) : true;

        if (!matched) {
          return {
            available: false,
            code: "browser_expectation_failed",
            message: `The click ran, but the target text was "${afterText}" instead of containing "${expectedText}".`,
            url: checked.url,
            action,
            selector,
            targetText,
            expectedText,
            beforeText: click.beforeText || "",
            afterText,
            matched: false,
            consoleErrors,
          };
        }

        if (consoleErrors.length) {
          return {
            available: false,
            code: "browser_console_error",
            message: `The interaction completed, but the browser reported ${consoleErrors.length} runtime/console error${consoleErrors.length === 1 ? "" : "s"}.`,
            url: checked.url,
            action,
            selector,
            targetText,
            expectedText,
            beforeText: click.beforeText || "",
            afterText,
            matched,
            consoleErrors,
          };
        }

        if (headed) await delay(HOLD_VISIBLE_MS);
        return {
          available: true,
          url: checked.url,
          browser: path.basename(executable),
          visible: headed,
          action,
          selector,
          targetText,
          expectedText,
          beforeText: click.beforeText || "",
          afterText,
          matched,
          consoleErrors,
        };
      } catch (error) {
        return {
          available: false,
          code: error && error.code ? String(error.code) : "browser_interaction_failed",
          message: error instanceof Error ? error.message : String(error),
          url: checked.url,
        };
      } finally {
        if (client) {
          try { client.close(); } catch {}
        }
        if (child && !child.killed) {
          try { child.kill("SIGTERM"); } catch {}
        }
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
      }
    },
  };
}

function locateExpression(selector, targetText) {
  return `(() => {
    const selector = ${JSON.stringify(String(selector || ""))};
    const targetText = ${JSON.stringify(String(targetText || ""))};
    const label = (el) => String(el && (el.innerText || el.value || el.textContent) || "").trim();
    let el = selector ? document.querySelector(selector) : null;
    if (!el && targetText) {
      const candidates = Array.from(document.querySelectorAll("button, a, [role=button], input[type=button], input[type=submit]"));
      el = candidates.find((candidate) => label(candidate) === targetText)
        || candidates.find((candidate) => label(candidate).includes(targetText));
    }
    if (!el) return { ok: false, code: "browser_target_not_found", message: "No matching clickable element was found." };
    if (typeof el.click !== "function") return { ok: false, code: "browser_target_not_clickable", message: "The matching element is not clickable." };
    el.scrollIntoView({ block: "center", inline: "center" });
    el.setAttribute("data-codeme-interaction-target", "true");
    const box = el.getBoundingClientRect();
    return {
      ok: true,
      beforeText: label(el),
      tagName: String(el.tagName || "").toLowerCase(),
      x: box.x + (box.width / 2),
      y: box.y + (box.height / 2),
    };
  })()`;
}

function clickExpression(selector, targetText) {
  return `(() => {
    const found = ${locateExpression(selector, targetText).replace(/;$/, "")};
    if (!found || !found.ok) return found;
    const el = document.querySelector("[data-codeme-interaction-target=true]");
    if (!el || typeof el.click !== "function") return { ok: false, code: "browser_target_not_clickable", message: "The matching element is not clickable." };
    el.click();
    return found;
  })()`;
}

async function performVisibleClick(client, selector, targetText) {
  const found = await client.evaluate(locateExpression(selector, targetText));
  if (!found || !found.ok) return found;
  const x = Number(found.x);
  const y = Number(found.y);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    try {
      await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await delay(80);
      await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
      return found;
    } catch {
      // Fall back to a DOM click if the visible pointer event is blocked.
    }
  }
  return client.evaluate(clickExpression(selector, targetText));
}

function observeExpression(expectedText) {
  return `(() => {
    const expectedText = ${JSON.stringify(String(expectedText || ""))};
    const el = document.querySelector("[data-codeme-interaction-target=true]");
    const afterText = String(el && (el.innerText || el.value || el.textContent) || "").trim();
    return { afterText, matched: !expectedText || afterText.includes(expectedText) };
  })()`;
}

function collectBrowserError(message, errors) {
  if (!message || !message.method) return;
  let text = "";
  if (message.method === "Runtime.exceptionThrown") {
    const details = message.params && message.params.exceptionDetails;
    text = details && (details.text || (details.exception && details.exception.description)) || "Uncaught browser exception";
  } else if (message.method === "Runtime.consoleAPICalled") {
    if (!message.params || message.params.type !== "error") return;
    const args = message.params.args || [];
    text = args.map((item) => item.value !== undefined ? String(item.value) : String(item.description || "")).join(" ");
  } else if (message.method === "Log.entryAdded") {
    const entry = message.params && message.params.entry;
    if (!entry || entry.level !== "error") return;
    if (/favicon\.ico(?:\?|$)/i.test(String(entry.url || ""))) return;
    text = entry.text || "";
  }
  text = String(text || "").trim();
  if (text && !errors.includes(text)) errors.push(text.slice(0, 2000));
}

async function waitForDevTools(profile, child, timeoutMs) {
  const file = path.join(profile, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw Object.assign(new Error(`The browser exited before automation started (exit ${child.exitCode}).`), { code: "browser_driver_failed" });
    }
    try {
      const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
      const port = Number(lines[0]);
      if (port > 0) return { port, browserPath: lines[1] || "" };
    } catch {}
    await delay(80);
  }
  throw Object.assign(new Error("Timed out waiting for the browser automation endpoint."), { code: "browser_driver_timeout" });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 2500 }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "[]"));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("timeout", () => {
      req.destroy();
      reject(Object.assign(new Error("Browser automation endpoint timed out."), { code: "browser_driver_timeout" }));
    });
    req.on("error", reject);
  });
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      const timer = setTimeout(() => reject(Object.assign(new Error("Could not connect to the browser."), { code: "browser_driver_timeout" })), 5000);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(Object.assign(new Error("Browser automation connection failed."), { code: "browser_driver_failed" }));
      }, { once: true });
      socket.addEventListener("message", (event) => this.handleMessage(event.data));
      socket.addEventListener("close", () => {
        for (const pending of this.pending.values()) pending.reject(new Error("Browser automation connection closed."));
        this.pending.clear();
      });
    });
  }

  handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(String(raw || ""));
    } catch {
      return;
    }
    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || "CDP command failed"));
      else pending.resolve(message.result || {});
      return;
    }
    for (const listener of this.listeners) {
      try { listener(message); } catch {}
    }
  }

  onEvent(listener) {
    this.listeners.push(listener);
  }

  send(method, params = {}) {
    if (!this.socket || this.socket.readyState !== 1) {
      return Promise.reject(Object.assign(new Error("Browser automation is not connected."), { code: "browser_driver_failed" }));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error(`Browser command timed out: ${method}`), { code: "browser_driver_timeout" }));
      }, 5000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw Object.assign(new Error(result.exceptionDetails.text || "Browser evaluation failed."), { code: "browser_runtime_error" });
    }
    return result.result ? result.result.value : undefined;
  }

  close() {
    if (this.socket) this.socket.close();
  }
}

async function waitForObservedResult(client, expectedText, timeoutMs) {
  const deadline = Date.now() + Math.max(0, Number(timeoutMs || 0));
  let observed = await client.evaluate(observeExpression(expectedText));
  if (!expectedText) {
    if (timeoutMs > 0) await delay(timeoutMs);
    return await client.evaluate(observeExpression(expectedText));
  }
  while (Date.now() < deadline) {
    if (observed && observed.matched) return observed;
    await delay(80);
    observed = await client.evaluate(observeExpression(expectedText));
  }
  return observed;
}

async function waitForDocumentReady(client, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await client.evaluate("document.readyState");
    if (state === "complete" || state === "interactive") return true;
    await delay(80);
  }
  throw Object.assign(new Error("The page did not finish loading for interaction verification."), { code: "browser_driver_timeout" });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  browserCandidates,
  findBrowserExecutable,
  validateLocalUrl,
  locateExpression,
  clickExpression,
  observeExpression,
  collectBrowserError,
  waitForObservedResult,
  createBrowserInteractionRunner,
};
