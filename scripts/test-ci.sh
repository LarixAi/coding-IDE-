#!/bin/sh
# Scripted CI gate for GitHub Actions, Copilot, and ChatGPT/Codex.
# Only includes files that currently pass without live Ollama or n8n.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
node_bin="$root/.tools/node-v24.18.0-darwin-arm64/bin"

if [ -x "$node_bin/node" ]; then
	export PATH="$node_bin:$PATH"
	node="$node_bin/node"
else
	node="$(command -v node)"
fi

export CODEME_SKIP_LIVE="${CODEME_SKIP_LIVE:-1}"

"$node" "$root/packages/agent-tools/test/contract.test.js"
"$node" "$root/packages/agent-runtime/test/project-decision.test.js"
"$node" "$root/packages/agent-runtime/test/orchestration.test.js"
"$node" "$root/packages/feature-qualify/test/requirements.test.js"
"$node" "$root/extensions/codeme-shell/test/browser-interaction-runner.test.js"
"$node" "$root/extensions/codeme-shell/test/panel.test.js"
"$node" "$root/extensions/codeme-shell/test/conversation-store.test.js"
"$node" "$root/extensions/codeme-shell/test/workspace-inspector.test.js"
"$node" "$root/extensions/codeme-shell/test/image-meta.test.js"
