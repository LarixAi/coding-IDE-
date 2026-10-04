#!/bin/sh
# Apply and compile the native CodeMe V19 workbench against the pinned Code OSS checkout.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)

"$root/scripts/apply-v19-code-oss.sh"

node_bin="$root/.tools/node-v24.18.0-darwin-arm64/bin"
if [ -d "$node_bin" ]; then
  export PATH="$node_bin:$PATH"
fi

cd "$root/code-oss"

if [ ! -d node_modules ]; then
  echo "Code OSS dependencies are missing. Run npm install in code-oss first." >&2
  exit 1
fi

npm run compile

echo
echo "CodeMe V19 native workbench compiled."
echo "Launch with: ../scripts/launch-codeme.sh"
