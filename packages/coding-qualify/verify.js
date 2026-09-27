function isTestCall(call) {
  const command = call.args && call.args.command ? call.args.command : "";
  if (call.name === "tests.run") return true;
  return call.name === "terminal.run" && (command === "npm test" || command.includes("greet.test.js"));
}

function failedTest(call) {
  return isTestCall(call) && call.result && call.result.ok === false && call.result.error && call.result.error.code === "exit_status";
}

function codingComplete(run) {
  const calls = run.toolCalls;
  const firstFail = calls.find((call) => failedTest(call));
  const failAt = firstFail ? calls.indexOf(firstFail) : -1;
  const repair = failAt >= 0 ? calls.find((call, index) => index > failAt && call.name === "file.write" && call.args && call.args.path === "src/greet.js" && call.result && call.result.ok) : null;
  let lastWrite = -1;
  calls.forEach((call, index) => {
    if (call.name === "file.write" && call.args && call.args.path === "src/greet.js" && call.result && call.result.ok) lastWrite = index;
  });
  const passed = lastWrite > failAt ? calls.find((call, index) => index > lastWrite && isTestCall(call) && call.result && call.result.ok) : null;
  const diff = lastWrite > failAt ? calls.find((call, index) => index > lastWrite && call.name === "git.diff" && call.result && call.result.ok && String((call.result.data && call.result.data.diff) || "").includes("src/greet.js")) : null;
  const missing = [];
  if (!calls.some((call) => call.name === "repo.search")) missing.push("search the repository");
  if (!calls.some((call) => call.name === "file.read" && call.args && call.args.path === "src/greet.js")) missing.push("read src/greet.js");
  if (!calls.some((call) => call.name === "file.read" && call.args && call.args.path === "test/greet.test.js")) missing.push("read test/greet.test.js");
  if (!firstFail) missing.push("run npm test and keep the failing result");
  if (!repair) missing.push("write src/greet.js after that failure");
  if (!calls.some((call) => call.name === "diagnostics.run")) missing.push("run diagnostics");
  if (!passed) missing.push("rerun npm test until it exits 0");
  if (!diff) missing.push("inspect git diff after the repair");
  if (!run.filesChanged.includes("src/greet.js")) missing.push("record src/greet.js in filesChanged");
  if (missing.length) {
    return { status: "failed", summary: `Still needed: ${missing.join("; ")}`, evidence: missing };
  }
  return {
    status: "passed",
    summary: "A failing test was observed, src/greet.js was repaired, tests passed, and the git diff shows that file",
    evidence: ["repo.search", "file.read", "tests.run", "file.write", "diagnostics.run", "git.diff"],
  };
}

module.exports = { codingComplete, isTestCall, failedTest };
