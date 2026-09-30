function canonicalToolName(rawName, offeredTools) {
  const raw = String(rawName || "").trim();
  if (!raw) return "";
  const tools = Array.isArray(offeredTools) ? offeredTools : [];
  const normalized = raw.toLowerCase().replace(/-/g, "_");
  for (const tool of tools) {
    const name = String(tool && tool.name || "");
    if (!name) continue;
    const aliases = new Set([
      name,
      name.replace(/\./g, "_"),
      name.replace(/\./g, "-"),
    ].map((value) => value.toLowerCase()));
    if (aliases.has(normalized)) return name;
  }
  return "";
}

function balancedObject(source, start) {
  const text = String(source || "");
  let index = start;
  while (index < text.length && /\s/.test(text[index])) index += 1;
  if (text[index] !== "{") return null;
  const begin = index;
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (; index < text.length; index += 1) {
    const ch = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return { raw: text.slice(begin, index + 1), end: index + 1 };
    }
  }
  return null;
}

function parseLooseValue(source) {
  const text = String(source || "");
  let index = 0;

  const skip = () => {
    while (index < text.length && /\s/.test(text[index])) index += 1;
  };

  const parseString = () => {
    const quote = text[index++];
    let out = "";
    let escaped = false;
    while (index < text.length) {
      const ch = text[index++];
      if (escaped) {
        const map = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
        out += Object.prototype.hasOwnProperty.call(map, ch) ? map[ch] : ch;
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        return out;
      } else {
        out += ch;
      }
    }
    throw new Error("unterminated string");
  };

  const parseBare = () => {
    const start = index;
    while (index < text.length && !/[\s,}\]]/.test(text[index])) index += 1;
    const token = text.slice(start, index).trim();
    if (token === "true") return true;
    if (token === "false") return false;
    if (token === "null") return null;
    if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(token)) return Number(token);
    return token;
  };

  const parseArray = () => {
    const out = [];
    index += 1;
    skip();
    while (index < text.length && text[index] !== "]") {
      out.push(parseValue());
      skip();
      if (text[index] === ",") {
        index += 1;
        skip();
      } else if (text[index] !== "]") {
        throw new Error("expected comma or ]");
      }
    }
    if (text[index] !== "]") throw new Error("unterminated array");
    index += 1;
    return out;
  };

  const parseObject = () => {
    const out = {};
    index += 1;
    skip();
    while (index < text.length && text[index] !== "}") {
      let key;
      if (text[index] === '"' || text[index] === "'") {
        key = parseString();
      } else {
        const start = index;
        while (index < text.length && /[A-Za-z0-9_$.-]/.test(text[index])) index += 1;
        key = text.slice(start, index);
      }
      if (!key) throw new Error("expected object key");
      skip();
      if (text[index] !== ":") throw new Error("expected colon");
      index += 1;
      skip();
      out[key] = parseValue();
      skip();
      if (text[index] === ",") {
        index += 1;
        skip();
      } else if (text[index] !== "}") {
        throw new Error("expected comma or }");
      }
    }
    if (text[index] !== "}") throw new Error("unterminated object");
    index += 1;
    return out;
  };

  const parseValue = () => {
    skip();
    const ch = text[index];
    if (ch === "{") return parseObject();
    if (ch === "[") return parseArray();
    if (ch === '"' || ch === "'") return parseString();
    return parseBare();
  };

  const value = parseValue();
  skip();
  if (index !== text.length) throw new Error("unexpected trailing content");
  return value;
}

function recoverLooseToolCalls(content, offeredTools) {
  const text = String(content || "");
  if (!text.trim()) return [];
  const calls = [];
  const seen = new Set();
  const matcher = /^\s*(?:name|tool|action)\s*:\s*([A-Za-z0-9_.-]+)\s*,?\s*(?:arguments?|args?|parameters?)\s*:\s*/gim;

  for (const match of text.matchAll(matcher)) {
    const name = canonicalToolName(match[1], offeredTools);
    if (!name) continue;
    const object = balancedObject(text, match.index + match[0].length);
    if (!object) continue;
    let args;
    try {
      args = parseLooseValue(object.raw);
    } catch {
      continue;
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) continue;
    const key = name + ":" + JSON.stringify(args);
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push({ name, args });
  }
  return calls;
}

function stripRecoveredToolText(content) {
  const text = String(content || "");
  return text.replace(
    /^\s*(?:name|tool|action)\s*:\s*[A-Za-z0-9_.-]+\s*,?\s*(?:arguments?|args?|parameters?)\s*:\s*\{[^\n]*\}\s*$/gim,
    "",
  ).replace(/\n{3,}/g, "\n\n").trim();
}

class ToolCallCompatProvider {
  constructor(provider) {
    this.provider = provider;
    this.name = provider && provider.name ? provider.name : "tool-call-compat";
  }

  async listModels(options) {
    return this.provider.listModels(options);
  }

  async complete(input) {
    const reply = await this.provider.complete(input);
    if (reply && Array.isArray(reply.toolCalls) && reply.toolCalls.length) return reply;
    const recovered = recoverLooseToolCalls(reply && reply.text, input && input.tools);
    if (!recovered.length) return reply;
    return {
      ...reply,
      text: stripRecoveredToolText(reply && reply.text),
      toolCalls: recovered,
    };
  }
}

function wrapToolCallCompat(provider) {
  return new ToolCallCompatProvider(provider);
}

module.exports = {
  ToolCallCompatProvider,
  wrapToolCallCompat,
  recoverLooseToolCalls,
  canonicalToolName,
  balancedObject,
  parseLooseValue,
  stripRecoveredToolText,
};
