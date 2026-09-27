const fs = require("fs");
const path = require("path");

class RunStore {
  constructor(directory) {
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true });
  }

  pathFor(id) {
    return path.join(this.directory, `${id}.json`);
  }

  save(run) {
    const file = this.pathFor(run.id);
    const previous = `${file}.prev`;
    if (fs.existsSync(file)) fs.copyFileSync(file, previous);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(run, null, 2));
    fs.renameSync(tmp, file);
    return run;
  }

  load(id) {
    const file = this.pathFor(id);
    const parsed = readJson(file);
    if (parsed) return parsed;
    return readJson(`${file}.prev`);
  }
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

module.exports = { RunStore };
