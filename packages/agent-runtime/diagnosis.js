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
  if (code === "flag_like_path") {
    return { class: "wrong_command", retry: false, next: "inspect" };
  }
  if (code === "patch_not_found" || code === "patch_ambiguous") {
    return { class: "bad_code", retry: false, next: "inspect" };
  }
  if (
    code === "invalid_port_binding"
    || code === "asset_unavailable"
    || code === "asset_status"
    || code === "asset_mime"
    || code === "page_status"
    || code === "preview_not_html"
    || code === "browser_expectation_failed"
    || code === "browser_console_error"
    || code === "browser_target_not_found"
    || code === "browser_target_not_clickable"
    || code === "browser_target_not_fillable"
    || code === "browser_fill_failed"
  ) {
    return { class: "bad_code", retry: false, next: "repair" };
  }
  if (code === "exit_status") return { class: "bad_code", retry: false, next: "repair" };
  if (code === "sandbox_unavailable" || code === "sandbox_too_large") {
    return { class: "environment", retry: false, next: "fallback" };
  }
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
