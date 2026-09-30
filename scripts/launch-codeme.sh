#!/bin/sh
# Launch the pinned Code - OSS build with the minimal CodeMe shell.
# Explorer, editor, and terminal stay the native Code - OSS tools.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
node_bin="$root/.tools/node-v24.18.0-darwin-arm64/bin"
user_data="$root/.tools/codeme-user-data"

if [ ! -x "$node_bin/node" ]; then
	echo "Node 24.18.0 is missing at $node_bin. Install it before launching." >&2
	exit 1
fi
if [ ! -x "$root/code-oss/.build/electron/Code - OSS.app/Contents/MacOS/Code - OSS" ]; then
	echo "Code - OSS is not built. From code-oss/, run npm install and node build/lib/preLaunch.ts." >&2
	exit 1
fi

mkdir -p "$user_data"

# Load CodeMe runtime endpoints from a local .env file when present.
# .env is machine-local and must not be committed.
if [ -f "$root/.env" ]; then
	set -a
	. "$root/.env"
	set +a
fi

export PATH="$node_bin:$PATH"
export VSCODE_SKIP_PRELAUNCH=1

# The Code - OSS pin keeps the upstream product name. Swap the dock icon
# in the built app so Finder and the Dock show the CodeMe mark.
app_bundle="$root/code-oss/.build/electron/Code - OSS.app"

# The previous experimental microphone patch modified the live Code - OSS
# webview runtime and can leave extension webviews blank. Keep the normal
# launcher on the known-good runtime by restoring those generated files first.
# Microphone patching can still be tested explicitly by setting
# CODEME_EXPERIMENTAL_MICROPHONE_PATCH=1.
if [ "${CODEME_EXPERIMENTAL_MICROPHONE_PATCH:-0}" = "1" ]; then
	"$node_bin/node" "$root/scripts/patch-codeme-microphone.js" "$root"
else
	"$node_bin/node" "$root/scripts/restore-codeme-webview.js" "$root"
fi

icon_src="$root/branding/macos/CodeMe.icns"
icon_dest="$app_bundle/Contents/Resources/Code - OSS.icns"
if [ -f "$icon_src" ] && [ -f "$icon_dest" ] && ! cmp -s "$icon_src" "$icon_dest"; then
	cp "$icon_src" "$icon_dest"
	touch "$app_bundle"
fi

ext_dir="$root/.tools/codeme-extensions"
mkdir -p "$ext_dir"
ln -sfn "$root/extensions/codeme-shell" "$ext_dir/codeme.codeme-shell-0.1.0"

export NODE_ENV=development
export VSCODE_DEV=1
export VSCODE_CLI=1
cd "$root/code-oss"
# The leading "." is the Electron app path in dev. Code - OSS strips it
# and does not open that folder as the workspace.
exec "$app_bundle/Contents/MacOS/Code - OSS" . \
	--extensions-dir="$ext_dir" \
	--disable-extension=vscode.vscode-api-tests \
	--disable-workspace-trust \
	--user-data-dir="$user_data" \
	"$@"
