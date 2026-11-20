# Build entrypoint for the Buyer Contact solution.
#
# `sam build` must be preceded by the SDK selector (scripts/prepare-sdk.js),
# which decides whether the Buyer Contact clients come from the Lambda runtime
# or are bundled from src/vendor. Use these targets so the prebuild is never
# skipped. See scripts/README.md.

.PHONY: build deploy deploy-guided prepare clean

# Pass extra args through, e.g. `make deploy SAM_ARGS="--config-env prod"`.
SAM_ARGS ?=

# Select SDK strategy and write src/package.json.
prepare:
	node scripts/prepare-sdk.js

# Always run the selector before building.
build: prepare
	sam build

# Build (incl. prepare) then deploy.
deploy: build
	sam deploy $(SAM_ARGS)

# First-time guided deploy.
deploy-guided: build
	sam deploy --guided --capabilities CAPABILITY_NAMED_IAM $(SAM_ARGS)

# Remove build output and generated vendored tarballs (keeps src/vendor/README.md).
clean:
	rm -rf .aws-sam
	rm -f src/vendor/*.tgz
