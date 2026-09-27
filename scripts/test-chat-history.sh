#!/bin/sh
# Composer chat history gate: persistence, multi-turn context, new/open chat controls.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
node_bin="$root/.tools/node-v24.18.0-darwin-arm64/bin"

if [ -x "$node_bin/node" ]; then
  node="$node_bin/node"
else
  node="$(command -v node)"
fi

"$node" "$root/extensions/codeme-shell/test/conversation-store.test.js"
"$node" "$root/extensions/codeme-shell/test/composer.test.js"
