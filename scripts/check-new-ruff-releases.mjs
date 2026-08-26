#!/usr/bin/env node
// Checks the astral-sh/ruff GitHub releases feed for stable versions that
// aren't yet listed in public/supported-versions.json. Prints a JSON array
// of new tag_names to stdout (and only that, so a CI step can capture it
// cleanly); human-readable logging goes to stderr.

import { readFileSync } from "node:fs";

const RELEASES_URL =
  "https://api.github.com/repos/astral-sh/ruff/releases?per_page=100";
const SUPPORTED_VERSIONS_PATH = "public/supported-versions.json";

// @astral-sh/ruff-wasm-web renamed the diagnostic `location` field to
// `start_location` starting at this version (see src/engine/workspace.ts) —
// older builds return a shape our code doesn't parse. Versions from here up
// to 0.13.1 lack the separate `PositionEncoding` export added at 0.13.2;
// src/engine/workspace.ts falls back to the wasm module's default (codepoint,
// not UTF-16) position encoding for those, which is only cosmetically
// inaccurate on lines with astral-plane Unicode characters.
//
// Below this floor (0.5.3 - 0.11.0, the oldest ever published to npm) two more
// incompatibilities exist that aren't handled yet and would need real work to
// support: no `start_location` field at all (still `location`), and no
// `"invalid-syntax"` diagnostic code to detect syntax errors by (message text
// only). The `Workspace` options schema across that whole span is also
// unverified. Could be supported later if worth the effort.
const MIN_SUPPORTED_VERSION = "0.11.1";

function isAtLeast(version, floor) {
  const v = version.split(".").map(Number);
  const f = floor.split(".").map(Number);
  for (let i = 0; i < f.length; i++) {
    if ((v[i] ?? 0) !== f[i]) return (v[i] ?? 0) > f[i];
  }
  return true;
}

/**
 * @param {{tag_name: string, draft: boolean, prerelease: boolean, published_at: string}[]} releases
 * @param {string[]} existingVersions
 * @returns {{version: string, releaseDate: string}[]}
 */
export function findNewVersions(releases, existingVersions) {
  const known = new Set(existingVersions);
  return releases
    .filter(
      (release) =>
        !release.draft &&
        !release.prerelease &&
        !known.has(release.tag_name) &&
        isAtLeast(release.tag_name, MIN_SUPPORTED_VERSION)
    )
    .map((release) => ({
      version: release.tag_name,
      releaseDate: release.published_at.slice(0, 10),
    }));
}

function readExistingVersions() {
  let raw;
  try {
    raw = readFileSync(SUPPORTED_VERSIONS_PATH, "utf-8");
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(
        `${SUPPORTED_VERSIONS_PATH} not found, treating existing versions as []`
      );
      return [];
    }
    throw error;
  }
  const parsed = JSON.parse(raw);
  return parsed.map((entry) => entry.version);
}

async function fetchReleases() {
  const headers = {};
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  } else {
    console.error("GITHUB_TOKEN not set, calling GitHub API unauthenticated");
  }

  const response = await fetch(RELEASES_URL, { headers });
  if (!response.ok) {
    throw new Error(
      `GitHub releases request failed: ${response.status} ${response.statusText}`
    );
  }
  return response.json();
}

async function main() {
  const [releases, existingVersions] = await Promise.all([
    fetchReleases(),
    Promise.resolve(readExistingVersions()),
  ]);

  const newVersions = findNewVersions(releases, existingVersions);
  console.log(JSON.stringify(newVersions));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
