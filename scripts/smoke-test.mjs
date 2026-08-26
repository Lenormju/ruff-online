#!/usr/bin/env node
// CI health-gate: verifies a given @astral-sh/ruff-wasm-web version loads from
// the jsDelivr CDN and its Workspace API behaves as expected. This script is
// the test — there is no separate unit test for it.

const version = process.argv[2];

if (!version) {
  console.error("Usage: node scripts/smoke-test.mjs <version>");
  console.error("Example: node scripts/smoke-test.mjs 0.16.4");
  process.exit(1);
}

// Dynamic `import()` of an https:// URL requires Node's network-imports
// support, which is still experimental. Re-exec ourselves with the flag so
// callers can just run `node scripts/smoke-test.mjs <version>`.
if (!process.execArgv.includes("--experimental-network-imports")) {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(
    process.execPath,
    ["--experimental-network-imports", import.meta.filename, ...process.argv.slice(2)],
    { stdio: "inherit" }
  );
  process.exit(result.status ?? 1);
}

async function main() {
  const cdnUrl = `https://cdn.jsdelivr.net/npm/@astral-sh/ruff-wasm-web@${version}/ruff_wasm.js`;
  const mod = await import(cdnUrl);
  await mod.default();

  // Not all supported versions export `PositionEncoding` (added in
  // @astral-sh/ruff-wasm-web 0.13.2) — see src/engine/workspace.ts.
  const workspace = mod.PositionEncoding
    ? new mod.Workspace({}, mod.PositionEncoding.Utf16)
    : new mod.Workspace({});

  const checkResult = workspace.check("import os\n");
  if (!Array.isArray(checkResult)) {
    throw new Error(
      `workspace.check() returned ${typeof checkResult}, expected an array`
    );
  }

  const formatResult = workspace.format("x=1\n");
  if (typeof formatResult !== "string") {
    throw new Error(
      `workspace.format() returned ${typeof formatResult}, expected a string`
    );
  }

  console.log(`smoke-test OK: Ruff ${version}`);
  process.exit(0);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`smoke-test FAILED for Ruff ${version}: ${message}`);
  process.exit(1);
});
