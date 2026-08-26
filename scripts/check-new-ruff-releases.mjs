#!/usr/bin/env node
// Checks the astral-sh/ruff GitHub releases feed for stable versions that
// aren't yet listed in public/supported-versions.json. Prints a JSON array
// of new tag_names to stdout (and only that, so a CI step can capture it
// cleanly); human-readable logging goes to stderr.

import { readFileSync } from "node:fs";

const RELEASES_URL =
  "https://api.github.com/repos/astral-sh/ruff/releases?per_page=100";
const SUPPORTED_VERSIONS_PATH = "public/supported-versions.json";

// @astral-sh/ruff-wasm-web only started exporting `PositionEncoding` at this
// version; older builds can't construct a `Workspace` the way we need
// (see src/engine/workspace.ts), so the smoke test can never pass for them.
const MIN_SUPPORTED_VERSION = "0.13.2";

function isAtLeast(version, floor) {
  const v = version.split(".").map(Number);
  const f = floor.split(".").map(Number);
  for (let i = 0; i < f.length; i++) {
    if ((v[i] ?? 0) !== f[i]) return (v[i] ?? 0) > f[i];
  }
  return true;
}

/**
 * @param {{tag_name: string, draft: boolean, prerelease: boolean}[]} releases
 * @param {string[]} existingVersions
 * @returns {string[]}
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
    .map((release) => release.tag_name);
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
