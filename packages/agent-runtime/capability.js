class ExternalCapabilityProvider {
  constructor() {
    this.name = "external";
  }

  async listCapabilities() {
    return [];
  }

  async invoke(name) {
    return {
      ok: false,
      capability: name,
      error: {
        code: "capability_unavailable",
        message: "No external capability hub is configured",
      },
    };
  }
}

module.exports = { ExternalCapabilityProvider };
