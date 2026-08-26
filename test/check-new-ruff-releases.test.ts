import { describe, expect, test } from "vitest";
import { findNewVersions } from "../scripts/check-new-ruff-releases.mjs";

describe("findNewVersions", () => {
  test("includes a normal new stable release", () => {
    const releases = [
      { tag_name: "0.16.4", draft: false, prerelease: false, published_at: "2026-08-01T12:00:00Z" },
    ];
    expect(findNewVersions(releases, [])).toEqual([{ version: "0.16.4", releaseDate: "2026-08-01" }]);
  });

  test("excludes a release whose tag is already in existingVersions", () => {
    const releases = [
      { tag_name: "0.16.4", draft: false, prerelease: false, published_at: "2026-08-01T12:00:00Z" },
    ];
    expect(findNewVersions(releases, ["0.16.4"])).toEqual([]);
  });

  test("excludes a prerelease entry", () => {
    const releases = [
      { tag_name: "0.16.5", draft: false, prerelease: true, published_at: "2026-08-01T12:00:00Z" },
    ];
    expect(findNewVersions(releases, [])).toEqual([]);
  });

  test("excludes a draft entry", () => {
    const releases = [
      { tag_name: "0.16.5", draft: true, prerelease: false, published_at: "2026-08-01T12:00:00Z" },
    ];
    expect(findNewVersions(releases, [])).toEqual([]);
  });

  test("preserves input ordering without sorting", () => {
    const releases = [
      { tag_name: "0.16.5", draft: false, prerelease: false, published_at: "2026-08-03T12:00:00Z" },
      { tag_name: "0.16.3", draft: false, prerelease: false, published_at: "2026-07-20T12:00:00Z" },
      { tag_name: "0.16.4", draft: false, prerelease: false, published_at: "2026-07-28T12:00:00Z" },
    ];
    expect(findNewVersions(releases, [])).toEqual([
      { version: "0.16.5", releaseDate: "2026-08-03" },
      { version: "0.16.3", releaseDate: "2026-07-20" },
      { version: "0.16.4", releaseDate: "2026-07-28" },
    ]);
  });

  test("mixed batch: combines all exclusion rules together", () => {
    const releases = [
      { tag_name: "0.16.6", draft: false, prerelease: false, published_at: "2026-08-05T12:00:00Z" }, // new -> included
      { tag_name: "0.16.5", draft: false, prerelease: false, published_at: "2026-08-03T12:00:00Z" }, // already known -> excluded
      { tag_name: "0.16.4-rc.1", draft: false, prerelease: true, published_at: "2026-07-30T12:00:00Z" }, // prerelease -> excluded
      { tag_name: "0.16.7", draft: true, prerelease: false, published_at: "2026-08-06T12:00:00Z" }, // draft -> excluded
    ];
    expect(findNewVersions(releases, ["0.16.5"])).toEqual([{ version: "0.16.6", releaseDate: "2026-08-05" }]);
  });

  test("excludes a release older than the minimum supported version", () => {
    const releases = [{ tag_name: "0.11.0", draft: false, prerelease: false, published_at: "2024-01-01T12:00:00Z" }];
    expect(findNewVersions(releases, [])).toEqual([]);
  });

  test("includes a release exactly at the minimum supported version", () => {
    const releases = [{ tag_name: "0.11.1", draft: false, prerelease: false, published_at: "2024-01-02T12:00:00Z" }];
    expect(findNewVersions(releases, [])).toEqual([{ version: "0.11.1", releaseDate: "2024-01-02" }]);
  });

  test("excludes an old release with a lower minor but higher patch", () => {
    const releases = [{ tag_name: "0.10.99", draft: false, prerelease: false, published_at: "2023-12-01T12:00:00Z" }];
    expect(findNewVersions(releases, [])).toEqual([]);
  });
});
