const ROLE_POLICIES = Object.freeze({
  controller: Object.freeze({
    key: "controller",
    label: "CodeMe Controller",
    mode: "code",
    deniedTools: [],
    instructions: [
      "Coordinate the assigned task and keep scope bounded.",
      "Preserve CodeMe's currently selected model; never select, pin, rank, or route a model.",
      "Use verification evidence before reporting completion.",
      "If a worker-specific task would be safer or clearer, report that handoff need instead of inventing work outside this task.",
    ],
  }),
  cto: Object.freeze({
    key: "cto",
    label: "CTO Agent",
    mode: "ask",
    deniedTools: [],
    instructions: [
      "Act as a technical planner and architecture reviewer.",
      "Do not edit source files or implement the task yourself.",
      "Break complex work into bounded implementation, research, test, and review responsibilities.",
      "Identify dependencies, risks, acceptance criteria, and the next concrete owner.",
    ],
  }),
  research: Object.freeze({
    key: "research",
    label: "Research Agent",
    mode: "ask",
    deniedTools: [],
    instructions: [
      "Research only what the assigned task requires.",
      "Do not edit source files.",
      "Prefer current evidence from the configured n8n/research capabilities when external knowledge is required.",
      "Return concise findings, source/evidence context, and implementation implications for the developer.",
    ],
  }),
  developer: Object.freeze({
    key: "developer",
    label: "Developer Agent",
    mode: "code",
    deniedTools: [],
    instructions: [
      "Own implementation for the assigned task only.",
      "Make the smallest sufficient workspace change and verify it.",
      "If verification disproves a file-edit hypothesis, revert any now-unnecessary edit before completion.",
      "Do not leave unrelated or superseded changes in the workspace.",
    ],
  }),
  test: Object.freeze({
    key: "test",
    label: "Test Agent",
    mode: "code",
    deniedTools: ["file.write", "file.patch", "dir.create", "terminal.run"],
    instructions: [
      "Own verification and reproduction, not implementation.",
      "Do not write, patch, create, or delete source files.",
      "Use diagnostics, sandbox/tests, the owned preview process, and browser verification to gather evidence.",
      "If the product is wrong, report the exact failure and block; do not repair the implementation.",
    ],
  }),
  reviewer: Object.freeze({
    key: "reviewer",
    label: "Reviewer Agent",
    mode: "ask",
    deniedTools: [],
    instructions: [
      "Review the requested scope, working-tree diff, diagnostics, and verification evidence.",
      "Do not edit source files or silently repair defects.",
      "Reject unrelated, duplicate, or superseded changes and identify exactly what must be corrected.",
      "Approve only when the requested outcome is supported by verification evidence.",
    ],
  }),
});

function normalizeRoleKey(value) {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return "controller";
  const aliases = {
    ceo: "controller",
    codeme: "controller",
    "codeme-controller": "controller",
    chief_technology_officer: "cto",
    chieftechnologyofficer: "cto",
    researcher: "research",
    qa: "test",
    tester: "test",
    review: "reviewer",
    engineer: "developer",
    dev: "developer",
  };
  return aliases[key] || key;
}

function rolePolicy(value) {
  const key = normalizeRoleKey(value);
  return ROLE_POLICIES[key] || ROLE_POLICIES.controller;
}

function parseJsonObject(value, label) {
  if (value == null || String(value).trim() === "") return {};
  let parsed;
  try {
    parsed = JSON.parse(String(value));
  } catch {
    const error = new Error(label + " must be valid JSON");
    error.code = "paperclip_agent_config_invalid";
    error.statusCode = 503;
    throw error;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const error = new Error(label + " must be a JSON object");
    error.code = "paperclip_agent_config_invalid";
    error.statusCode = 503;
    throw error;
  }
  return parsed;
}

class PaperclipAgentRegistry {
  constructor(options = {}) {
    this.defaultApiKey = String(options.defaultApiKey || process.env.PAPERCLIP_API_KEY || "");
    this.controllerAgentId = String(
      options.controllerAgentId || process.env.PAPERCLIP_CONTROLLER_AGENT_ID || "",
    ).trim();
    this.roles = options.roles || parseJsonObject(
      options.rolesJson !== undefined
        ? options.rolesJson
        : process.env.CODEME_PAPERCLIP_AGENT_ROLES_JSON,
      "CODEME_PAPERCLIP_AGENT_ROLES_JSON",
    );
    this.keys = options.keys || parseJsonObject(
      options.keysJson !== undefined
        ? options.keysJson
        : process.env.CODEME_PAPERCLIP_AGENT_KEYS_JSON,
      "CODEME_PAPERCLIP_AGENT_KEYS_JSON",
    );
    this.strict = Object.keys(this.roles).length > 0;
  }

  resolve(agentId) {
    const id = String(agentId || "").trim();
    if (!id) {
      const error = new Error("Paperclip heartbeat is missing agentId");
      error.code = "invalid_heartbeat";
      error.statusCode = 400;
      throw error;
    }

    if (this.strict && !Object.prototype.hasOwnProperty.call(this.roles, id)) {
      const error = new Error("Paperclip agent is not registered with the CodeMe bridge");
      error.code = "paperclip_agent_not_registered";
      error.statusCode = 403;
      throw error;
    }

    const configuredRole = normalizeRoleKey(this.roles[id] || "controller");
    if (this.strict && !Object.prototype.hasOwnProperty.call(ROLE_POLICIES, configuredRole)) {
      const error = new Error("Paperclip agent has an unknown CodeMe role: " + configuredRole);
      error.code = "paperclip_agent_role_invalid";
      error.statusCode = 503;
      throw error;
    }
    const role = ROLE_POLICIES[configuredRole] || ROLE_POLICIES.controller;
    const mappedKey = String(this.keys[id] || "");
    const controllerFallback = !this.controllerAgentId || id === this.controllerAgentId;
    const apiKey = mappedKey || (controllerFallback ? this.defaultApiKey : "");

    if (!apiKey) {
      const error = new Error(
        "No Paperclip API key is configured for " + role.label + " (" + id + ")",
      );
      error.code = "paperclip_agent_key_missing";
      error.statusCode = 503;
      throw error;
    }

    return {
      agentId: id,
      role,
      apiKey,
    };
  }

  hasCredential() {
    if (this.defaultApiKey) return true;
    return Object.values(this.keys).some((value) => Boolean(String(value || "")));
  }

  summary() {
    const ids = Object.keys(this.roles);
    if (!ids.length) {
      return {
        mode: "legacy-single-agent",
        agents: [],
      };
    }
    return {
      mode: "multi-agent",
      agents: ids.map((agentId) => {
        const role = rolePolicy(this.roles[agentId]);
        const controllerFallback = !this.controllerAgentId || agentId === this.controllerAgentId;
        return {
          agentId,
          role: role.key,
          label: role.label,
          mode: role.mode,
          configured: Boolean(this.keys[agentId] || (controllerFallback && this.defaultApiKey)),
        };
      }),
    };
  }
}

function deniedToolUse(tools, policy) {
  const denied = new Set((policy && policy.deniedTools) || []);
  if (!denied.size) return null;
  const history = Array.isArray(tools) ? tools : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const tool = history[index];
    if (tool && denied.has(String(tool.name || ""))) {
      return {
        name: String(tool.name || ""),
        status: String(tool.status || ""),
        args: tool.args && typeof tool.args === "object" ? tool.args : {},
      };
    }
  }
  return null;
}

module.exports = {
  ROLE_POLICIES,
  PaperclipAgentRegistry,
  deniedToolUse,
  normalizeRoleKey,
  parseJsonObject,
  rolePolicy,
};
