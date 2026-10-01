#!/usr/bin/env bash
# Installs the packaged VSIX into an ISOLATED profile (never your real one), then uninstalls it,
# asserting that Copilot-related settings are byte-identical throughout.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CODE="${CODE_CLI:-/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code}"
SB="$ROOT/.vscode-test/lifecycle"; rm -rf "$SB"; mkdir -p "$SB/user-data/User" "$SB/ext"
cat > "$SB/user-data/User/settings.json" <<JSON
{ "github.copilot.enable": {"*": true}, "github.copilot.chat.customOAIModels": {"s": {"name": "S"}}, "chat.agent.enabled": true }
JSON
cp "$SB/user-data/User/settings.json" "$SB/before.json"
args=(--user-data-dir "$SB/user-data" --extensions-dir "$SB/ext")
if [ "${WITH_COPILOT:-0}" = 1 ]; then "$CODE" "${args[@]}" --install-extension GitHub.copilot-chat || true; fi
"$CODE" "${args[@]}" --install-extension "$ROOT/llm-bridge-ai-1.0.0.vsix"
"$CODE" "${args[@]}" --list-extensions --show-versions | tee "$SB/installed.txt"
grep -q '^iitdeveloper.llm-bridge-ai@1.0.0$' "$SB/installed.txt"
cmp "$SB/before.json" "$SB/user-data/User/settings.json" && echo "OK: settings unchanged after install"
"$CODE" "${args[@]}" --uninstall-extension iitdeveloper.llm-bridge-ai
"$CODE" "${args[@]}" --list-extensions | grep -q 'iitdeveloper.llm-bridge-ai' && { echo "FAIL: still installed"; exit 1; } || echo "OK: uninstalled"
cmp "$SB/before.json" "$SB/user-data/User/settings.json" && echo "OK: settings unchanged after uninstall"
# Copilot Chat is built into recent VS Code, so it is not listed as a user extension; nothing of it is touched either way.
echo "DONE"
