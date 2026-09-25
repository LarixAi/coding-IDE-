const http = require("http");
const https = require("https");
const { PROTOCOL_VERSION, RESERVED_CAPABILITIES, MAX_RESPONSE_CHARS, buildRequest, acceptResponse, CapabilityRegistry } = require("../agent-runtime/capability");

const ROUTES = {
  "hub.health": "/webhook/codeme-hub-health",
  "research.problem": "/webhook/codeme-research-problem",
  "knowledge.lookup": "/webhook/codeme-knowledge-lookup",
  "task.decompose": "/webhook/codeme-task-decompose",
};
const DISCOVERY_PATH = "/webhook/codeme-capabilities";

class N8nCapabilityProvider {
  constructor(options = {}) {
    this.name = "external";
    for (const name of Object.keys(ROUTES)) {
      if (!RESERVED_CAPABILITIES.includes(name)) {
        throw new Error(`Capability ${name} is outside the reserved namespace`);
      }
    }
    this.baseUrl = String(options.baseUrl || process.env.CODEME_N8N_URL || "http://127.0.0.1:5678").replace(/\/$/, "");
    this.token = options.token || process.env.CODEME_N8N_TOKEN || "";
    this.retries = options.retries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 200;
    this.logs = [];
  }

  async connectionStatus() {
    try {
      const response = await requestJson({
        baseUrl: this.baseUrl,
        pathname: "/healthz",
        method: "GET",
        timeout: 2000,
        token: "",
      });
      const connected = response.statusCode === 200 && response.json && response.json.status === "ok";
      this.record({ event: "connection", connected, endpoint: this.baseUrl });
      return { connected, endpoint: this.baseUrl };
    } catch (error) {
      this.record({ event: "connection", connected: false, endpoint: this.baseUrl, code: error.code || "unavailable" });
      return { connected: false, endpoint: this.baseUrl };
    }
  }

  async listCapabilities() {
    const built = buildRequest({
      runId: "run_discovery",
      capability: "hub.discover",
      input: {},
      context: {},
      timeout: 5000,
    });
    if (!built.ok) return [];
    try {
      const outcome = await this.post(DISCOVERY_PATH, built.request, { signal: null });
      if (!outcome.ok) return [];
      const accepted = acceptResponse(outcome.body, built.request);
      const listed = accepted.data && Array.isArray(accepted.data.capabilities) ? accepted.data.capabilities : [];
      const registry = new CapabilityRegistry();
      for (const item of listed) {
        const name = typeof item === "string" ? item : item && item.name;
        if (!name || !Object.prototype.hasOwnProperty.call(ROUTES, name)) continue;
        const raw = typeof item === "string" ? { name, provider: "n8n" } : { ...item, provider: item.provider || "n8n" };
        if (typeof raw.route === "string" && raw.route !== ROUTES[name]) continue;
        registry.register(raw);
      }
      return registry.list();
    } catch {
      return [];
    }
  }

