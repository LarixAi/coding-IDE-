#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { parseEnvText } = require("../extensions/codeme-shell/runtime-config");

const TEAM = [
  {
    key: "cto",
    name: "CodeMe CTO",
    role: "engineer",
    title: "CTO Agent",
    capabilities: "Plans architecture, decomposes technical work, delegates bounded tasks, and reviews engineering risk.",
    parent: "controller",
    canAssignTasks: true,
  },
  {
    key: "research",
    name: "CodeMe Research Agent",
    role: "general",
    title: "Research Agent",
    capabilities: "Researches current documentation and external evidence through CodeMe/n8n without editing source files.",
    parent: "cto",
  },
  {
    key: "developer",
    name: "CodeMe Developer Agent",
    role: "engineer",
    title: "Developer Agent",
    capabilities: "Implements bounded CodeMe workspace changes and verifies the requested result.",
    parent: "cto",
  },
  {
    key: "test",
    name: "CodeMe Test Agent",
    role: "engineer",
    title: "Test Agent",
    capabilities: "Reproduces failures, runs tests and browser verification, and reports evidence without repairing source code.",
    parent: "cto",
  },
  {
    key: "reviewer",
    name: "CodeMe Reviewer Agent",
    role: "engineer",
    title: "Reviewer Agent",
    capabilities: "Reviews scope, diffs, diagnostics, and verification evidence and rejects unrelated or unverified changes.",
    parent: "cto",
  },
];

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--company-id") result.companyId = argv[++index];
    else if (value === "--controller-agent-id") result.controllerAgentId = argv[++index];
    else if (value === "--api-base") result.apiBase = argv[++index];
    else if (value === "--env-file") result.envFile = argv[++index];
    else if (value === "--dry-run") result.dryRun = true;
    else if (value === "--help" || value === "-h") result.help = true;
    else throw new Error("Unknown argument: " + value);
  }
  return result;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/setup-paperclip-team.js --company-id <id> --controller-agent-id <id>",
    "",
    "Options:",
    "  --api-base <url>       Paperclip API base (default PAPERCLIP_API_URL or http://127.0.0.1:3100)",
    "  --env-file <path>      CodeMe .env file (default project .env)",
    "  --dry-run              Print the desired team without creating/updating agents",
    "",
    "The script never prints agent API tokens. It stores them only in the local .env.",
  ].join("\n");
}

function listFromResponse(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.agents)) return body.agents;
  if (body && Array.isArray(body.items)) return body.items;
  if (body && Array.isArray(body.data)) return body.data;
  return [];
}

function shellSingleQuoted(value) {
  const text = String(value);
  if (text.includes("'")) {
    throw new Error("Cannot safely persist a value containing a single quote in .env");
  }
  return "'" + text + "'";
}

function upsertEnv(text, key, value) {
  const lines = String(text || "").split(/\r?\n/);
  const prefix = key + "=";
  let found = false;
  const next = lines.map((line) => {
    if (!found && line.startsWith(prefix)) {
      found = true;
      return prefix + value;
    }
    return line;
  });
  if (!found) next.push(prefix + value);
  return next.join("\n").replace(/\n*$/, "") + "\n";
}

