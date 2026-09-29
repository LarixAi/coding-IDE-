const http = require("http");
const https = require("https");

class ModelProvider {
  constructor(name) {
    this.name = name;
  }

  async complete() {
    throw Object.assign(new Error(`${this.name} does not implement complete`), { code: "not_implemented" });
  }

  async listModels() {
    return [];
  }
}

const PROVIDER_NAMES = {
  "workspace.inspect": "workspace_inspect",
  "file.read": "file_read",
  "file.write": "file_write",
  "file.patch": "file_patch",
  "repo.search": "repo_search",
  "terminal.run": "terminal_run",
  "sandbox.run": "sandbox_run",
  "process.start": "process_start",
  "process.status": "process_status",
  "process.logs": "process_logs",
  "tests.run": "tests_run",
  "git.status": "git_status",
  "git.diff": "git_diff",
  "diagnostics.run": "diagnostics_run",
  "browser.check": "browser_check",
  "browser.interact": "browser_interact",
  "dir.create": "dir_create",
  "dir.list": "dir_list",
  "capability.list": "capability_list",
  "capability.invoke": "capability_invoke",
};
const CONTRACT_NAMES = Object.fromEntries(Object.entries(PROVIDER_NAMES).map(([contract, provider]) => [provider, contract]));

class OllamaModelProvider extends ModelProvider {
  constructor(options = {}) {
    super("ollama");
    this.baseUrl = options.baseUrl || process.env.CODEME_OLLAMA_URL || "http://127.0.0.1:11434";
    this.timeoutMs = options.timeoutMs || 180000;
  }

  async listModels() {
    try {
      const body = await getJson(this.baseUrl, "/api/tags");
      return (body.models || []).map((model) => {
        const id = String(model && model.name || "");
        return id ? { provider: this.name, id, label: id } : null;
      }).filter(Boolean);
    } catch {
      return [];
    }
  }

  async complete(input) {
    const timeoutMs = input.timeoutMs || this.timeoutMs;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signals = [timeoutSignal];
    if (input.signal) signals.push(input.signal);
    const signal = AbortSignal.any(signals);
    try {
      const toolMode = ollamaToolMode(input.model);
      const response = await postJson(this.baseUrl, "/api/chat", chatBody(input, toolMode), signal);
      const decision = normalizeMessage(response.message || {}, input.tools || []);
      decision.toolMode = toolMode;
      const promptTokens = typeof response.prompt_eval_count === "number" ? response.prompt_eval_count : null;
      const completionTokens = typeof response.eval_count === "number" ? response.eval_count : null;
      if (promptTokens !== null || completionTokens !== null) {
        decision.usage = {
          promptTokens: promptTokens || 0,
          completionTokens: completionTokens || 0,
          total: (promptTokens || 0) + (completionTokens || 0),
        };
      }
      return decision;
    } catch (error) {
      if (input.signal && input.signal.aborted) {
        throw Object.assign(new Error("model call cancelled"), { code: "cancelled" });
      }
      if (timeoutSignal.aborted) {
        throw Object.assign(new Error("model request timed out"), { code: "timeout" });
      }
      const message = error instanceof Error ? error.message : String(error);
      throw Object.assign(new Error(message), { code: "model_disconnected" });
    }
  }
}

function ollamaToolMode(model) {
  const id = String(model || "").trim().toLowerCase();
  // qwen2.5-coder frequently emits tool JSON in message.content rather than
  // Ollama message.tool_calls. Give it one provider-independent system-tool
  // protocol instead of relying on the native tool template.
  if (/^qwen2\.5-coder(?::|$)/.test(id)) return "system";
  return "native";
}

