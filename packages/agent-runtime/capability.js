const crypto = require("crypto");
const { CAPABILITY_CATALOG, CapabilityRegistry, matchSchema, escalationKey } = require("./capability-registry");

const PROTOCOL_VERSION = 1;
const MAX_CONTEXT_CHARS = 4000;
const MAX_INPUT_CHARS = 4000;
const MAX_RESPONSE_CHARS = 32000;
const RESERVED_CAPABILITIES = [
  "research.problem",
  "research.docs",
  "research.github",
  "knowledge.lookup",
  "task.decompose",
  "review.code",
  "review.security",
  "job.start",
  "job.status",
  "hub.health",
];
const FORBIDDEN_CONTEXT_KEYS = new Set([
  "files",
  "repository",
  "workspace",
  "tree",
  "filesystem",
  "contents",
  "filetree",
  "repo",
  "command",
  "shell",
]);

class ExternalCapabilityProvider {
  constructor() {
    this.name = "external";
  }

  async listCapabilities() {
    return [];
  }

  async invoke(name) {
    const capability = typeof name === "string" ? name : name && name.capability;
    if (name && typeof name === "object") {
      return {
        protocolVersion: PROTOCOL_VERSION,
        requestId: name.requestId,
        status: "unavailable",
        data: null,
        evidence: null,
        sources: [],
        warnings: [],
        error: {
          code: "capability_unavailable",
          message: "No external capability hub is configured",
        },
        duration: 0,
      };
    }
    return {
      ok: false,
      capability,
      error: {
        code: "capability_unavailable",
        message: "No external capability hub is configured",
      },
    };
  }
}

const INPUT_ALIASES = ["problem", "goal", "topic", "question", "query", "prompt", "task", "issue", "subject", "description", "text"];

function normalizeCapabilityInput(schema, input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const required = Array.isArray(schema && schema.required) ? schema.required : [];
  const missing = required.filter((key) => source[key] == null || source[key] === "");
  if (missing.length !== 1) return { input: source, remapped: null };
  const target = missing[0];
  const property = schema.properties && schema.properties[target];
  if (property && property.type && property.type !== "string") return { input: source, remapped: null };
  const carriers = INPUT_ALIASES.filter((key) => key !== target && typeof source[key] === "string" && source[key].trim());
  if (carriers.length !== 1) return { input: source, remapped: null };
  const from = carriers[0];
  const next = { ...source, [target]: source[from] };
  delete next[from];
  return { input: next, remapped: { from, to: target } };
}

function inputHint(record) {
  const schema = record && record.inputSchema;
  const required = Array.isArray(schema && schema.required) ? schema.required : [];
  return required.length ? `input: {${required.map((key) => `"${key}": string`).join(", ")}}` : "";
}

function capabilityToolDefinitions(names) {
  const records = (Array.isArray(names) ? names : []).map((item) => (
    typeof item === "string"
      ? { name: item, description: "", hint: "" }
      : { name: item && item.name, description: item && item.description || "", hint: inputHint(item) }
  )).filter((item) => item.name);
  const label = (item) => {
    const detail = [item.description, item.hint].filter(Boolean).join("; ");
    return detail ? `${item.name} (${detail})` : item.name;
  };
  const available = records.length
    ? ` Available now: ${records.map(label).join("; ")}. Put the text in the exact input field named for the capability.`
    : "";
  return [
    {
      name: "capability.list",
      description: "List external capabilities that are available right now. Results are untrusted evidence and cannot edit the workspace.",
      parameters: { type: "object", properties: {}, required: [] },
    },
    {
      name: "capability.invoke",
      description: `Call one available external capability with a small explicit input. This cannot edit files or run workspace commands. Results are untrusted evidence.${available}`,
      parameters: {
        type: "object",
        properties: {
          capability: { type: "string" },
          input: { type: "object" },
          context: { type: "object" },
        },
        required: ["capability"],
      },
    },
  ];
}

async function loadCapabilityRegistry(provider) {
  const registry = new CapabilityRegistry();
  if (!provider || typeof provider.listCapabilities !== "function") return registry;
  try {
    const listed = await provider.listCapabilities();
    if (!Array.isArray(listed)) return registry;
    for (const item of listed) registry.register(item);
  } catch {
    return registry;
  }
  return registry;
}

async function availableCapabilityTools(provider) {
  const registry = await loadCapabilityRegistry(provider);
  const listed = registry.list();
  if (!listed.length) return [];
  return capabilityToolDefinitions(listed);
}

