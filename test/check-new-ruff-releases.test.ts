import { describe, expect, test } from "vitest";
import { findNewVersions } from "../scripts/check-new-ruff-releases.mjs";

describe("findNewVersions", () => {
  test("includes a normal new stable release", () => {
    const releases = [
      { tag_name: "0.16.4", draft: false, prerelease: false },
    ];
    expect(findNewVersions(releases, [])).toEqual(["0.16.4"]);
  });

  test("excludes a release whose tag is already in existingVersions", () => {
    const releases = [
      { tag_name: "0.16.4", draft: false, prerelease: false },
    ];
    expect(findNewVersions(releases, ["0.16.4"])).toEqual([]);
  });

  test("excludes a prerelease entry", () => {
    const releases = [
      { tag_name: "0.16.5", draft: false, prerelease: true },
    ];
    expect(findNewVersions(releases, [])).toEqual([]);
  });

  test("excludes a draft entry", () => {
    const releases = [
      { tag_name: "0.16.5", draft: true, prerelease: false },
    ];
    expect(findNewVersions(releases, [])).toEqual([]);
  });

  test("preserves input ordering without sorting", () => {
    const releases = [
      { tag_name: "0.16.5", draft: false, prerelease: false },
      { tag_name: "0.16.3", draft: false, prerelease: false },
      { tag_name: "0.16.4", draft: false, prerelease: false },
    ];
    expect(findNewVersions(releases, [])).toEqual([
      "0.16.5",
      "0.16.3",
      "0.16.4",
    ]);
  });

  test("mixed batch: combines all exclusion rules together", () => {
    const releases = [
      { tag_name: "0.16.6", draft: false, prerelease: false }, // new -> included
      { tag_name: "0.16.5", draft: false, prerelease: false }, // already known -> excluded
      { tag_name: "0.16.4-rc.1", draft: false, prerelease: true }, // prerelease -> excluded
      { tag_name: "0.16.7", draft: true, prerelease: false }, // draft -> excluded
    ];
    expect(findNewVersions(releases, ["0.16.5"])).toEqual(["0.16.6"]);
  });

  test("excludes a release older than the minimum supported version", () => {
    const releases = [{ tag_name: "0.11.0", draft: false, prerelease: false }];
    expect(findNewVersions(releases, [])).toEqual([]);
  });

  test("includes a release exactly at the minimum supported version", () => {
    const releases = [{ tag_name: "0.11.1", draft: false, prerelease: false }];
    expect(findNewVersions(releases, [])).toEqual(["0.11.1"]);
  });

  test("excludes an old release with a lower minor but higher patch", () => {
    const releases = [{ tag_name: "0.10.99", draft: false, prerelease: false }];
    expect(findNewVersions(releases, [])).toEqual([]);
  });
});
