function diagnose(call, result) {
  if (!result || result.ok) return null;
  const code = result.error && result.error.code;
  if (code === "timeout" || code === "model_disconnected") {
    return { class: "provider", retry: true, next: "retry" };
  }
  if (code === "cancelled") return { class: "environment", retry: false, next: "stop" };
  if (code === "mutation_blocked" || code === "command_rejected") {
    return { class: "permission", retry: false, next: "inspect" };
  }
  if (code === "exit_status") return { class: "bad_code", retry: false, next: "repair" };
  if (code === "not_found") return { class: "wrong_command", retry: false, next: "inspect" };
  if (code === "capability_unavailable" || code === "hub_rejected" || code === "malformed_response") {
    return { class: "provider", retry: false, next: "fallback" };
  }
  if (code === "capability_escalation") return { class: "permission", retry: false, next: "hold" };
  return { class: "unknown", retry: false, next: "inspect" };
}

function autonomyHold(call, result) {
  const code = result && result.error && result.error.code;
  if (code === "credentials_required") {
    return { pause: true, reason: "credentials", message: "The run paused because required credentials are not available." };
  }
  if (code === "approval_required") {
    return { pause: true, reason: "destructive", message: "The run paused because a destructive action needs approval." };
  }
  return null;
}

module.exports = { diagnose, autonomyHold };
