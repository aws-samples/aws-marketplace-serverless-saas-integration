#!/bin/bash
set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <stack-name>"
  exit 1
fi

STACK_NAME="$1"

BUCKET=$(aws cloudformation describe-stack-resource \
  --stack-name "$STACK_NAME" \
  --logical-resource-id WebsiteS3BucketLog \
  --query "StackResourceDetail.PhysicalResourceId" \
  --output text)

echo "Emptying bucket: $BUCKET"
aws s3 rm "s3://${BUCKET}" --recursive
echo "Done."
