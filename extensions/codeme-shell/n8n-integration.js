const fs = require("fs");
const path = require("path");
const { N8nMcpToolProvider, enhancePrompt, DEFAULT_MCP_URL } = require("../../packages/n8n-capability/mcp");

const SETTINGS_KEY = "codeme.n8n.settings";
const SECRET_KEY = "codeme.n8n.mcpToken";
const CACHE_MS = 15000;

function publicDefaults() {
  return {
    mcpEnabled: true,
    mcpUrl: process.env.CODEME_N8N_MCP_URL || DEFAULT_MCP_URL,
    autoEnhance: false,
    enhanceWebhookUrl: process.env.CODEME_N8N_ENHANCE_URL || "",
  };
}

class N8nIntegration {
  constructor(context) {
    this.context = context;
    this.cachedProvider = null;
    this.cachedAt = 0;
    this.toolCount = 0;
    this.toolNames = [];
    this.lastError = "";
    this.lastEnhancementSource = "";
  }

  settings() {
    const stored = this.context.globalState.get(SETTINGS_KEY) || {};
    return { ...publicDefaults(), ...stored };
  }

  async secret() {
    const stored = this.context.secrets && typeof this.context.secrets.get === "function"
      ? await this.context.secrets.get(SECRET_KEY)
      : "";
    return String(stored || process.env.CODEME_N8N_MCP_TOKEN || process.env.CODEME_N8N_TOKEN || "");
  }

  snapshot() {
    const settings = this.settings();
    return {
      ...settings,
      tokenConfigured: Boolean(process.env.CODEME_N8N_MCP_TOKEN || process.env.CODEME_N8N_TOKEN) || this._tokenConfigured === true,
      toolCount: this.toolCount,
      toolNames: this.toolNames.slice(0, 64),
      lastError: this.lastError,
      lastEnhancementSource: this.lastEnhancementSource,
    };
  }

  async refreshTokenFlag() {
    this._tokenConfigured = Boolean(await this.secret());
    return this._tokenConfigured;
  }

  async update(patch = {}) {
    const current = this.settings();
    const next = {
      ...current,
      ...(typeof patch.mcpEnabled === "boolean" ? { mcpEnabled: patch.mcpEnabled } : {}),
      ...(typeof patch.mcpUrl === "string" ? { mcpUrl: patch.mcpUrl.trim() || DEFAULT_MCP_URL } : {}),
      ...(typeof patch.autoEnhance === "boolean" ? { autoEnhance: patch.autoEnhance } : {}),
      ...(typeof patch.enhanceWebhookUrl === "string" ? { enhanceWebhookUrl: patch.enhanceWebhookUrl.trim() } : {}),
    };
    await this.context.globalState.update(SETTINGS_KEY, next);
    if (typeof patch.mcpToken === "string" && this.context.secrets) {
      const token = patch.mcpToken.trim();
      if (token) await this.context.secrets.store(SECRET_KEY, token);
      else await this.context.secrets.delete(SECRET_KEY);
    }
    this.cachedProvider = null;
    this.cachedAt = 0;
    await this.refreshTokenFlag();
    return this.snapshot();
  }

  async buildProvider(options = {}) {
    const settings = this.settings();
    if (!settings.mcpEnabled || !settings.mcpUrl) {
      this.toolCount = 0;
      this.toolNames = [];
      this.lastError = "";
      return null;
    }
    if (!options.force && this.cachedProvider && Date.now() - this.cachedAt < CACHE_MS) {
      return this.cachedProvider;
    }
    const token = await this.secret();
    const provider = new N8nMcpToolProvider({
      url: settings.mcpUrl,
      token,
      timeoutMs: options.timeoutMs || 5000,
    });
    try {
      const definitions = await provider.discover(options.signal);
      this.cachedProvider = provider;
      this.cachedAt = Date.now();
      this.toolCount = definitions.length;
      this.toolNames = definitions.map((item) => item.name);
      this.lastError = "";
      await this.refreshTokenFlag();
      return provider;
    } catch (error) {
      this.cachedProvider = null;
      this.cachedAt = 0;
      this.toolCount = 0;
      this.toolNames = [];
      this.lastError = error instanceof Error ? error.message : String(error);
      await this.refreshTokenFlag();
      if (options.throwOnError) throw error;
      return null;
    }
  }

  async test() {
    const provider = await this.buildProvider({ force: true, throwOnError: true, timeoutMs: 7000 });
    const definitions = provider ? provider.definitions() : [];
    return {
      ok: true,
      count: definitions.length,
      names: definitions.map((item) => item.name),
      settings: this.snapshot(),
    };
  }

  async enhance(rawPrompt, context = {}, options = {}) {
    const settings = this.settings();
    const token = await this.secret();
    const result = await enhancePrompt(rawPrompt, {
      webhookUrl: settings.enhanceWebhookUrl,
      token,
      context,
      timeoutMs: options.timeoutMs || 30000,
      signal: options.signal,
    });
    this.lastEnhancementSource = result.source;
    return result;
  }

  async enhanceIfEnabled(rawPrompt, context = {}, options = {}) {
    if (!this.settings().autoEnhance) return { prompt: rawPrompt, source: "none" };
    return this.enhance(rawPrompt, context, options);
  }

  workspaceContext(root) {
    return {
      rootName: root ? path.basename(root) : "",
      files: listWorkspaceHints(root),
    };
  }
}

function listWorkspaceHints(root) {
  if (!root || !fs.existsSync(root)) return [];
  const ignored = new Set([".git", "node_modules", ".codeme", ".tools", "dist", "build", "coverage", ".cache"]);
  const found = [];
  const walk = (directory, relative, depth) => {
    if (found.length >= 60 || depth > 4) return;
    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (found.length >= 60) break;
      if (ignored.has(entry.name)) continue;
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(directory, entry.name), rel, depth + 1);
      else if (entry.isFile()) found.push(rel);
    }
  };
  walk(root, "", 0);
  return found;
}

module.exports = { N8nIntegration, listWorkspaceHints };
