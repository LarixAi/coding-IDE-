const fs = require("fs");
const path = require("path");

const REQUIREMENTS = [
  { id: "registration-endpoint", text: "Add a user registration endpoint." },
  { id: "validate-name", text: "Validate the user's name." },
  { id: "validate-email", text: "Validate the user's email." },
  { id: "invalid-errors", text: "Reject invalid input with an error." },
  { id: "duplicate-email", text: "Prevent duplicate email registration." },
  { id: "repository-storage", text: "Store valid users through the existing repository layer." },
  { id: "tests", text: "Tests exercise registration, validation, and duplicates." },
];

function loadApp(workspace) {
  const root = path.resolve(workspace);
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(root)) delete require.cache[key];
  }
  return require(path.join(root, "src/app.js")).createApp();
}

function sourceFiles(workspace) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) files.push(full);
    }
  };
  walk(path.join(workspace, "src"));
  return files;
}

function probe(workspace) {
  const notes = [];
  const report = {
    endpoint: false,
    name: false,
    email: false,
    errors: false,
    duplicate: false,
    repository: false,
    tests: false,
    health: false,
    notes,
  };
  let app;
  try {
    app = loadApp(workspace);
    const health = app.handle({ method: "GET", path: "/health" });
    report.health = health.status === 200 && health.body && health.body.ok === true;
  } catch (error) {
    notes.push(error instanceof Error ? error.message : String(error));
    return report;
  }

  const post = (body) => app.handle({ method: "POST", path: "/users", body });
  try {
    const missingName = post({ email: "ada@example.com" });
    const emptyName = post({ name: "  ", email: "ada@example.com" });
    const badEmail = post({ name: "Ada", email: "not-an-email" });
    const created = post({ name: "Ada", email: "ada@example.com" });
    const duplicate = post({ name: "Ada", email: "ada@example.com" });
    const stored = app.users.findByEmail("ada@example.com");
    report.name = missingName.status === 400 && emptyName.status === 400;
    report.email = badEmail.status === 400;
    report.errors = Boolean(missingName.body && missingName.body.error && badEmail.body && badEmail.body.error && duplicate.body && duplicate.body.error);
    report.endpoint = created.status === 201;
    report.duplicate = duplicate.status === 409 && app.users.list().length === 1;
    report.repository = Boolean(stored && stored.name === "Ada" && stored.email === "ada@example.com");
  } catch (error) {
    notes.push(error instanceof Error ? error.message : String(error));
  }

  const repositoryFile = path.join(workspace, "src/users/repository.js");
  const repositorySource = fs.existsSync(repositoryFile) ? fs.readFileSync(repositoryFile, "utf8") : "";
  const callers = sourceFiles(workspace)
    .filter((file) => path.basename(file) !== "repository.js")
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
  report.repository = report.repository && repositorySource.includes("findByEmail") && repositorySource.includes("add(") && callers.includes(".add(") && callers.includes(".findByEmail(");

  const testFile = path.join(workspace, "test/register.test.js");
  const testSource = fs.existsSync(testFile) ? fs.readFileSync(testFile, "utf8") : "";
  report.tests = report.health && ["400", "409", "201", "findByEmail"].every((part) => testSource.includes(part));
  return report;
}

function applyProbe(run, workspace) {
  const report = probe(workspace);
  const status = {
    "registration-endpoint": report.endpoint,
    "validate-name": report.name,
    "validate-email": report.email,
    "invalid-errors": report.errors,
    "duplicate-email": report.duplicate,
    "repository-storage": report.repository,
    tests: report.tests,
  };
  for (const item of run.requirements || []) {
    if (!(item.id in status)) continue;
    item.status = status[item.id] ? "satisfied" : "failed";
  }
  return report;
}

module.exports = { REQUIREMENTS, probe, applyProbe, loadApp };
