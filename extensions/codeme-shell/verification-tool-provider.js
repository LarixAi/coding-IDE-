"use strict";

const { ControlledToolProvider } = require("../../packages/agent-runtime/tool-registry");

const VERIFICATION_BLOCKED_TOOLS = new Set([
  "file.write",
  "file.patch",
  "dir.create",
  "terminal.run",
]);

class VerificationToolProvider extends ControlledToolProvider {
  definitions() {
    return super.definitions().filter((tool) => !VERIFICATION_BLOCKED_TOOLS.has(tool.name));
  }

  async call(name, args) {
    if (VERIFICATION_BLOCKED_TOOLS.has(name)) {
      return {
        ok: false,
        tool: name,
        error: {
          code: "verification_role_mutation_blocked",
          message: "Verification roles may reproduce and verify but cannot mutate workspace source files or use the unrestricted terminal command tool.",
        },
      };
    }
    return super.call(name, args);
  }
}

module.exports = { VerificationToolProvider, VERIFICATION_BLOCKED_TOOLS };