function systemToolProtocol(tools) {
  const available = (tools || []).map((tool) => ({
    name: PROVIDER_NAMES[tool.name] || tool.name,
    description: tool.description || "",
    parameters: tool.parameters || { type: "object", properties: {} },
  }));
  if (!available.length) return "";
  return [
    "CODEME TOOL PROTOCOL:",
    "Use only the tools listed below. When an action is needed, do not describe or simulate it.",
    "Return exactly one or more tool calls using this form and no prose:",
    '<tool_call>{"name":"tool_name","arguments":{"key":"value"}}</tool_call>',
    "Never invent a tool name. Never omit required arguments. Wait for the tool result before claiming success.",
    "AVAILABLE TOOLS:",
    JSON.stringify(available),
  ].join("\n");
}

function messagesForToolMode(input, toolMode) {
  const messages = (input.messages || []).map(toOllamaMessage);
  if (toolMode !== "system" || !(input.tools || []).length) return messages;

  const protocol = systemToolProtocol(input.tools || []);
  const firstSystem = messages.findIndex((message) => message.role === "system");
  if (firstSystem >= 0) {
    messages[firstSystem] = {
      ...messages[firstSystem],
      content: `${messages[firstSystem].content || ""}\n\n${protocol}`,
    };
  } else {
    messages.unshift({ role: "system", content: protocol });
  }
  return messages;
}

function chatBody(input, toolMode = ollamaToolMode(input.model)) {
  const body = {
    model: input.model,
    stream: false,
    think: false,
    messages: messagesForToolMode(input, toolMode),
    options: { temperature: 0 },
  };
  if (toolMode === "native" && (input.tools || []).length) {
    body.tools = (input.tools || []).map(toOllamaTool);
  }
  return body;
}

function toOllamaMessage(message) {
  if (message.role === "tool") {
    return { role: "tool", tool_name: PROVIDER_NAMES[message.name] || message.name, content: message.content };
  }
  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length) {
    return {
      role: "assistant",
      content: message.content || "",
      tool_calls: message.toolCalls.map((call) => ({
        type: "function",
        function: { name: PROVIDER_NAMES[call.name] || call.name, arguments: call.args || {} },
      })),
    };
  }
  return { role: message.role, content: message.content || "" };
}

