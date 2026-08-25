import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Importing a remote (https:) URL requires Node's experimental network
// imports flag. Re-exec ourselves with it set so `node scripts/gen-rules-json.mjs
// <version>` works as-is, without the caller needing to know about the flag.
const NETWORK_IMPORTS_FLAG = "--experimental-network-imports";

/**
 * Trims a raw `ruff rule --all --output-format json` entry down to the
 * fields the frontend actually needs, discarding the large `explanation`
 * markdown and other fields we don't use.
 *
 * @param {{code: string, name: string, linter: string, summary: string, fix_availability: string, preview: boolean}} raw
 * @param {Set<string>} enabledCodes - rule codes enabled by default (from Workspace.defaultSettings().lint.select)
 */
export function trimRule(raw, enabledCodes) {
  return {
    code: raw.code,
    name: raw.name,
    linter: raw.linter,
    summary: raw.summary,
    fixable: raw.fix_availability !== "None",
    preview: raw.preview,
    enabled: enabledCodes.has(raw.code),
  };
}

async function main() {
  const version = process.argv[2];
  if (!version) {
    console.error("Usage: node scripts/gen-rules-json.mjs <version>");
    process.exit(1);
  }

  // Step A: dump all rules from the ruff CLI via uv.
  const stdout = execFileSync(
    "uv",
    ["tool", "run", `ruff==${version}`, "rule", "--all", "--output-format", "json"],
    { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 },
  );
  const rawRules = JSON.parse(stdout);

  // Step B: load the wasm workspace to find which rules are enabled by default.
  // Note: under Node's --experimental-network-imports, wasm-bindgen/serde
  // deserializes the settings as a nested JS Map rather than a plain object
  // (unlike in a browser/Vite context) - `get()` handles both shapes.
  const cdnUrl = `https://cdn.jsdelivr.net/npm/@astral-sh/ruff-wasm-web@${version}/ruff_wasm.js`;
  const mod = await import(/* @vite-ignore */ cdnUrl);
  await mod.default();
  const defaults = mod.Workspace.defaultSettings();
  const get = (obj, key) => (obj instanceof Map ? obj.get(key) : obj[key]);
  const enabledCodes = new Set(get(get(defaults, "lint"), "select"));

  // Step C: trim every rule.
  const trimmed = rawRules.map((raw) => trimRule(raw, enabledCodes));

  // Step D: write to public/versions/<version>/rules.json.
  const outPath = `public/versions/${version}/rules.json`;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(trimmed, null, 2));

  console.log(`ruff ${version}: wrote ${trimmed.length} rules to ${outPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.execArgv.includes(NETWORK_IMPORTS_FLAG) && !process.env.RUFF_ONLINE_RELAUNCHED) {
    execFileSync(
      process.execPath,
      [NETWORK_IMPORTS_FLAG, process.argv[1], ...process.argv.slice(2)],
      { stdio: "inherit", env: { ...process.env, RUFF_ONLINE_RELAUNCHED: "1" } },
    );
  } else {
    main();
  }
}