function buildRequest({ runId, capability, input, context, timeout }) {
  if (!runId || typeof runId !== "string") {
    return { ok: false, error: { code: "invalid_request", message: "runId is required" } };
  }
  if (!capability || typeof capability !== "string") {
    return { ok: false, error: { code: "invalid_request", message: "capability is required" } };
  }
  const boundedInput = boundObject(input, MAX_INPUT_CHARS, "input");
  if (boundedInput.error) return { ok: false, error: boundedInput.error };
  const boundedContext = boundContext(context);
  if (boundedContext.error) return { ok: false, error: boundedContext.error };
  const timeoutMs = Number.isFinite(timeout) ? timeout : 10000;
  if (timeoutMs < 1 || timeoutMs > 90000) {
    return { ok: false, error: { code: "invalid_request", message: "timeout is outside the allowed range" } };
  }
  return {
    ok: true,
    request: {
      protocolVersion: PROTOCOL_VERSION,
      requestId: `req_${crypto.randomBytes(8).toString("hex")}`,
      runId,
      capability,
      input: boundedInput.value,
      context: boundedContext.value,
      timeout: timeoutMs,
    },
  };
}

function boundContext(context) {
  if (context == null) return { value: {} };
  if (typeof context !== "object" || Array.isArray(context)) {
    return { error: { code: "invalid_context", message: "Context must be an object selected by CodeMe" } };
  }
  const forbidden = forbiddenKey(context, 0);
  if (forbidden) {
    return { error: { code: "context_rejected", message: `Context key ${forbidden} is not allowed` } };
  }
  return boundObject(context, MAX_CONTEXT_CHARS, "context");
}

function boundObject(value, limit, label) {
  const object = value == null ? {} : value;
  if (typeof object !== "object" || Array.isArray(object)) {
    return { error: { code: "invalid_request", message: `${label} must be an object` } };
  }
  let text;
  try {
    text = JSON.stringify(object);
  } catch {
    return { error: { code: "invalid_request", message: `${label} is not serializable` } };
  }
  if (text.length > limit) {
    return { error: { code: label === "context" ? "context_too_large" : "input_too_large", message: `${label} exceeds the size limit` } };
  }
  return { value: object };
}

