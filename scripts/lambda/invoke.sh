#!/usr/bin/env bash
#
# invoke.sh — invoke the GetAgreementContacts Lambda probe with an agreement id.
#
# Usage:
#   ./invoke.sh <agreement-id>
#   ./invoke.sh                 # invoke with no agreementId (SDK-availability check only)
#
# Env:
#   FUNCTION_NAME   default: probe-get-agreement-contact
#   REGION          default: us-east-1
set -euo pipefail

FUNCTION_NAME="${FUNCTION_NAME:-probe-get-agreement-contact}"
REGION="${REGION:-us-east-1}"
AGREEMENT_ID="${1:-}"

if [[ -n "$AGREEMENT_ID" ]]; then
  PAYLOAD="$(printf '{"agreementId":"%s"}' "$AGREEMENT_ID")"
else
  PAYLOAD='{}'
fi

OUT="$(mktemp)"
echo ">> invoking ${FUNCTION_NAME} with payload: ${PAYLOAD}"

# AWS CLI v2 requires --cli-binary-format raw-in-base64-out for a raw JSON
# --payload; CLI v1 does not support that flag and takes the string directly.
CLI_MAJOR="$(aws --version 2>&1 | sed -n 's#^aws-cli/\([0-9]*\).*#\1#p')"
BINFMT=()
if [[ "${CLI_MAJOR:-1}" -ge 2 ]]; then
  BINFMT=(--cli-binary-format raw-in-base64-out)
fi

aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --payload "$PAYLOAD" \
  "${BINFMT[@]}" \
  --region "$REGION" \
  "$OUT" >/dev/null

echo ">> response:"
if command -v jq >/dev/null 2>&1; then
  jq . "$OUT"
else
  cat "$OUT"; echo
fi
rm -f "$OUT"
