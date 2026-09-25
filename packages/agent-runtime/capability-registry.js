const ESCALATION_KEYS = new Set([
  "command",
  "shell",
  "tool",
  "permissions",
  "risk",
  "route",
  "webhook",
  "workflowid",
  "path",
  "file.write",
]);
const PRIVATE_FIELDS = ["route", "webhook", "workflowId", "path", "nodes"];
const ALLOWED_PERMISSIONS = new Set(["evidence", "network"]);

const CAPABILITY_CATALOG = {
  "hub.health": { category: "hub", operational: true },
  "research.problem": { category: "research", operational: true },
  "knowledge.lookup": { category: "knowledge", operational: true },
  "task.decompose": { category: "task", operational: true },
  "research.web": { category: "research", operational: false },
  "research.docs": { category: "research", operational: false },
  "research.github": { category: "research", operational: false },
  "code.lookup": { category: "code", operational: false },
  "code.debug": { category: "code", operational: false },
  "code.review": { category: "code", operational: false },
  "browser.inspect": { category: "browser", operational: false },
  "image.generate": { category: "image", operational: false },
  "deploy.verify": { category: "deploy", operational: false },
  "review.code": { category: "review", operational: false },
  "review.security": { category: "review", operational: false },
  "job.start": { category: "job", operational: false },
  "job.status": { category: "job", operational: false },
};

const OPERATIONAL_DEFAULTS = {
  "hub.health": contractDefaults({
    name: "hub.health",
    description: "Echo a short token and report hub health",
    inputSchema: { type: "object", properties: { echo: { type: "string" } }, required: [] },
    outputSchema: {
      type: "object",
      properties: { health: { type: "string" }, echo: { type: "string" }, marker: { type: "string" } },
      required: ["health"],
    },
    timeout: 10000,
  }),
  "research.problem": contractDefaults({
    name: "research.problem",
    description: "Gather short evidence for a problem. Returns sources and excerpts.",
    inputSchema: { type: "object", properties: { problem: { type: "string" } }, required: ["problem"] },
    outputSchema: { type: "object", properties: { problem: { type: "string" }, confidence: { type: "string" } }, required: [] },
    timeout: 20000,
  }),
  "knowledge.lookup": contractDefaults({
    name: "knowledge.lookup",
    description: "Find a prior note by query, or remember a short note.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, action: { type: "string" }, entry: { type: "object" } },
      required: [],
    },
    outputSchema: { type: "object", properties: { action: { type: "string" } }, required: [] },
    timeout: 10000,
  }),
  "task.decompose": contractDefaults({
    name: "task.decompose",
    description: "Split a large goal into a bounded task graph.",
    inputSchema: { type: "object", properties: { goal: { type: "string" }, problem: { type: "string" } }, required: [] },
    outputSchema: { type: "object", properties: { project: { type: "string" } }, required: [] },
    timeout: 30000,
  }),
};

function contractDefaults(fields) {
  return {
    description: fields.description,
    category: CAPABILITY_CATALOG[fields.name].category,
    inputSchema: fields.inputSchema,
    outputSchema: fields.outputSchema,
    permissions: ["evidence"],
    risk: "read",
    timeout: fields.timeout,
    availability: "available",
    health: "ok",
    provider: "external",
    version: 1,
  };
}

class CapabilityRegistry {
  constructor() {
    this.records = new Map();
  }

  register(raw) {
    const checked = normalizeRecord(raw);
    if (!checked.ok) return checked;
    this.records.set(checked.record.name, checked.record);
    return checked;
  }

  list() {
    return [...this.records.values()].map(publicContract);
  }

  get(name) {
    return this.records.get(name) || null;
  }
}

