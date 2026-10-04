#!/bin/sh
# Restore the Code OSS source file backed up before applying the V19 native patch.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
target="$root/code-oss/src/vs/workbench/browser/parts/activitybar/activitybarPart.ts"
backup="$root/.tools/v19-native-backups/activitybarPart.ts"

if [ ! -f "$backup" ]; then
  echo "No V19 native Code OSS backup exists; nothing to restore."
  exit 0
fi

cp "$backup" "$target"
echo "Restored the pre-V19 Code OSS Activity Bar source."
echo "Run npm run compile inside code-oss to rebuild the restored workbench."
