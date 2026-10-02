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

"$node" "$root/scripts/check-pipeline-lock.js"

"$node" "$root/packages/agent-tools/test/contract.test.js"
"$node" "$root/packages/agent-runtime/test/rule-decision.test.js"
"$node" "$root/packages/agent-runtime/test/model-provider.test.js"
"$node" "$root/packages/agent-runtime/test/mode-contract.test.js"
"$node" "$root/packages/agent-runtime/test/project-decision.test.js"
"$node" "$root/packages/agent-runtime/test/orchestration.test.js"
"$node" "$root/packages/agent-runtime/test/pipeline-v2.test.js"
"$node" "$root/packages/agent-runtime/test/select-capability.test.js"
"$node" "$root/packages/routing-qualify/test/gate11-qualification.test.js"
"$node" "$root/packages/agent-runtime/test/stagnation.test.js"
"$node" "$root/packages/agent-runtime/test/research-only.test.js"
"$node" "$root/packages/research-qualify/test/fallback.test.js"
"$node" "$root/packages/research-qualify/test/research-integration.test.js"
"$node" "$root/packages/research-qualify/test/gate10-qualification.test.js"
"$node" "$root/packages/n8n-capability/test/capabilities.test.js"
"$node" "$root/packages/n8n-capability/test/registry.test.js"
"$node" "$root/packages/n8n-capability/test/foundation.test.js"
"$node" "$root/packages/n8n-capability/test/mcp.test.js"
"$node" "$root/packages/feature-qualify/test/requirements.test.js"
"$node" "$root/extensions/codeme-shell/test/tab-policy.test.js"
"$node" "$root/extensions/codeme-shell/test/preview-runner.test.js"
"$node" "$root/extensions/codeme-shell/test/preview-session-manager.test.js"
"$node" "$root/extensions/codeme-shell/test/browser-interaction-runner.test.js"
"$node" "$root/extensions/codeme-shell/test/conversation-store.test.js"
"$node" "$root/extensions/codeme-shell/test/panel.test.js"
"$node" "$root/extensions/codeme-shell/test/mode-contracts.test.js"
"$node" "$root/extensions/codeme-shell/test/debug-mode.test.js"
"$node" "$root/extensions/codeme-shell/test/verification-mode.test.js"
"$node" "$root/extensions/codeme-shell/test/multitask-controller.test.js"
"$node" "$root/extensions/codeme-shell/test/paperclip-multitask.test.js"
"$node" "$root/extensions/codeme-shell/test/composer-stream.test.js"
"$node" "$root/extensions/codeme-shell/test/composer-final-text.test.js"
"$node" "$root/extensions/codeme-shell/test/model-selection.test.js"
"$node" "$root/extensions/codeme-shell/test/model-tool-compat.test.js"
"$node" "$root/extensions/codeme-shell/test/model-response-policy.test.js"
"$node" "$root/extensions/codeme-shell/test/runtime-config.test.js"
"$node" "$root/extensions/codeme-shell/test/composer-pipeline-v2.test.js"
"$node" "$root/extensions/codeme-shell/test/workspace-inspector.test.js"
"$node" "$root/extensions/codeme-shell/test/image-meta.test.js"
"$node" "$root/extensions/codeme-shell/test/n8n-image-bridge.test.js"
"$node" "$root/extensions/codeme-shell/test/prompt-enhancement-gate.test.js"
"$node" "$root/packages/paperclip-control/test/multi-agent.test.js"
"$node" "$root/packages/paperclip-control/test/paperclip-control.test.js"
"$node" "$root/packages/paperclip-control/test/team-orchestrator.test.js"
