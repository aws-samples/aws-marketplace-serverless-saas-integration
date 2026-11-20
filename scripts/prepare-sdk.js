#!/usr/bin/env node
/*
 * prepare-sdk.js — SDK delivery selector (run BEFORE `sam build`).
 *
 * Decides how the two Buyer Contact clients
 *   @aws-sdk/client-marketplace-agreement
 *   @aws-sdk/client-marketplace-metering
 * are provided to the Lambda functions, then writes src/package.json accordingly.
 *
 * Decision (fail-safe toward a working deploy):
 *   - If the target Lambda runtime's BUILT-IN SDK is confirmed >= THRESHOLD
 *     (3.1171.0) AND exports GetAgreementContactsCommand:
 *         -> "runtime" strategy. Nothing bundled. src/vendor/ left empty.
 *         -> src/package.json = scripts/package.runtime.json
 *   - Otherwise (older / unknown / not confirmed):
 *         -> "bundled" strategy. Pack the current public SDK (satisfying
 *            ^3.1171.0) into src/vendor/, and point src/package.json at those
 *            tarballs via file: paths.
 *         -> src/package.json = scripts/package.bundled.json (file: lines
 *            rewritten to the exact packed filenames)
 *
 * The runtime version is NOT probed live during this build (option C). It is
 * read from the checked-in cache scripts/lambda/runtime-sdk.json, which is
 * refreshed on demand with the scripts/lambda probe. Override with:
 *   FORCE_SDK_STRATEGY=runtime | bundled
 *
 * Usage:
 *   node scripts/prepare-sdk.js
 *   FORCE_SDK_STRATEGY=runtime node scripts/prepare-sdk.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const SRC = path.join(REPO, "src");
const VENDOR = path.join(SRC, "vendor");
const CACHE = path.join(__dirname, "lambda", "runtime-sdk.json");
const RUNTIME_VARIANT = path.join(__dirname, "package.runtime.json");
const BUNDLED_VARIANT = path.join(__dirname, "package.bundled.json");
const SRC_PACKAGE = path.join(SRC, "package.json");

const CLIENTS = [
  "@aws-sdk/client-marketplace-agreement",
  "@aws-sdk/client-marketplace-metering",
];

function log(...args) {
  console.log("[prepare-sdk]", ...args);
}

// Compare two semver strings a>=b. Simple numeric compare of major.minor.patch.
function gte(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10));
  const pb = String(b).split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return true; // equal
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// Read the target runtime from template.yaml (first `Runtime:` line); default nodejs24.x.
function detectTargetRuntime() {
  try {
    const tpl = fs.readFileSync(path.join(REPO, "template.yaml"), "utf8");
    const m = tpl.match(/Runtime:\s*([A-Za-z0-9.]+)/);
    if (m) return m[1];
  } catch (_) { /* fall through */ }
  return "nodejs24.x";
}

function decideStrategy() {
  const forced = process.env.FORCE_SDK_STRATEGY;
  if (forced) {
    if (forced !== "runtime" && forced !== "bundled") {
      throw new Error(`FORCE_SDK_STRATEGY must be 'runtime' or 'bundled', got '${forced}'`);
    }
    log(`FORCE_SDK_STRATEGY=${forced} (override)`);
    return { strategy: forced, reason: "forced via FORCE_SDK_STRATEGY", runtime: detectTargetRuntime() };
  }

  const runtime = detectTargetRuntime();
  const cache = readJson(CACHE);
  const threshold = cache.threshold;
  const entry = cache.runtimes && cache.runtimes[runtime];

  if (!entry) {
    return {
      strategy: "bundled",
      runtime,
      reason: `no recorded runtime-sdk.json entry for ${runtime} (unknown -> fail-safe to bundled). ` +
        `Refresh via scripts/lambda probe, or set FORCE_SDK_STRATEGY.`,
    };
  }

  const confirmedOk = entry.commandExported === true && gte(entry.sdkVersion, threshold);
  if (confirmedOk) {
    return {
      strategy: "runtime",
      runtime,
      reason: `runtime ${runtime} built-in SDK ${entry.sdkVersion} >= ${threshold} and exports the command`,
    };
  }
  return {
    strategy: "bundled",
    runtime,
    reason: `runtime ${runtime} built-in SDK ${entry.sdkVersion} not confirmed >= ${threshold} ` +
      `(commandExported=${entry.commandExported}) -> fail-safe to bundled`,
  };
}

// Remove all tarballs from src/vendor but keep the (empty) directory + .gitkeep.
function cleanVendor() {
  fs.mkdirSync(VENDOR, { recursive: true });
  for (const f of fs.readdirSync(VENDOR)) {
    if (f.endsWith(".tgz")) fs.rmSync(path.join(VENDOR, f));
  }
}

function applyRuntime() {
  cleanVendor();
  const pkg = readJson(RUNTIME_VARIANT);
  fs.writeFileSync(SRC_PACKAGE, JSON.stringify(pkg, null, 2) + "\n");
  log("wrote src/package.json from package.runtime.json (no SDK bundled)");
  log("src/vendor left empty");
}

function applyBundled() {
  cleanVendor();
  log(`packing public clients (^3.1171.0) into src/vendor ...`);
  const packed = {};
  for (const client of CLIENTS) {
    // npm pack prints the produced filename on stdout.
    const out = execFileSync(
      "npm",
      ["pack", `${client}@^3.1171.0`, "--pack-destination", VENDOR, "--silent", "--no-audit", "--no-fund"],
      { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
    ).trim();
    const file = out.split("\n").pop().trim();
    packed[client] = file;
    log(`  packed ${client} -> vendor/${file}`);
  }

  const pkg = readJson(BUNDLED_VARIANT);
  for (const client of CLIENTS) {
    pkg.dependencies[client] = `file:vendor/${packed[client]}`;
  }
  fs.writeFileSync(SRC_PACKAGE, JSON.stringify(pkg, null, 2) + "\n");
  log("wrote src/package.json from package.bundled.json with exact tarball paths");
}

function main() {
  const { strategy, reason, runtime } = decideStrategy();
  log(`target runtime: ${runtime}`);
  log(`strategy: ${strategy} — ${reason}`);

  if (strategy === "runtime") {
    applyRuntime();
  } else {
    applyBundled();
  }

  log("done. Next: sam build");
}

try {
  main();
} catch (err) {
  console.error("[prepare-sdk] ERROR:", err.message);
  process.exit(1);
}