function normalizeRecord(raw) {
  const name = typeof raw === "string" ? raw : raw && raw.name;
  if (!name || typeof name !== "string") {
    return fail("malformed_schema", "capability name is missing");
  }
  const spec = CAPABILITY_CATALOG[name];
  if (!spec) return fail("unknown_capability", "capability is not in the registry catalog");
  if (!spec.operational) return fail("not_operational", "capability has no operational workflow");
  const source = typeof raw === "string" ? { name } : raw;
  if (source.risk !== undefined && source.risk !== "read") return fail("capability_escalation", "risk level is not permitted");
  if (source.permissions !== undefined && !permissionsAllowed(source.permissions)) {
    return fail("capability_escalation", "permissions are not permitted");
  }
  if (source.category !== undefined && source.category !== spec.category) {
    return fail("capability_escalation", "category does not match the registry");
  }
  if (source.inputSchema !== undefined && !isSchema(source.inputSchema)) return fail("malformed_schema", "input schema is malformed");
  if (source.outputSchema !== undefined && !isSchema(source.outputSchema)) return fail("malformed_schema", "output schema is malformed");
  if (source.availability !== undefined && source.availability !== "available") {
    return fail("capability_unavailable", "capability is not available");
  }
  if (source.health !== undefined && source.health !== "ok") return fail("capability_unavailable", "capability is not healthy");
  if (source.provider !== undefined && !/^[a-z0-9_-]{1,40}$/.test(source.provider)) {
    return fail("malformed_schema", "provider is malformed");
  }
  if (source.version !== undefined && source.version !== 1 && source.version !== "1") {
    return fail("malformed_schema", "version is unsupported");
  }
  if (source.timeout !== undefined && (!Number.isFinite(source.timeout) || source.timeout < 1 || source.timeout > 30000)) {
    return fail("malformed_schema", "timeout is outside the allowed range");
  }

  const defaults = OPERATIONAL_DEFAULTS[name];
  const record = {
    name,
    ...defaults,
    ...stripPrivate(source),
    category: spec.category,
    risk: "read",
    permissions: permissionsAllowed(source.permissions) ? source.permissions.slice(0, 4) : defaults.permissions,
    version: 1,
  };
  if (!isSchema(record.inputSchema) || !isSchema(record.outputSchema)) return fail("malformed_schema", "schema is malformed");
  return { ok: true, record };
}

function publicContract(record) {
  return {
    name: record.name,
    description: String(record.description || "").slice(0, 200),
    category: record.category,
    inputSchema: record.inputSchema,
    outputSchema: record.outputSchema,
    permissions: record.permissions,
    risk: record.risk,
    timeout: record.timeout,
    availability: record.availability,
    health: record.health,
    provider: record.provider,
    version: record.version,
  };
}

function stripPrivate(source) {
  const copy = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "name" || PRIVATE_FIELDS.includes(key)) continue;
    copy[key] = value;
  }
  return copy;
}

function permissionsAllowed(permissions) {
  return Array.isArray(permissions) && permissions.length > 0 && permissions.length <= 4 && permissions.every((item) => ALLOWED_PERMISSIONS.has(item));
}

function isSchema(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema) || schema.type !== "object") return false;
  if (schema.properties !== undefined) {
    if (typeof schema.properties !== "object" || Array.isArray(schema.properties)) return false;
    for (const property of Object.values(schema.properties)) {
      if (!property || typeof property !== "object" || !["string", "number", "boolean", "object"].includes(property.type)) return false;
    }
  }
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || schema.required.some((item) => typeof item !== "string")) return false;
  }
  return true;
}

function matchSchema(schema, value) {
  const object = value == null ? {} : value;
  if (typeof object !== "object" || Array.isArray(object)) return fail("invalid_input", "input must be an object");
  for (const key of schema.required || []) {
    if (object[key] == null || object[key] === "") return fail("invalid_input", `${key} is required`);
  }
  for (const [key, property] of Object.entries(schema.properties || {})) {
    if (object[key] == null) continue;
    if (!valueMatches(property.type, object[key])) return fail("invalid_input", `${key} must be a ${property.type}`);
  }
  return { ok: true };
}

function valueMatches(type, value) {
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "object") return typeof value === "object" && !Array.isArray(value);
  return false;
}

function escalationKey(value) {
  if (!value || typeof value !== "object") return null;
  for (const key of Object.keys(value)) {
    if (ESCALATION_KEYS.has(String(key).toLowerCase())) return key;
  }
  return null;
}

function fail(code, message) {
  return { ok: false, error: { code, message } };
}

module.exports = {
  CAPABILITY_CATALOG,
  CapabilityRegistry,
  matchSchema,
  escalationKey,
  isSchema,
};
