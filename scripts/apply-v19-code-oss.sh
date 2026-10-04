#!/bin/sh
# Apply the CodeMe V19 native workbench patch to the pinned Code OSS source.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
code="$root/code-oss"
expected="04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1"
target="src/vs/workbench/browser/parts/activitybar/activitybarPart.ts"
backup_dir="$root/.tools/v19-native-backups"
backup="$backup_dir/activitybarPart.ts"

if [ ! -d "$code/.git" ] && [ ! -f "$code/.git" ]; then
  echo "Code OSS submodule is missing at $code" >&2
  exit 1
fi

current=$(git -C "$code" rev-parse HEAD)
if [ "$current" != "$expected" ]; then
  echo "Refusing to patch Code OSS at $current; expected pinned commit $expected" >&2
  exit 1
fi

mkdir -p "$backup_dir"
if [ ! -f "$backup" ]; then
  cp "$code/$target" "$backup"
fi

python3 - "$code/$target" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()

wanted = {
    "static readonly ACTION_HEIGHT = 48;": "static readonly ACTION_HEIGHT = 42;",
    "static readonly ACTIVITYBAR_WIDTH = 48;": "static readonly ACTIVITYBAR_WIDTH = 42;",
    "static readonly ICON_SIZE = 24;": "static readonly ICON_SIZE = 20;",
}

changed = False
for old, new in wanted.items():
    if new in text:
        continue
    if old not in text:
        raise SystemExit(f"Expected Code OSS line not found: {old}")
    text = text.replace(old, new, 1)
    changed = True

if changed:
    path.write_text(text)
    print("Applied CodeMe V19 native Activity Bar dimensions.")
else:
    print("CodeMe V19 native Activity Bar patch is already applied.")
PY

echo "Native V19 source patch ready."
echo "Next: run ./scripts/build-v19-native-workbench.sh"
