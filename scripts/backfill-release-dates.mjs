#!/usr/bin/env node
// One-off backfill: adds `releaseDate` (from the GitHub release's
// `published_at`) to every entry already in public/supported-versions.json.
// Paginates through the releases feed since Ruff has published more stable
// releases than fit in a single page.

import { readFileSync, writeFileSync } from "node:fs";

const RELEASES_URL = "https://api.github.com/repos/astral-sh/ruff/releases";
const SUPPORTED_VERSIONS_PATH = "public/supported-versions.json";
const PER_PAGE = 100;

/**
 * @param {{tag_name: string, published_at: string}[]} releases
 * @param {{version: string}[]} versions
 * @returns {({version: string, releaseDate: string} & Record<string, unknown>)[]}
 */
export function matchReleaseDates(releases, versions) {
  const dateByTag = new Map(releases.map((release) => [release.tag_name, release.published_at.slice(0, 10)]));
  return versions.map((entry) => {
    const releaseDate = dateByTag.get(entry.version);
    if (!releaseDate) {
      throw new Error(`No matching GitHub release found for Ruff ${entry.version}`);
    }
    return { ...entry, releaseDate };
  });
}

async function fetchAllReleases() {
  const headers = {};
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  } else {
    console.error("GITHUB_TOKEN not set, calling GitHub API unauthenticated");
  }

  const releases = [];
  for (let page = 1; ; page++) {
    const response = await fetch(`${RELEASES_URL}?per_page=${PER_PAGE}&page=${page}`, { headers });
    if (!response.ok) {
      throw new Error(`GitHub releases request failed: ${response.status} ${response.statusText}`);
    }
    const batch = await response.json();
    if (batch.length === 0) break;
    releases.push(...batch);
    if (batch.length < PER_PAGE) break;
  }
  return releases;
}

async function main() {
  const versions = JSON.parse(readFileSync(SUPPORTED_VERSIONS_PATH, "utf-8"));
  console.error(`Fetching astral-sh/ruff releases (paginated)...`);
  const releases = await fetchAllReleases();
  const updated = matchReleaseDates(releases, versions);
  writeFileSync(SUPPORTED_VERSIONS_PATH, JSON.stringify(updated, null, 2) + "\n");
  console.error(`Matched ${updated.length}/${versions.length} versions to a published_at date`);
  console.error(`Wrote ${SUPPORTED_VERSIONS_PATH}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
