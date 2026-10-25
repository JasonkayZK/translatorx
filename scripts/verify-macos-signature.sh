#!/usr/bin/env bash
# Read-only verification, also useful with an installed app or custom Cargo target directory.
set -euo pipefail
translatorx_app="${1:-src-tauri/target/release/bundle/macos/TranslatorX.app}"
/usr/bin/codesign --verify --deep --strict "$translatorx_app"
translatorx_details="$(/usr/bin/codesign -dvv -r- "$translatorx_app" 2>&1)"
if [[ "$translatorx_details" != *"Identifier=com.translatorx.desktop"* || "$translatorx_details" != *"Authority="* || "$translatorx_details" == *"Signature=adhoc"* || "$translatorx_details" == *"designated => cdhash"* ]]; then
  printf '%s\n' "The app does not have a stable certificate identity. See docs/macos-signing.md." >&2
  exit 1
fi
printf '%s\n' "$translatorx_details"
