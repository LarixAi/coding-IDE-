const http = require("http");
const { PaperclipApi, PaperclipController } = require("../../packages/paperclip-control");

function envFlag(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

class PaperclipBridge {
  constructor(options = {}) {
    if (!options.session) throw new Error("PaperclipBridge requires a CodeMe session");
    this.session = options.session;
    this.enabled = options.enabled ?? envFlag(process.env.CODEME_PAPERCLIP_ENABLED, false);
    this.host = options.host || "127.0.0.1";
    this.port = Number(options.port || process.env.CODEME_PAPERCLIP_PORT || 7788);
    this.bridgeToken = String(options.bridgeToken || process.env.CODEME_PAPERCLIP_BRIDGE_TOKEN || "");
    this.api = options.api || new PaperclipApi({
      baseUrl: options.paperclipApiUrl || process.env.PAPERCLIP_API_URL,
      apiKey: options.paperclipApiKey || process.env.PAPERCLIP_API_KEY,
    });
    this.controller = options.controller || new PaperclipController({
      session: this.session,
      api: this.api,
      pollMs: options.pollMs,
      repeatThreshold: options.repeatThreshold,
      maxRunMs: options.maxRunMs,
    });
    this.server = null;
    this.started = false;
  }

  configured() {
    return Boolean(this.bridgeToken && this.api.apiKey);
  }

  status() {
    return {
      enabled: this.enabled,
      configured: this.configured(),
      started: this.started,
      host: this.host,
      port: this.port,
      controller: this.controller.snapshot(),
      reason: !this.enabled
        ? "disabled"
        : !this.bridgeToken
          ? "bridge_token_missing"
          : !this.api.apiKey
            ? "paperclip_api_key_missing"
            : "",
    };
  }

  async start() {
    if (!this.enabled || this.started) return this.status();
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        this.server.removeListener("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.removeListener("error", onError);
        resolve();
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(this.port, this.host);
    });
    this.started = true;
    console.log(
      "CodeMe Paperclip bridge listening on http://" + this.host + ":" + this.port +
      (this.configured() ? "" : " (configuration incomplete)"),
    );
    return this.status();
  }

  async handle(req, res) {
    const url = new URL(req.url || "/", "http://" + this.host + ":" + this.port);
    if (req.method === "GET" && url.pathname === "/healthz") {
      return sendJson(res, 200, { status: "ok", paperclip: this.status() });
    }

    if (req.method === "POST" && url.pathname === "/paperclip/heartbeat") {
      if (!this.configured()) {
        return sendJson(res, 503, {
          ok: false,
          code: "paperclip_not_configured",
          message: "Set CODEME_PAPERCLIP_BRIDGE_TOKEN and PAPERCLIP_API_KEY before accepting Paperclip work.",
        });
      }
      const token = String(req.headers["x-codeme-paperclip-token"] || "");
      if (!token || !safeEqual(token, this.bridgeToken)) {
        return sendJson(res, 401, { ok: false, code: "unauthorized" });
      }

      let body;
      try {
        body = await readJson(req);
      } catch (error) {
        return sendJson(res, error.statusCode || 400, {
          ok: false,
          code: error.code || "invalid_json",
          message: error.message,
        });
      }

      try {
        const result = await this.controller.handleHeartbeat(body);
        if (result.accepted && result.status === "running") {
          const terminal = await this.controller.waitForCompletion(body.runId);
          return sendJson(res, 200, terminal);
        }
        return sendJson(res, 200, result);
      } catch (error) {
        return sendJson(res, error.statusCode || 500, {
          ok: false,
          code: error.code || "paperclip_bridge_error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    sendJson(res, 404, { ok: false, code: "not_found" });
  }

  dispose() {
    this.controller.dispose();
    if (this.server) {
      try { this.server.close(); } catch {}
    }
    this.server = null;
    this.started = false;
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        const error = new Error("Request body is too large");
        error.code = "body_too_large";
        error.statusCode = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch {
        const error = new Error("Request body must be valid JSON");
        error.code = "invalid_json";
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && require("crypto").timingSafeEqual(a, b);
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.setHeader("content-length", Buffer.byteLength(payload));
  res.end(payload);
}

module.exports = { PaperclipBridge, envFlag, readJson, safeEqual };
