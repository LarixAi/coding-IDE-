#!/bin/sh
# Gate 11: intelligent capability routing qualification.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
node_bin="$root/.tools/node-v24.18.0-darwin-arm64/bin"

if [ -x "$node_bin/node" ]; then
  node="$node_bin/node"
else
  node="$(command -v node)"
fi

"$node" "$root/packages/agent-runtime/test/select-capability.test.js"
"$node" "$root/packages/routing-qualify/test/gate11-qualification.test.js"
