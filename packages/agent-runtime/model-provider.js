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

  async listModels(options = {}) {
    try {
      const body = await getJson(this.baseUrl, "/api/tags");
      return (body.models || []).map((model) => {
        const id = String(model && model.name || "");
        return id ? { provider: this.name, id, label: id } : null;
      }).filter(Boolean);
    } catch (error) {
      if (options && options.strict) throw error;
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
      const response = await postJson(this.baseUrl, "/api/chat", chatBody(input), signal);
      const decision = normalizeMessage(response.message || {}, input.tools || []);
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

  async completeVision(input) {
    const timeoutMs = input.timeoutMs || Math.max(this.timeoutMs, 240000);
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signals = [timeoutSignal];
    if (input.signal) signals.push(input.signal);
    const signal = AbortSignal.any(signals);
    try {
      const body = {
        model: input.model,
        stream: false,
        think: false,
        messages: [{
          role: "user",
          content: String(input.prompt || ""),
          images: (input.images || []).map((image) => String(image || "")).filter(Boolean),
        }],
        options: { temperature: 0.1 },
      };
      if (input.schema) body.format = input.schema;
      const response = await postJson(this.baseUrl, "/api/chat", body, signal);
      const promptTokens = typeof response.prompt_eval_count === "number" ? response.prompt_eval_count : 0;
      const completionTokens = typeof response.eval_count === "number" ? response.eval_count : 0;
      return {
        text: stripThinking(response.message && response.message.content || ""),
        usage: {
          promptTokens,
          completionTokens,
          total: promptTokens + completionTokens,
        },
      };
    } catch (error) {
      if (input.signal && input.signal.aborted) {
        throw Object.assign(new Error("vision model call cancelled"), { code: "cancelled" });
      }
      if (timeoutSignal.aborted) {
        throw Object.assign(new Error("vision model request timed out"), { code: "timeout" });
      }
      const message = error instanceof Error ? error.message : String(error);
      throw Object.assign(new Error(message), { code: "vision_model_disconnected" });
    }
  }
}

function chatBody(input) {
  return {
    model: input.model,
    stream: false,
    think: false,
    messages: (input.messages || []).map(toOllamaMessage),
    tools: (input.tools || []).map(toOllamaTool),
    options: { temperature: 0 },
  };
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

  const calls = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const call = parseContentToolCall(candidate, offeredTools);
    if (!call) continue;
    const key = `${call.name}:${JSON.stringify(call.args || {})}`;
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push(call);
  }
  return calls;
}

function parseContentToolCall(text, offeredTools) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  // Small local models sometimes serialize a requested tool call into message
  // content instead of Ollama's native tool_calls field. Accept only an offered
  // tool and validate the normalized arguments against that tool's schema.
  const providerName = typeof parsed.name === "string"
    ? parsed.name.trim()
    : typeof parsed.tool === "string"
      ? parsed.tool.trim()
      : "";
  if (!providerName) return null;

  const offered = (offeredTools || []).find((tool) => (
    tool
    && (
      tool.name === providerName
      || (PROVIDER_NAMES[tool.name] || tool.name) === providerName
    )
  ));
  if (!offered) return null;

  let args = parsed.arguments ?? parsed.args;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      return null;
    }
  }

  if (args === undefined) {
    args = {};
    const properties = offered.parameters
      && offered.parameters.properties
      && typeof offered.parameters.properties === "object"
      ? offered.parameters.properties
      : {};
    for (const key of Object.keys(properties)) {
      if (Object.prototype.hasOwnProperty.call(parsed, key)) args[key] = parsed[key];
    }

    // Qwen commonly emits {"tool":"file.write","path":"...","content":"..."}
    // even though CodeMe's canonical file.write field is "contents".
    if (
      offered.name === "file.write"
      && !Object.prototype.hasOwnProperty.call(args, "contents")
      && typeof parsed.content === "string"
    ) {
      args.contents = parsed.content;
    }
  }

  if (!validToolArguments(args, offered.parameters)) return null;
  return { name: offered.name, args };
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
