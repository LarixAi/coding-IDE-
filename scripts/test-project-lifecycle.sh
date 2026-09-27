#!/bin/sh
# Project lifecycle gate: native create/select folder, then open workspace.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
node_bin="$root/.tools/node-v24.18.0-darwin-arm64/bin"

if [ -x "$node_bin/node" ]; then
  node="$node_bin/node"
else
  node="$(command -v node)"
fi

"$node" "$root/extensions/codeme-shell/test/project-manager.test.js"
"$node" "$root/extensions/codeme-shell/test/welcome-actions.test.js"
"$node" "$root/extensions/codeme-shell/test/panel.test.js"
