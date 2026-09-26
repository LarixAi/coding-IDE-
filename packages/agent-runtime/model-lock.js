function lockModel(options = {}) {
  const requested = options.model || null;
  const fallback = options.fallbackModel || null;
  const profiles = options.modelProfiles || {};
  const needsTools = options.mode !== "chat_only";

  if (!requested) {
    return fail("model_missing", "No model was requested");
  }

  const requestedProfile = profiles[requested] || options.requestedProfile || defaultProfile(requested);
  if (needsTools && requestedProfile.supportsTools === false) {
    if (!fallback) {
      return fail("model_not_capable", `Requested model ${requested} does not support tools and no fallback was provided`);
    }
    const fallbackProfile = profiles[fallback] || options.fallbackProfile || defaultProfile(fallback);
    if (fallbackProfile.supportsTools === false) {
      return fail("model_not_capable", `Fallback model ${fallback} does not support tools`);
    }
    return {
      ok: true,
      requestedModel: requested,
      effectiveModel: fallback,
      locked: true,
      reason: "fallback",
      fallback: { from: requested, to: fallback, reason: "requested_model_lacks_tools" },
      persistentSelection: requested,
    };
  }

  return {
    ok: true,
    requestedModel: requested,
    effectiveModel: requested,
    locked: true,
    reason: "selected",
    fallback: null,
    persistentSelection: requested,
  };
}

function defaultProfile(name) {
  return { model: name, supportsTools: true, qualification: "unknown" };
}

function fail(code, message) {
  return {
    ok: false,
    code,
    message,
    requestedModel: null,
    effectiveModel: null,
    locked: false,
    reason: "failed",
    fallback: null,
    persistentSelection: null,
  };
}

module.exports = { lockModel };
