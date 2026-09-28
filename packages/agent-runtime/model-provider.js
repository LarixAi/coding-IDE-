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
      const response = await postJson(this.baseUrl, "/api/chat", chatBody(input), signal);
      const decision = normalizeMessage(response.message || {});
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

function normalizeMessage(message) {
  const calls = message.tool_calls || [];
  return {
    text: stripThinking(message.content || ""),
    toolCalls: calls.map((call) => {
      const providerName = call.function && call.function.name;
      const rawArgs = call.function ? call.function.arguments || {} : {};
      let args = {};
      try {
        args = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;
      } catch {
        args = {};
      }
      return { name: CONTRACT_NAMES[providerName] || providerName, args };
    }),
  };
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
