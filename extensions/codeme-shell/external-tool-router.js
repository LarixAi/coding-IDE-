class ExternalToolRouter {
  constructor(providers = []) {
    this.providers = providers.filter((item) => item && typeof item.listTools === "function" && typeof item.call === "function");
    this.routes = new Map();
    this.errors = [];
  }

  async listTools(signal) {
    this.routes.clear();
    this.errors = [];
    const definitions = [];

    for (const provider of this.providers) {
      let listed = [];
      try {
        listed = await provider.listTools(signal);
      } catch (error) {
        this.errors.push(error instanceof Error ? error.message : String(error));
        continue;
      }
      if (!Array.isArray(listed)) continue;

      for (const definition of listed) {
        const name = definition && definition.name ? String(definition.name) : "";
        if (!name || this.routes.has(name)) continue;
        this.routes.set(name, provider);
        definitions.push(definition);
      }
    }

    return definitions;
  }

  async call(name, args, signal) {
    let provider = this.routes.get(name);
    if (!provider) {
      await this.listTools(signal);
      provider = this.routes.get(name);
    }
    if (!provider) {
      return {
        ok: false,
        tool: name,
        trusted: false,
        error: { code: "unknown_external_tool", message: "External tool is not currently available" },
      };
    }
    return provider.call(name, args || {}, signal);
  }
}

module.exports = { ExternalToolRouter };