function extractToken(body) {
  if (!body || typeof body !== "object") return "";
  return String(
    body.token
    || body.key && body.key.token
    || body.apiKey
    || body.secret
    || "",
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const root = path.resolve(__dirname, "..");
  const envFile = path.resolve(args.envFile || path.join(root, ".env"));
  const envText = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
  const env = { ...parseEnvText(envText), ...process.env };

  const companyId = String(args.companyId || env.PAPERCLIP_COMPANY_ID || "").trim();
  const controllerAgentId = String(
    args.controllerAgentId || env.PAPERCLIP_CONTROLLER_AGENT_ID || env.PAPERCLIP_AGENT_ID || "",
  ).trim();
  const apiBase = String(args.apiBase || env.PAPERCLIP_API_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
  const bridgeToken = String(env.CODEME_PAPERCLIP_BRIDGE_TOKEN || "");
  const boardApiKey = String(env.PAPERCLIP_BOARD_API_KEY || "");

  if (!companyId) throw new Error("--company-id is required (or set PAPERCLIP_COMPANY_ID)");
  if (!controllerAgentId) throw new Error("--controller-agent-id is required (or set PAPERCLIP_CONTROLLER_AGENT_ID)");
  if (!bridgeToken) throw new Error("CODEME_PAPERCLIP_BRIDGE_TOKEN is missing from .env");

  if (args.dryRun) {
    console.log(JSON.stringify({
      companyId,
      controllerAgentId,
      apiBase,
      team: TEAM.map((item) => ({
        key: item.key,
        name: item.name,
        parent: item.parent,
        canAssignTasks: Boolean(item.canAssignTasks),
      })),
    }, null, 2));
    return;
  }

  async function request(method, pathname, body) {
    const headers = { Accept: "application/json" };
    if (boardApiKey) headers.Authorization = "Bearer " + boardApiKey;
    let payload;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }

    const response = await fetch(apiBase + pathname, {
      method,
      headers,
      body: payload,
    });
    const text = await response.text();
    let parsed = {};
    if (text) {
      try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 2000) }; }
    }
    if (!response.ok) {
      const hint = !boardApiKey && (response.status === 401 || response.status === 403)
        ? " Paperclip denied a board operation. In authenticated mode, set PAPERCLIP_BOARD_API_KEY to a board-scoped token and rerun."
        : "";
      const error = new Error(method + " " + pathname + " returned HTTP " + response.status + "." + hint);
      error.body = parsed;
      throw error;
    }
    return parsed;
  }

  const existingBody = await request("GET", "/api/companies/" + encodeURIComponent(companyId) + "/agents");
  const existingAgents = listFromResponse(existingBody);
  const byName = new Map(existingAgents.map((agent) => [String(agent.name || ""), agent]));

  const resolved = {
    controller: {
      id: controllerAgentId,
      key: "controller",
      name: "CodeMe Controller",
    },
  };

  async function ensureAgent(definition, reportsTo) {
    const adapterConfig = {
      url: "http://127.0.0.1:" + String(env.CODEME_PAPERCLIP_PORT || "7788") + "/paperclip/heartbeat",
      method: "POST",
      headers: {
        "X-CodeMe-Paperclip-Token": bridgeToken,
      },
      timeoutMs: 0,
    };
    const payload = {
      name: definition.name,
      role: definition.role,
      title: definition.title,
      reportsTo,
      capabilities: definition.capabilities,
      adapterType: "http",
      adapterConfig,
      runtimeConfig: {
        heartbeat: {
          enabled: false,
          maxConcurrentRuns: 20,
        },
      },
      metadata: {
        codemeRole: definition.key,
        codemeTeam: "default",
      },
    };

    let agent = byName.get(definition.name);
    if (agent) {
      agent = await request(
        "PATCH",
        "/api/agents/" + encodeURIComponent(agent.id),
        payload,
      );
      console.log("Updated " + definition.name + " (" + agent.id + ")");
    } else {
      agent = await request(
        "POST",
        "/api/companies/" + encodeURIComponent(companyId) + "/agents",
        payload,
      );
      console.log("Created " + definition.name + " (" + agent.id + ")");
    }

    if (definition.canAssignTasks) {
      await request(
        "PATCH",
        "/api/agents/" + encodeURIComponent(agent.id) + "/permissions",
        { canAssignTasks: true },
      );
      console.log("Granted task assignment permission to " + definition.name);
    }

    return {
      id: String(agent.id),
      key: definition.key,
      name: definition.name,
    };
  }

  const ctoDefinition = TEAM.find((item) => item.key === "cto");
  resolved.cto = await ensureAgent(ctoDefinition, controllerAgentId);

  for (const definition of TEAM.filter((item) => item.key !== "cto")) {
    resolved[definition.key] = await ensureAgent(definition, resolved.cto.id);
  }

  let roles = {};
  let keys = {};
  try { roles = JSON.parse(env.CODEME_PAPERCLIP_AGENT_ROLES_JSON || "{}"); } catch {}
  try { keys = JSON.parse(env.CODEME_PAPERCLIP_AGENT_KEYS_JSON || "{}"); } catch {}

  roles[controllerAgentId] = "controller";
  if (env.PAPERCLIP_API_KEY) keys[controllerAgentId] = env.PAPERCLIP_API_KEY;

  async function ensureAgentKey(agent) {
    if (keys[agent.id]) return;
    const created = await request(
      "POST",
      "/api/agents/" + encodeURIComponent(agent.id) + "/keys",
      { name: "codeme-bridge-" + agent.key },
    );
    const token = extractToken(created);
    if (!token) {
      throw new Error("Paperclip created a key for " + agent.name + " but did not return its one-time token");
    }
    keys[agent.id] = token;
  }

  if (!keys[controllerAgentId]) {
    const created = await request(
      "POST",
      "/api/agents/" + encodeURIComponent(controllerAgentId) + "/keys",
      { name: "codeme-bridge-controller" },
    );
    const token = extractToken(created);
    if (!token) throw new Error("Paperclip did not return the controller key token");
    keys[controllerAgentId] = token;
  }

  for (const definition of TEAM) {
    const agent = resolved[definition.key];
    roles[agent.id] = definition.key;
    await ensureAgentKey(agent);
  }

  let nextEnv = envText;
  nextEnv = upsertEnv(nextEnv, "PAPERCLIP_CONTROLLER_AGENT_ID", controllerAgentId);
  if (!env.PAPERCLIP_API_KEY) {
    nextEnv = upsertEnv(nextEnv, "PAPERCLIP_API_KEY", shellSingleQuoted(keys[controllerAgentId]));
  }
  nextEnv = upsertEnv(
    nextEnv,
    "CODEME_PAPERCLIP_AGENT_ROLES_JSON",
    shellSingleQuoted(JSON.stringify(roles)),
  );
  nextEnv = upsertEnv(
    nextEnv,
    "CODEME_PAPERCLIP_AGENT_KEYS_JSON",
    shellSingleQuoted(JSON.stringify(keys)),
  );

  fs.writeFileSync(envFile, nextEnv, { mode: 0o600 });

  console.log("");
  console.log("Paperclip CodeMe team ready:");
  console.log("  controller  " + controllerAgentId);
  for (const definition of TEAM) {
    console.log("  " + definition.key.padEnd(11) + resolved[definition.key].id);
  }
  console.log("");
  console.log("Agent API tokens were written to " + envFile + " and were not printed.");
  console.log("Restart CodeMe so the bridge loads the new multi-agent registry.");
}

main().catch((error) => {
  console.error("Paperclip team setup failed:", error && error.message ? error.message : error);
  if (error && error.body) console.error(JSON.stringify(error.body, null, 2));
  process.exit(1);
});
