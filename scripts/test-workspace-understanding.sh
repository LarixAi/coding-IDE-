#!/bin/sh
# Gate 2: deterministic, read-only workspace understanding.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
node_bin="$root/.tools/node-v24.18.0-darwin-arm64/bin"

if [ -x "$node_bin/node" ]; then
  node="$node_bin/node"
else
  node="$(command -v node)"
fi

"$node" "$root/packages/agent-tools/test/contract.test.js"
"$node" "$root/extensions/codeme-shell/test/workspace-inspector.test.js"
