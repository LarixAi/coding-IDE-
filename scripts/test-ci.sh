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
"$node" "$root/packages/agent-runtime/test/rule-decision.test.js"
"$node" "$root/packages/agent-runtime/test/project-decision.test.js"
"$node" "$root/packages/agent-runtime/test/orchestration.test.js"
"$node" "$root/packages/agent-runtime/test/select-capability.test.js"
"$node" "$root/packages/agent-runtime/test/stagnation.test.js"
"$node" "$root/packages/research-qualify/test/fallback.test.js"
"$node" "$root/packages/research-qualify/test/research-integration.test.js"
"$node" "$root/packages/research-qualify/test/gate10-qualification.test.js"
"$node" "$root/packages/n8n-capability/test/capabilities.test.js"
"$node" "$root/packages/n8n-capability/test/registry.test.js"
"$node" "$root/packages/n8n-capability/test/foundation.test.js"
"$node" "$root/packages/feature-qualify/test/requirements.test.js"
"$node" "$root/extensions/codeme-shell/test/browser-interaction-runner.test.js"
"$node" "$root/extensions/codeme-shell/test/conversation-store.test.js"
"$node" "$root/extensions/codeme-shell/test/workspace-inspector.test.js"
"$node" "$root/extensions/codeme-shell/test/image-meta.test.js"
