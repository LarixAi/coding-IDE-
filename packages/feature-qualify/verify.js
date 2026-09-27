const cp = require("child_process");
const { applyProbe } = require("./acceptance");

function workspaceChanges(root) {
  const diffNames = cp.execFileSync("git", ["diff", "--name-only"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  const untracked = cp.execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  return [...new Set([...diffNames, ...untracked])].sort();
}

function featureComplete(run, workspace) {
  const report = applyProbe(run, workspace);
  const calls = run.toolCalls;
  const changes = workspaceChanges(workspace);
  const inspected = discovered(calls, changes, trackedFiles(workspace));
  const failed = calls.find((call) => failedTest(call));
  const failAt = failed ? calls.indexOf(failed) : -1;
  const repair = failAt >= 0 ? calls.find((call, index) => index > failAt && call.name === "file.write" && call.result && call.result.ok) : null;
  const latestFailure = [...calls].reverse().find((call) => failedTest(call));
  let lastWrite = -1;
  calls.forEach((call, index) => {
    if (call.name === "file.write" && call.result && call.result.ok) lastWrite = index;
  });
  const passed = calls.find((call, index) => index > lastWrite && lastWrite > failAt && isTest(call) && call.result && call.result.ok);
  const diagnostics = [...calls].reverse().find((call) => call.name === "diagnostics.run" && call.result && call.result.ok);
  const cleanDiagnostics = Boolean(diagnostics && diagnostics.result.data && Array.isArray(diagnostics.result.data.items) && diagnostics.result.data.items.length === 0);
  const diff = calls.find((call, index) => index > lastWrite && call.name === "git.diff" && call.result && call.result.ok);
  const missing = [];
  if (!inspected) missing.push("search the repository and read the existing files that you change");
  if (changes.length < 2) missing.push("change at least two project files");
  if (!failed) missing.push("run the tests and observe the failure");
  else if (!repair) missing.push("write a repair after the failing test");
  else if (!passed) missing.push(`the latest test failed. Write the repaired source, then run the tests again. ${failureExcerpt(latestFailure)}`);
  if (!cleanDiagnostics) missing.push("run diagnostics with no remaining errors");
  if (!diff) missing.push("inspect the git diff after the last edit");
  if (!report.health) missing.push("keep the existing health check working");
  const open = (run.requirements || []).filter((item) => item.status !== "satisfied").map((item) => `${item.id} (${item.status})`);
  if (open.length) missing.push(`account for requirements: ${open.join(", ")}`);
  if (missing.length) {
    return { status: "failed", summary: `Still needed: ${missing.join("; ")}`, evidence: missing };
  }
  run.filesChanged = changes;
  return {
    status: "passed",
    summary: "Registration follows the existing repository, tests cover the new behaviour, and every requirement is satisfied",
    evidence: (run.requirements || []).map((item) => item.id),
  };
}

function trackedFiles(root) {
  return new Set(cp.execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean));
}

function discovered(calls, changes, tracked) {
  const reads = calls.filter((call) => call.name === "file.read" && call.args && call.args.path).map((call) => call.args.path);
  const searches = calls.filter((call) => call.name === "repo.search");
  if (!searches.length || reads.length < 2) return false;
  return changes.filter((file) => tracked.has(file)).every((file) => reads.includes(file) || searches.some((call) => JSON.stringify(call.result || "").includes(file)));
}

function failedTest(call) {
  return isTest(call) && call.result && call.result.ok === false && call.result.error && call.result.error.code === "exit_status";
}

function failureExcerpt(call) {
  if (!call || !call.result || !call.result.data) return "";
  const text = `${call.result.data.stderr || ""}\n${call.result.data.stdout || ""}`;
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}

function isTest(call) {
  const command = call.args && call.args.command ? call.args.command : "";
  if (call.name === "tests.run") return true;
  return call.name === "terminal.run" && (command === "npm test" || command.includes("test/"));
}

module.exports = { featureComplete, workspaceChanges };
