const cp = require("child_process");
const path = require("path");

const REQUIREMENTS = [
  { id: "accept-valid", text: "Accept an identification number that follows the published rule." },
  { id: "reject-invalid", text: "Reject an identification number that fails the published rule." },
  { id: "reject-malformed", text: "Reject empty, short, and non-digit input." },
  { id: "tests", text: "The project tests pass after the repair." },
  { id: "diagnostics", text: "Diagnostics report no errors after the repair." },
];

const HIDDEN_VALID = ["4222222222222", "12345678903"];
const HIDDEN_INVALID = ["79927398712", "12345678908"];
const MALFORMED = ["", "0", "12a", "abc", "7"];

function probe(workspace) {
  const report = { acceptValid: false, rejectInvalid: false, rejectMalformed: false, notes: [] };
  const script = `
    const { validNumber } = require(${JSON.stringify(path.resolve(workspace, "src/check.js"))});
    const cases = ${JSON.stringify({ valid: HIDDEN_VALID, invalid: HIDDEN_INVALID, malformed: MALFORMED })};
    const out = {
      acceptValid: cases.valid.every((value) => validNumber(value) === true),
      rejectInvalid: cases.invalid.every((value) => validNumber(value) === false),
      rejectMalformed: cases.malformed.every((value) => validNumber(value) === false),
    };
    process.stdout.write(JSON.stringify(out));
  `;
  const result = cp.spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
  if (result.status !== 0) {
    report.notes.push((result.stderr || result.stdout || "probe failed").replace(/\s+/g, " ").trim().slice(0, 300));
    return report;
  }
  try {
    const parsed = JSON.parse(result.stdout);
    report.acceptValid = Boolean(parsed.acceptValid);
    report.rejectInvalid = Boolean(parsed.rejectInvalid);
    report.rejectMalformed = Boolean(parsed.rejectMalformed);
  } catch (error) {
    report.notes.push(error instanceof Error ? error.message : String(error));
  }
  return report;
}

function applyProbe(run, workspace) {
  const report = probe(workspace);
  const calls = run.toolCalls || [];
  const diagnostics = [...calls].reverse().find((call) => call.name === "diagnostics.run" && call.result && call.result.ok);
  report.diagnostics = Boolean(
    diagnostics
    && diagnostics.result.data
    && Array.isArray(diagnostics.result.data.items)
    && diagnostics.result.data.items.length === 0,
  );
  const tests = [...calls].reverse().find((call) => isTest(call) && call.result && call.result.ok);
  report.tests = Boolean(tests) && report.acceptValid && report.rejectInvalid && report.rejectMalformed;
  const status = {
    "accept-valid": report.acceptValid,
    "reject-invalid": report.rejectInvalid,
    "reject-malformed": report.rejectMalformed,
    tests: report.tests,
    diagnostics: report.diagnostics,
  };
  for (const item of run.requirements || []) {
    if (!(item.id in status)) continue;
    item.status = status[item.id] ? "satisfied" : "failed";
  }
  return report;
}

function isTest(call) {
  const command = call.args && call.args.command ? call.args.command : "";
  if (call.name === "tests.run") return true;
  return call.name === "terminal.run" && (command === "npm test" || command.includes("test/"));
}

module.exports = { REQUIREMENTS, probe, applyProbe, isTest, HIDDEN_VALID, HIDDEN_INVALID };
