const fs = require("fs");
const path = require("path");

function stripQuotes(value) {
  const text = String(value || "").trim();
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return text.slice(1, -1);
    }
  }
  return text;
}

function parseEnvText(text) {
  const values = {};
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const match = normalized.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2];
    if (!/^["']/.test(value)) {
      value = value.replace(/\s+#.*$/, "");
    }
    values[match[1]] = stripQuotes(value);
  }
  return values;
}

function looksLikeCodeMeRoot(candidate) {
  if (!candidate) return false;
  try {
    return (
      fs.existsSync(path.join(candidate, ".env.example"))
      && fs.existsSync(path.join(candidate, "packages", "agent-runtime"))
      && fs.existsSync(path.join(candidate, "extensions", "codeme-shell"))
    );
  } catch {
    return false;
  }
}

function findCodeMeRoot(options = {}) {
  const starts = [
    options.root,
    process.env.CODEME_ROOT,
    path.resolve(__dirname, "../.."),
    path.resolve(process.cwd(), ".."),
    process.cwd(),
  ].filter(Boolean);

  const visited = new Set();
  for (const start of starts) {
    let current = path.resolve(start);
    for (let depth = 0; depth < 6; depth += 1) {
      if (visited.has(current)) break;
      visited.add(current);
      if (looksLikeCodeMeRoot(current)) return current;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return "";
}

function loadRuntimeEnv(options = {}) {
  const targetEnv = options.env || process.env;
  const root = findCodeMeRoot(options);
  if (!root) return { loaded: false, root: "", file: "", keys: [], reason: "root_not_found" };

  const file = path.join(root, ".env");
  if (!fs.existsSync(file)) {
    return { loaded: false, root, file, keys: [], reason: "env_not_found" };
  }

  let parsed;
  try {
    parsed = parseEnvText(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return {
      loaded: false,
      root,
      file,
      keys: [],
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const loadedKeys = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (options.override || targetEnv[key] == null || targetEnv[key] === "") {
      targetEnv[key] = value;
      loadedKeys.push(key);
    }
  }
  return { loaded: true, root, file, keys: loadedKeys, reason: "" };
}

module.exports = {
  parseEnvText,
  findCodeMeRoot,
  loadRuntimeEnv,
};
