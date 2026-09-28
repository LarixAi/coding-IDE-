const fs = require("fs");
const path = require("path");
const { createWorkspaceHost } = require("../coding-qualify/host");

function createResearchWorkspaceHost(root) {
  const base = createWorkspaceHost(root);
  const rootReal = fs.realpathSync(root);
  return {
    ...base,
    async inspectWorkspace() {
      const entries = [];
      const languages = new Set();
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === ".git" || entry.name === "node_modules") continue;
          const full = path.join(dir, entry.name);
          const relative = path.relative(rootReal, full).split(path.sep).join("/");
          entries.push(relative);
          if (entry.isDirectory()) {
            walk(full);
            continue;
          }
          const ext = path.extname(entry.name).toLowerCase();
          if (ext === ".js" || ext === ".mjs" || ext === ".cjs") languages.add("javascript");
          else if (ext === ".ts" || ext === ".tsx") languages.add("typescript");
          else if (ext === ".json") languages.add("json");
        }
      };
      walk(rootReal);

      let scripts = {};
      let packageManager = "";
      const projectMarkers = [];
      const packagePath = path.join(rootReal, "package.json");
      if (fs.existsSync(packagePath)) {
        packageManager = "npm";
        projectMarkers.push("package.json");
        try {
          const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
          if (pkg && pkg.scripts && typeof pkg.scripts === "object") scripts = { ...pkg.scripts };
        } catch {
          scripts = {};
        }
      }

      return {
        state: entries.length ? "project" : "empty",
        root: path.basename(rootReal),
        entries: entries.length,
        git: fs.existsSync(path.join(rootReal, ".git")),
        projectMarkers,
        languages: [...languages].sort(),
        frameworks: [],
        packageManager,
        scripts,
      };
    },
  };
}

module.exports = { createResearchWorkspaceHost };
