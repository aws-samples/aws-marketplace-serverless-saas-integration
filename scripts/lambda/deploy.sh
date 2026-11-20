#!/usr/bin/env bash
#
# deploy.sh — create (or update) the GetAgreementContacts Lambda probe.
#
# The function is deployed WITHOUT a bundled SDK: it imports
# @aws-sdk/client-marketplace-agreement from the Lambda Node.js runtime, so
# invoking it tells us whether the runtime's built-in SDK is recent enough.
#
# Usage:
#   ./deploy.sh                 # create/update function + role
#   RUNTIME=nodejs20.x ./deploy.sh
#
# Env:
#   FUNCTION_NAME   default: probe-get-agreement-contact
#   ROLE_NAME       default: probe-get-agreement-contact-role
#   RUNTIME         default: nodejs22.x
#   REGION          default: us-east-1
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FUNCTION_NAME="${FUNCTION_NAME:-probe-get-agreement-contact}"
ROLE_NAME="${ROLE_NAME:-probe-get-agreement-contact-role}"
RUNTIME="${RUNTIME:-nodejs22.x}"
REGION="${REGION:-us-east-1}"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"

echo ">> account=${ACCOUNT_ID} region=${REGION} runtime=${RUNTIME}"

# --- IAM role -------------------------------------------------------------
if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo ">> role ${ROLE_NAME} exists"
else
  echo ">> creating role ${ROLE_NAME}"
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "file://${HERE}/trust-policy.json" \
    --description "Probe role for GetAgreementContacts Lambda (temporary)" >/dev/null
  aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  echo ">> waiting for role to propagate..."
  sleep 12
fi

# Always (re)put the marketplace permission so updates stay in sync.
aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name get-agreement-contacts \
  --policy-document "file://${HERE}/permissions-policy.json"

# --- package --------------------------------------------------------------
ZIP="${HERE}/function.zip"
rm -f "$ZIP"
( cd "$HERE" && zip -q "$ZIP" index.mjs )
echo ">> packaged $(basename "$ZIP")"

# --- create or update function -------------------------------------------
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo ">> updating function code ${FUNCTION_NAME}"
  aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file "fileb://${ZIP}" \
    --region "$REGION" >/dev/null
  aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"
  aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --runtime "$RUNTIME" \
    --timeout 30 \
    --region "$REGION" >/dev/null
  aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"
else
  echo ">> creating function ${FUNCTION_NAME}"
  aws lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --runtime "$RUNTIME" \
    --role "$ROLE_ARN" \
    --handler index.handler \
    --timeout 30 \
    --zip-file "fileb://${ZIP}" \
    --region "$REGION" >/dev/null
  aws lambda wait function-active --function-name "$FUNCTION_NAME" --region "$REGION"
fi

echo ">> done. function=${FUNCTION_NAME}"
echo ">> invoke with: ./invoke.sh <agreement-id>"
