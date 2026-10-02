"use strict";

const { ControlledToolProvider } = require("../../packages/agent-runtime/tool-registry");

const MUTATION_TOOLS = new Set(["file.write", "file.patch", "dir.create"]);
const FAILURE_CHECK_TOOLS = new Set([
  "tests.run",
  "sandbox.run",
  "terminal.run",
  "process.start",
  "process.status",
  "process.logs",
  "diagnostics.run",
  "browser.check",
  "browser.interact",
]);

function stable(value) {
  if (!value || typeof value !== "object") return JSON.stringify(value || {});
  const ordered = {};
  for (const key of Object.keys(value).sort()) ordered[key] = value[key];
  return JSON.stringify(ordered);
}

function signature(name, args) {
  return String(name || "") + ":" + stable(args || {});
}

function diagnosticFailure(result) {
  return Boolean(
    result
    && result.ok
    && result.data
    && Array.isArray(result.data.items)
    && result.data.items.length > 0
  );
}

function processFailure(result) {
  const data = result && result.data;
  return Boolean(
    result
    && result.ok
    && data
    && (
      data.status === "failed"
      || (typeof data.exitCode === "number" && data.exitCode !== 0)
    )
  );
}

function isFailureEvidence(name, result) {
  if (!FAILURE_CHECK_TOOLS.has(name) || !result) return false;
  if (result.ok === false) return true;
  if (name === "diagnostics.run") return diagnosticFailure(result);
  if (name === "process.status" || name === "process.logs" || name === "process.start") {
    return processFailure(result);
  }
  return false;
}

class DebugToolProvider extends ControlledToolProvider {
  constructor(host) {
    super(host);
    this.failureCheck = null;
    this.failureObserved = false;
    this.recheckRequired = false;
    this.mutations = 0;
  }

  async call(name, args) {
    if (MUTATION_TOOLS.has(name) && !this.failureObserved) {
      return {
        ok: false,
        tool: name,
        error: {
          code: "debug_reproduce_first",
          message: "Debug mode requires concrete failure evidence before workspace mutation. Reproduce the bug with tests, diagnostics, process evidence, or browser verification first.",
        },
      };
    }

    if (name === "git.diff" && this.recheckRequired && this.failureCheck) {
      return {
        ok: false,
        tool: name,
        error: {
          code: "debug_recheck_required",
          message: "Re-run the original failing check before reviewing the final diff: " + this.failureCheck.name + ".",
        },
        data: {
          requiredTool: this.failureCheck.name,
          requiredArgs: { ...this.failureCheck.args },
        },
      };
    }

    const result = await super.call(name, args);

    if (!this.failureObserved && isFailureEvidence(name, result)) {
      this.failureObserved = true;
      this.failureCheck = {
        name,
        args: { ...(args || {}) },
        signature: signature(name, args),
      };
    }

    if (MUTATION_TOOLS.has(name) && result && result.ok) {
      const changed = !(result.data && result.data.noOp === true);
      if (changed) {
        this.mutations += 1;
        this.recheckRequired = Boolean(this.failureCheck);
      }
    }

    if (
      this.recheckRequired
      && this.failureCheck
      && signature(name, args) === this.failureCheck.signature
      && result
      && result.ok
      && !diagnosticFailure(result)
      && !processFailure(result)
    ) {
      this.recheckRequired = false;
    }

    return result;
  }

  debugState() {
    return {
      failureObserved: this.failureObserved,
      failureCheck: this.failureCheck ? {
        name: this.failureCheck.name,
        args: { ...this.failureCheck.args },
      } : null,
      recheckRequired: this.recheckRequired,
      mutations: this.mutations,
    };
  }
}

module.exports = {
  DebugToolProvider,
  FAILURE_CHECK_TOOLS,
  MUTATION_TOOLS,
  diagnosticFailure,
  isFailureEvidence,
  processFailure,
  signature,
};
