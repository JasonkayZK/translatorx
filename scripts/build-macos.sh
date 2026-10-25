#!/usr/bin/env bash
# Keep the signing identity stable so macOS can recognize subsequent builds.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$(uname -s)" != Darwin ]]; then
  printf '%s\n' "This signed build command requires macOS." >&2
  exit 1
fi
translatorx_identity="${TRANSLATORX_SIGNING_IDENTITY:-${APPLE_SIGNING_IDENTITY:-}}"
if [[ -z "$translatorx_identity" || "$translatorx_identity" == "-" ]]; then
  printf '%s\n' "Set TRANSLATORX_SIGNING_IDENTITY to your persistent code-signing certificate." \
    "Available identities: security find-identity -v -p codesigning" \
    "See docs/macos-signing.md. An ad-hoc build cannot reliably retain Accessibility permission across updates." >&2
  exit 1
fi
translatorx_config="$(mktemp "${TMPDIR:-/tmp}/translatorx-signing.XXXXXX")"
trap 'rm -f "$translatorx_config"' EXIT
python3 - "$translatorx_identity" "$translatorx_config" <<'PY'
import json, sys
with open(sys.argv[2], "w") as file:
    json.dump({"bundle": {"macOS": {"signingIdentity": sys.argv[1]}}}, file)
PY
# Put the required signing configuration last so another config cannot silently replace it.
pnpm tauri build "$@" --config "$translatorx_config"
printf '%s\n' "Signed build finished. Verify the resulting app with scripts/verify-macos-signature.sh before installing."