function toOllamaTool(tool) {
  return {
    type: "function",
    function: {
      name: PROVIDER_NAMES[tool.name] || tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function normalizeMessage(message, offeredTools = []) {
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const nativeCalls = calls.map((call) => {
    const providerName = call.function && call.function.name;
    const rawArgs = call.function ? call.function.arguments || {} : {};
    let args = {};
    try {
      args = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;
    } catch {
      args = {};
    }
    return { name: CONTRACT_NAMES[providerName] || providerName, args };
  }).filter((call) => call.name);

  if (nativeCalls.length) {
    return {
      text: stripThinking(message.content || ""),
      toolCalls: nativeCalls,
    };
  }

  const fallbackCalls = contentToolCalls(message.content || "", offeredTools);
  if (fallbackCalls.length) {
    return {
      text: "",
      toolCalls: fallbackCalls,
    };
  }

  return {
    text: stripThinking(message.content || ""),
    toolCalls: [],
  };
}

function contentToolCalls(content, offeredTools) {
  const text = stripThinking(content).trim();
  const candidates = [];

  if (text.startsWith("{") && text.endsWith("}")) candidates.push(text);

  for (const match of text.matchAll(/\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`/gi)) {
    const candidate = String(match[1] || "").trim();
    if (candidate.startsWith("{") && candidate.endsWith("}")) candidates.push(candidate);
  }

  for (const match of text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi)) {
    const candidate = String(match[1] || "").trim();
    if (candidate.startsWith("{") && candidate.endsWith("}")) candidates.push(candidate);
  }

  for (const candidate of extractBalancedJsonObjects(text)) {
    candidates.push(candidate);
  }

  const calls = [];
  const seen = new Set();
  const rememberCall = (call) => {
    if (!call) return;
    const key = `${call.name}:${JSON.stringify(call.args || {})}`;
    if (seen.has(key)) return;
    seen.add(key);
    calls.push(call);
  };

  for (const candidate of candidates) {
    rememberCall(parseContentToolCall(candidate, offeredTools));
  }

  // Qwen3-Coder's native agent format may surface as raw content when the
  // serving layer does not translate it into message.tool_calls.
  for (const match of text.matchAll(/<tool_call>\s*<function=([^>\n]+)>\s*([\s\S]*?)<\/function>\s*<\/tool_call>/gi)) {
    rememberCall(parseQwenXmlToolCall(match[1], match[2], offeredTools));
  }

  return calls;
}

function extractBalancedJsonObjects(text) {
  const source = String(text || "");
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(source.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return objects;
}

function parseContentToolCall(text, offeredTools) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const providerName = typeof parsed.name === "string" ? parsed.name.trim() : "";
  if (!providerName) return null;

  const offered = (offeredTools || []).find((tool) => (
    tool && (PROVIDER_NAMES[tool.name] || tool.name) === providerName
  ));
  if (!offered) return null;

  let args = parsed.arguments ?? parsed.args ?? {};
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      return null;
    }
  }
  if (!validToolArguments(args, offered.parameters)) return null;

  return { name: offered.name, args };
}

function parseQwenXmlToolCall(providerName, body, offeredTools) {
  const name = String(providerName || "").trim();
  if (!name) return null;
  const offered = (offeredTools || []).find((tool) => (
    tool && (PROVIDER_NAMES[tool.name] || tool.name) === name
  ));
  if (!offered) return null;

  const args = {};
  for (const match of String(body || "").matchAll(/<parameter=([^>\n]+)>\s*([\s\S]*?)\s*<\/parameter>/gi)) {
    const key = String(match[1] || "").trim();
    if (!key) continue;
    args[key] = coerceToolArgument(String(match[2] || "").trim(), offered.parameters, key);
  }
  if (!validToolArguments(args, offered.parameters)) return null;
  return { name: offered.name, args };
}

function coerceToolArgument(value, schema, key) {
  const properties = schema && schema.properties && typeof schema.properties === "object"
    ? schema.properties
    : {};
  const rule = properties[key] || {};
  const type = Array.isArray(rule.type) ? rule.type.find((item) => item !== "null") : rule.type;
  if (type === "integer") {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : value;
  }
  if (type === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  if (type === "boolean") {
    if (/^true$/i.test(value)) return true;
    if (/^false$/i.test(value)) return false;
    return value;
  }
  if (type === "array" || type === "object") {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

function validToolArguments(args, schema) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return false;
  if (!schema || typeof schema !== "object") return true;
  if (schema.type && schema.type !== "object") return false;

  for (const field of schema.required || []) {
    if (!Object.prototype.hasOwnProperty.call(args, field)) return false;
  }

  const properties = schema.properties && typeof schema.properties === "object"
    ? schema.properties
    : {};
  for (const [key, value] of Object.entries(args)) {
    const rule = properties[key];
    if (!rule || !rule.type) continue;
    if (!matchesSchemaType(value, rule.type)) return false;
  }
  return true;
}

function matchesSchemaType(value, type) {
  if (Array.isArray(type)) return type.some((item) => matchesSchemaType(value, item));
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "array") return Array.isArray(value);
  if (type === "object") return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (type === "null") return value === null;
  return true;
}

function stripThinking(text) {
  return String(text).replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

function getJson(baseUrl, pathname) {
  const url = new URL(pathname, baseUrl);
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.get(url, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`model list returned ${res.statusCode}`));
          return;
        }
        try {
          resolve(text ? JSON.parse(text) : {});
        } catch (error) {
          reject(error);
        }
      });
    });
    req.setTimeout(2000, () => {
      req.destroy();
      reject(new Error("model list timed out"));
    });
    req.on("error", reject);
  });
}

function postJson(baseUrl, pathname, body, signal) {
  const url = new URL(pathname, baseUrl);
  const payload = JSON.stringify(body);
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`model request returned ${res.statusCode}: ${text.slice(0, 300)}`));
            return;
          }
          try {
            resolve(text ? JSON.parse(text) : {});
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

module.exports = { ModelProvider, OllamaModelProvider };
