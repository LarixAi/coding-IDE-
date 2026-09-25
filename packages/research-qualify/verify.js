const cp = require("child_process");
const { applyProbe, isTest } = require("./acceptance");

function workspaceChanges(root) {
  const diffNames = cp.execFileSync("git", ["diff", "--name-only"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  const untracked = cp.execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  return [...new Set([...diffNames, ...untracked])].sort();
}

function researchComplete(run, workspace) {
  return complete(run, workspace, true);
}

function localComplete(run, workspace) {
  return complete(run, workspace, false);
}

function complete(run, workspace, requireResearch) {
  const report = applyProbe(run, workspace);
  const calls = run.toolCalls || [];
  const failed = calls.find((call) => failedTest(call));
  const failAt = failed ? calls.indexOf(failed) : -1;
  let lastWrite = -1;
  calls.forEach((call, index) => {
    if (call.name === "file.write" && call.result && call.result.ok) lastWrite = index;
  });
  const lastWriteCall = lastWrite >= 0 ? calls[lastWrite] : null;
  const research = calls.find((call, index) => index < lastWrite && successfulResearch(call) && lastWriteCall && call.iteration < lastWriteCall.iteration);
  const repair = failAt >= 0 ? calls.find((call, index) => index > failAt && call.name === "file.write" && call.result && call.result.ok) : null;
  const passed = calls.find((call, index) => index > lastWrite && lastWrite > failAt && isTest(call) && call.result && call.result.ok);
  const diagnostics = calls.find((call, index) => index > lastWrite && lastWrite >= 0 && call.name === "diagnostics.run" && call.result && call.result.ok);
  const cleanDiagnostics = Boolean(diagnostics && diagnostics.result.data && Array.isArray(diagnostics.result.data.items) && diagnostics.result.data.items.length === 0);
  const diff = calls.find((call, index) => index > lastWrite && call.name === "git.diff" && call.result && call.result.ok);
  const changes = workspaceChanges(workspace);
  const missing = [];
  if (!calls.some((call) => call.name === "repo.search")) missing.push("search the repository");
  if (!readUnder(calls, "src/")) missing.push("read the implementation");
  if (!readUnder(calls, "test/")) missing.push("read the tests");
  if (!failed) missing.push("run the project tests and keep the failing result");
  else if (!repair) missing.push("write a repair after the failing test");
  else if (!passed) missing.push(`the latest test has not passed after the last edit. ${failureExcerpt([...calls].reverse().find((call) => failedTest(call)))}`);
  if (requireResearch && !research) {
    missing.push("call file.write for the implementation after a successful untrusted evidence observation. Quoting the evidence does not edit the file. Then run the tests, diagnostics, and git diff again");
  }
  if (!cleanDiagnostics) missing.push("run diagnostics with no remaining errors");
  if (!diff) missing.push("inspect the git diff after the last edit");
  if (!report.acceptValid) missing.push("accept a published valid number that is not one of the fixture examples");
  if (!report.rejectInvalid) missing.push("reject a published invalid number that the current digit order would accept");
  if (!report.rejectMalformed) missing.push("reject empty, short, and non-digit input");
  const open = (run.requirements || []).filter((item) => item.status !== "satisfied").map((item) => `${item.id} (${item.status})`);
  if (open.length) missing.push(`account for requirements: ${open.join(", ")}`);
  if (missing.length) {
    return { status: "failed", summary: `Still needed: ${missing.join("; ")}`, evidence: missing };
  }
  run.filesChanged = changes;
  return {
    status: "passed",
    summary: requireResearch
      ? "The repair follows an untrusted evidence observation, and CodeMe tests, diagnostics, and git agree"
      : "The repair was verified from CodeMe tests, diagnostics, and git",
    evidence: (run.requirements || []).map((item) => item.id),
  };
}

function successfulResearch(call) {
  return call.name === "capability.invoke"
    && call.args
    && call.args.capability === "research.problem"
    && call.result
    && call.result.ok
    && call.result.trusted === false
    && call.result.status === "ok";
}

function readUnder(calls, prefix) {
  return calls.some((call) => call.name === "file.read" && call.args && String(call.args.path || "").startsWith(prefix));
}

function failedTest(call) {
  return isTest(call) && call.result && call.result.ok === false && call.result.error && call.result.error.code === "exit_status";
}

function failureExcerpt(call) {
  if (!call || !call.result || !call.result.data) return "";
  const text = `${call.result.data.stderr || ""}\n${call.result.data.stdout || ""}`;
  return text.replace(/\s+/g, " ").trim().slice(0, 400);
}

function fallbackComplete(run, workspace) {
  const report = applyProbe(run, workspace);
  const calls = run.toolCalls || [];
  const unavailable = calls.find((call) => (
    call.name === "capability.invoke"
    && call.result
    && call.result.kind === "capability"
    && call.result.trusted === false
    && call.result.ok === false
  ));
  const write = calls.find((call) => call.name === "file.write" && call.result && call.result.ok);
  const missing = [];
  if (!unavailable) missing.push("record the capability failure as an untrusted observation");
  if (!write || !unavailable || write.iteration <= unavailable.iteration) missing.push("write the repair with CodeMe after the capability failure");
  if (!report.acceptValid || !report.rejectInvalid || !report.rejectMalformed) missing.push("match the published behaviour");
  if (!report.tests) missing.push("pass the project tests");
  if (!report.diagnostics) missing.push("run diagnostics with no errors");
  const open = (run.requirements || []).filter((item) => item.status !== "satisfied").map((item) => item.id);
  if (open.length) missing.push(`requirements ${open.join(", ")}`);
  if (missing.length) return { status: "failed", summary: `Still needed: ${missing.join("; ")}`, evidence: missing };
  run.filesChanged = workspaceChanges(workspace);
  return { status: "passed", summary: "The hub was unavailable and CodeMe finished the repair locally", evidence: ["capability.invoke", "file.write"] };
}

module.exports = { researchComplete, localComplete, fallbackComplete, workspaceChanges, successfulResearch };