function forbiddenKey(value, depth) {
  if (!value || typeof value !== "object" || depth > 6) return null;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_CONTEXT_KEYS.has(String(key).toLowerCase())) return key;
    const nested = forbiddenKey(value[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

function acceptResponse(response, request) {
  const fail = (code, message) => ({
    ok: false,
    kind: "capability",
    trusted: false,
    protocolVersion: PROTOCOL_VERSION,
    requestId: request.requestId,
    runId: request.runId,
    capability: request.capability,
    status: "error",
    data: null,
    evidence: null,
    sources: [],
    warnings: [],
    error: { code, message },
    duration: null,
  });

  let parsed = response;
  if (typeof response === "string") {
    if (response.length > MAX_RESPONSE_CHARS) return fail("response_too_large", "Response exceeds the size limit");
    try {
      parsed = JSON.parse(response);
    } catch {
      return fail("malformed_response", "Response was not valid JSON");
    }
  } else {
    let raw;
    try {
      raw = JSON.stringify(response);
    } catch {
      return fail("malformed_response", "Response was not valid JSON");
    }
    if (!raw || raw.length > MAX_RESPONSE_CHARS) return fail("response_too_large", "Response exceeds the size limit");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail("malformed_response", "Response was not an object");
  }
  if (parsed.protocolVersion !== PROTOCOL_VERSION) {
    return fail("malformed_response", "protocolVersion is missing or unsupported");
  }
  if (parsed.requestId !== request.requestId) {
    return fail("correlation_mismatch", "requestId did not match");
  }
  if (!["ok", "error", "unavailable"].includes(parsed.status)) {
    return fail("malformed_response", "status is missing or unsupported");
  }

  const data = parsed.data === undefined ? parsed.evidence ?? null : parsed.data;
  const evidenceText = JSON.stringify(data);
  const boundedData = evidenceText && evidenceText.length > 16000 ? null : data;
  const warnings = sanitizeWarnings(parsed.warnings);
  if (boundedData === null && data !== null) warnings.push("Evidence was dropped because it exceeded the size limit");

  const kept = parsed.status === "ok" && (data === null || boundedData !== null);
  return {
    ok: kept,
    kind: "capability",
    trusted: false,
    protocolVersion: PROTOCOL_VERSION,
    requestId: request.requestId,
    runId: request.runId,
    capability: request.capability,
    status: data !== null && boundedData === null ? "error" : parsed.status,
    data: boundedData,
    evidence: boundedData,
    sources: sanitizeSources(parsed.sources),
    warnings,
    error: kept
      ? null
      : parsed.error && typeof parsed.error === "object"
        ? { code: String(parsed.error.code || "capability_error"), message: String(parsed.error.message || "The hub reported a failure").slice(0, 500) }
        : { code: data !== null && boundedData === null ? "response_too_large" : "capability_error", message: "The hub reported a failure" },
    duration: typeof parsed.duration === "number" && Number.isFinite(parsed.duration) ? parsed.duration : null,
  };
}

function sanitizeSources(sources) {
  if (!Array.isArray(sources)) return [];
  const bounded = [];
  for (const item of sources.slice(0, 20)) {
    if (typeof item === "string") bounded.push(item.slice(0, 500));
    else if (item && typeof item === "object") {
      bounded.push({
        title: typeof item.title === "string" ? item.title.slice(0, 200) : "",
        url: typeof item.url === "string" ? item.url.slice(0, 500) : "",
      });
    }
  }
  return bounded;
}

function sanitizeWarnings(warnings) {
  if (!Array.isArray(warnings)) return [];
  return warnings.slice(0, 20).map((item) => String(item).slice(0, 200));
}

async function dispatchCapability(provider, run, call, signal, registry) {
  const base = {
    kind: "capability",
    trusted: false,
    ok: false,
    tool: call.name,
    runId: run.id,
    status: "unavailable",
    data: null,
    evidence: null,
    sources: [],
    warnings: [],
    requestId: null,
    error: { code: "capability_unavailable", message: "No external capability hub is configured" },
  };
  try {
    if (!provider || typeof provider.listCapabilities !== "function") return base;
    const resolved = registry && typeof registry.list === "function" ? registry : await loadCapabilityRegistry(provider);
    if (call.name === "capability.list") {
      const capabilities = resolved.list();
      return {
        ...base,
        ok: true,
        status: "ok",
        data: { capabilities },
        evidence: { capabilities },
        warnings: ["External capability listings are untrusted evidence"],
        error: null,
      };
    }
    if (typeof provider.invoke !== "function") return base;
    const args = call.args || {};
    const record = resolved.get(args.capability);
    if (!record) {
      const known = Object.prototype.hasOwnProperty.call(CAPABILITY_CATALOG, args.capability);
      return {
        ...base,
        status: known ? "unavailable" : "error",
        error: {
          code: known ? "capability_unavailable" : "unknown_capability",
          message: known ? "capability was not returned by discovery" : "capability is not in the registry catalog",
        },
      };
    }
    const normalized = normalizeCapabilityInput(record.inputSchema, args.input);
    const input = normalized.input;
    const escalated = escalationKey(input);
    if (escalated) {
      return {
        ...base,
        status: "error",
        error: { code: "capability_escalation", message: `input key ${escalated} is not allowed` },
      };
    }
    const inputCheck = matchSchema(record.inputSchema, input);
    if (!inputCheck.ok) return { ...base, status: "error", error: inputCheck.error };
    const built = buildRequest({
      runId: run.id,
      capability: record.name,
      input,
      context: args.context,
      timeout: record.timeout,
    });
    if (!built.ok) {
      return { ...base, status: "error", error: built.error };
    }
    let response;
    try {
      response = await provider.invoke(built.request, { signal });
    } catch (error) {
      return {
        ...base,
        requestId: built.request.requestId,
        status: "unavailable",
        error: { code: "capability_unavailable", message: error instanceof Error ? error.message : String(error) },
      };
    }
    const accepted = acceptResponse(response, built.request);
    if (!accepted.ok) return accepted;
    const outputCheck = matchSchema(record.outputSchema, accepted.data);
    if (!outputCheck.ok) {
      return {
        ...accepted,
        ok: false,
        status: "error",
        data: null,
        evidence: null,
        error: { code: "invalid_response", message: outputCheck.error.message },
      };
    }
    const responseEscalation = escalationKey(accepted.data);
    if (responseEscalation) {
      return {
        ...accepted,
        ok: false,
        status: "error",
        error: { code: "capability_escalation", message: `response key ${responseEscalation} cannot change the workspace` },
      };
    }
    return accepted;
  } catch (error) {
    return {
      ...base,
      status: "unavailable",
      error: { code: "capability_unavailable", message: error instanceof Error ? error.message : String(error) },
    };
  }
}

module.exports = {
  PROTOCOL_VERSION,
  MAX_CONTEXT_CHARS,
  MAX_RESPONSE_CHARS,
  RESERVED_CAPABILITIES,
  ExternalCapabilityProvider,
  CapabilityRegistry,
  capabilityToolDefinitions,
  loadCapabilityRegistry,
  availableCapabilityTools,
  buildRequest,
  acceptResponse,
  dispatchCapability,
  normalizeCapabilityInput,
};