  async invoke(request, options = {}) {
    const started = Date.now();
    const invalid = validateRequest(request);
    if (invalid) {
      this.record({ event: "invoke", requestId: request && request.requestId, runId: request && request.runId, capability: request && request.capability, status: "error", code: invalid.code });
      return finish(request, "error", null, invalid, started);
    }
    const pathname = ROUTES[request.capability];
    if (!pathname) {
      const error = { code: "capability_unavailable", message: "This capability is not available" };
      this.record({ event: "invoke", requestId: request.requestId, runId: request.runId, capability: request.capability, status: "unavailable", code: error.code });
      return finish(request, "unavailable", null, error, started);
    }
    try {
      const outcome = await this.post(pathname, request, { signal: options.signal || null });
      const duration = Date.now() - started;
      if (outcome.cancelled) {
        this.record({ event: "invoke", requestId: request.requestId, runId: request.runId, capability: request.capability, status: "error", code: "cancelled", duration });
        return finish(request, "error", null, { code: "cancelled", message: "The capability call was cancelled" }, started);
      }
      if (outcome.timedOut) {
        this.record({ event: "invoke", requestId: request.requestId, runId: request.runId, capability: request.capability, status: "error", code: "timeout", duration });
        return finish(request, "error", null, { code: "timeout", message: "The capability call timed out" }, started);
      }
      if (!outcome.ok) {
        const status = outcome.statusCode === 404 || outcome.statusCode === 410 ? "unavailable" : "error";
        const code = status === "unavailable" ? "capability_unavailable" : "hub_rejected";
        this.record({ event: "invoke", requestId: request.requestId, runId: request.runId, capability: request.capability, status, code, httpStatus: outcome.statusCode, duration });
        return finish(request, status, null, { code, message: "The capability hub rejected the call" }, started);
      }
      if (typeof outcome.body !== "string" || outcome.body.length > MAX_RESPONSE_CHARS) {
        this.record({ event: "invoke", requestId: request.requestId, runId: request.runId, capability: request.capability, status: "error", code: "response_too_large", duration });
        return finish(request, "error", null, { code: "response_too_large", message: "Response exceeds the size limit" }, started);
      }
      let parsed;
      try {
        parsed = JSON.parse(outcome.body);
      } catch {
        this.record({ event: "invoke", requestId: request.requestId, runId: request.runId, capability: request.capability, status: "error", code: "malformed_response", duration });
        return finish(request, "error", null, { code: "malformed_response", message: "Response was not valid JSON" }, started);
      }
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) parsed.duration = duration;
      this.record({
        event: "invoke",
        requestId: request.requestId,
        runId: request.runId,
        capability: request.capability,
        status: parsed && parsed.status,
        duration,
      });
      return parsed;
    } catch (error) {
      const code = error && error.code === "cancelled"
        ? "cancelled"
        : error && error.code === "response_too_large"
          ? "response_too_large"
          : "capability_unavailable";
      const status = code === "capability_unavailable" ? "unavailable" : "error";
      this.record({ event: "invoke", requestId: request.requestId, runId: request.runId, capability: request.capability, status, code });
      return finish(request, status, null, { code, message: this.redact(error instanceof Error ? error.message : String(error)) }, started);
    }
  }

  async post(pathname, request, options) {
    let attempt = 0;
    while (true) {
      attempt += 1;
      try {
        const response = await requestJson({
          baseUrl: this.baseUrl,
          pathname,
          method: "POST",
          body: request,
          timeout: request.timeout,
          token: this.token,
          signal: options.signal,
        });
        if (response.statusCode >= 500 && attempt <= this.retries) {
          this.record({ event: "retry", requestId: request.requestId, runId: request.runId, capability: request.capability, attempt, httpStatus: response.statusCode });
          await wait(this.retryDelayMs, options.signal);
          continue;
        }
        return { ok: response.statusCode >= 200 && response.statusCode < 300, statusCode: response.statusCode, body: response.text };
      } catch (error) {
        if (error && error.code === "cancelled") return { cancelled: true, ok: false };
        if (error && error.code === "timeout") return { timedOut: true, ok: false };
        if (attempt <= this.retries && retryable(error)) {
          this.record({ event: "retry", requestId: request.requestId, runId: request.runId, capability: request.capability, attempt, code: "connection" });
          await wait(this.retryDelayMs, options.signal);
          continue;
        }
        throw error;
      }
    }
  }

  record(entry) {
    const text = this.redact(JSON.stringify(entry));
    this.logs.push(JSON.parse(text));
  }

  redact(text) {
    let out = String(text);
    if (this.token) out = out.split(this.token).join("[redacted]");
    return out;
  }
}

function finish(request, status, data, error, started) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: request && request.requestId,
    status,
    data,
    evidence: data,
    sources: [],
    warnings: [],
    error,
    duration: Date.now() - started,
  };
}

function validateRequest(request) {
  if (!request || typeof request !== "object") return { code: "invalid_request", message: "Request must be an object" };
  if (request.protocolVersion !== PROTOCOL_VERSION) return { code: "invalid_request", message: "protocolVersion is missing or unsupported" };
  for (const key of ["requestId", "runId", "capability"]) {
    if (typeof request[key] !== "string" || !request[key]) return { code: "invalid_request", message: `${key} is required` };
  }
  if (!request.input || typeof request.input !== "object" || Array.isArray(request.input)) return { code: "invalid_request", message: "input must be an object" };
  if (!request.context || typeof request.context !== "object" || Array.isArray(request.context)) return { code: "invalid_request", message: "context must be an object" };
  if (typeof request.timeout !== "number" || request.timeout < 1 || request.timeout > 90000) return { code: "invalid_request", message: "timeout is outside the allowed range" };
  return null;
}

function retryable(error) {
  const code = error && (error.code || error.cause && error.cause.code);
  return code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "EHOSTUNREACH";
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(Object.assign(new Error("cancelled"), { code: "cancelled" }));
      return;
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("cancelled"), { code: "cancelled" }));
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

function requestJson({ baseUrl, pathname, method, body, timeout, token, signal }) {
  const url = new URL(pathname, baseUrl);
  const payload = body === undefined ? null : JSON.stringify(body);
  const transport = url.protocol === "https:" ? https : http;
  const timeoutSignal = AbortSignal.timeout(timeout);
  const signals = [timeoutSignal];
  if (signal) signals.push(signal);
  const combined = AbortSignal.any(signals);
  const headers = { Accept: "application/json" };
  if (payload !== null) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(payload);
  }
  if (token) headers["X-CodeMe-Token"] = token;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    const req = transport.request(url, { method, headers, signal: combined }, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_CHARS + 1) {
          req.destroy();
          finish(reject, Object.assign(new Error("response too large"), { code: "response_too_large" }));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        if (method === "GET") {
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
        }
        finish(resolve, { statusCode: res.statusCode, text, json });
      });
    });
    req.on("error", (error) => {
      if (signal && signal.aborted) {
        finish(reject, Object.assign(new Error("cancelled"), { code: "cancelled" }));
        return;
      }
      if (timeoutSignal.aborted) {
        finish(reject, Object.assign(new Error("timeout"), { code: "timeout" }));
        return;
      }
      finish(reject, error);
    });
    if (payload !== null) req.write(payload);
    req.end();
  });
}

module.exports = { N8nCapabilityProvider, ROUTES, DISCOVERY_PATH };
