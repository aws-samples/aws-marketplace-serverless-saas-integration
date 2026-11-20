# src/vendor — generated, do not hand-edit

This folder is **managed by `scripts/prepare-sdk.js`**. It is empty in version
control and is populated only when the build selects the **bundled** SDK
strategy.

- When the target Lambda runtime's built-in `@aws-sdk/client-marketplace-agreement`
  is confirmed `>= 3.1171.0`, `prepare-sdk.js` uses the **runtime** strategy and
  this folder stays empty.
- Otherwise it packs the current public clients (satisfying `^3.1171.0`) into
  this folder and points `src/package.json` at the resulting tarballs:
  - `aws-sdk-client-marketplace-agreement-<version>.tgz`
  - `aws-sdk-client-marketplace-metering-<version>.tgz`

These are **public registry** packages. No `overrides` block is needed: the
clients resolve a consistent set of shared `@aws-sdk/*` dependencies from the
registry on their own.

Run `node scripts/prepare-sdk.js` before `sam build`. See `scripts/README.md`.
