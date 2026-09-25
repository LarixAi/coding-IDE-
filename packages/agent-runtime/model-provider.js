const http = require("http");
const https = require("https");

class ModelProvider {
  constructor(name) {
    this.name = name;
  }

  async complete() {
    throw Object.assign(new Error(`${this.name} does not implement complete`), { code: "not_implemented" });
  }
}

const PROVIDER_NAMES = {
  "file.read": "file_read",
  "file.write": "file_write",
  "repo.search": "repo_search",
  "terminal.run": "terminal_run",
  "tests.run": "tests_run",
  "git.status": "git_status",
  "git.diff": "git_diff",
  "diagnostics.run": "diagnostics_run",
  "browser.check": "browser_check",
};
const CONTRACT_NAMES = Object.fromEntries(Object.entries(PROVIDER_NAMES).map(([contract, provider]) => [provider, contract]));

class OllamaModelProvider extends ModelProvider {
  constructor(options = {}) {
    super("ollama");
    this.baseUrl = options.baseUrl || "http://127.0.0.1:11434";
    this.timeoutMs = options.timeoutMs || 180000;
  }

  async complete(input) {
    const timeoutMs = input.timeoutMs || this.timeoutMs;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signals = [timeoutSignal];
    if (input.signal) signals.push(input.signal);
    const signal = AbortSignal.any(signals);
    try {
      const response = await postJson(this.baseUrl, "/api/chat", chatBody(input), signal);
      return normalizeMessage(response.message || {});
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
