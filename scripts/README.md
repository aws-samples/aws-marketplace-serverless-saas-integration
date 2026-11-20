# scripts/

Tooling for the Buyer Contact integration: SDK probes and the build-time SDK
selector.

## SDK delivery selector

The two Buyer Contact clients
(`@aws-sdk/client-marketplace-agreement`, `@aws-sdk/client-marketplace-metering`)
are provided in one of two ways, chosen automatically before `sam build`:

- **runtime** — the Lambda runtime's built-in SDK is new enough; nothing is
  bundled, `src/vendor` stays empty.
- **bundled** — the runtime SDK is older/unknown; the current public SDK
  (satisfying `^3.1171.0`) is packed into `src/vendor` and `src/package.json`
  points at those tarballs.

### Files

| File | Role |
|------|------|
| `prepare-sdk.js` | Prebuild selector. Decides strategy, writes `src/package.json`, populates/clears `src/vendor`. |
| `package.runtime.json` | Source variant: dependencies WITHOUT the two clients (runtime provides them). |
| `package.bundled.json` | Source variant: the two clients pinned to `file:vendor/...tgz` (paths rewritten by the selector). |
| `lambda/runtime-sdk.json` | Cached built-in SDK version per Lambda runtime (the selector reads this; option C — no live probe in the build). |

`src/package.json` is **generated** — edit the two `package.*.json` variants
here, then re-run the selector.

### Usage

```bash
node scripts/prepare-sdk.js      # pick strategy from the cache, write src/package.json
sam build
sam deploy ...
```

Override the decision:

```bash
FORCE_SDK_STRATEGY=runtime node scripts/prepare-sdk.js   # force runtime (ship nothing)
FORCE_SDK_STRATEGY=bundled node scripts/prepare-sdk.js   # force bundled (pack into src/vendor)
```

### How the decision is made

1. Target runtime = first `Runtime:` in `template.yaml` (default `nodejs24.x`).
2. Look up that runtime in `lambda/runtime-sdk.json`.
3. If its recorded `sdkVersion >= 3.1171.0` **and** `commandExported === true`
   → **runtime**. Otherwise (older, unknown, or missing) → **bundled**
   (fail-safe toward a deployable artifact).
4. `FORCE_SDK_STRATEGY` overrides steps 1–3.

### Refreshing the runtime SDK cache

`lambda/runtime-sdk.json` is a recorded measurement, not a live probe. Refresh
it when AWS updates the runtime SDK:

```bash
cd scripts/lambda
./deploy.sh            # deploy the probe on the target runtime
./invoke.sh            # prints the built-in sdkVersion + commandExported
```

Then update the matching runtime entry in `lambda/runtime-sdk.json`.

## Probes (verification helpers)

- `get-agreement-contact.js` — Node probe: calls `GetAgreementContacts` using the
  public SDK installed under `scripts/node_modules`. `node scripts/get-agreement-contact.js <agreement-id>`
- `get_agreement_contact.py` — Python/boto3 equivalent. `python3 scripts/get_agreement_contact.py <agreement-id>`
- `lambda/` — deploys a throwaway Lambda that reports the runtime's built-in SDK
  version and whether `GetAgreementContactsCommand` is exported. See `lambda/README.md`.
