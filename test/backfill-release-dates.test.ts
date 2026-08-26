import { describe, expect, test } from "vitest";
import { matchReleaseDates } from "../scripts/backfill-release-dates.mjs";

describe("matchReleaseDates", () => {
  test("attaches releaseDate to a matching version, preserving its other fields", () => {
    const releases = [{ tag_name: "0.16.4", published_at: "2026-08-01T12:00:00Z" }];
    const versions = [{ version: "0.16.4", wasmUrl: "https://example.com/0.16.4", rulesPath: "versions/0.16.4/rules.json" }];
    expect(matchReleaseDates(releases, versions)).toEqual([
      {
        version: "0.16.4",
        wasmUrl: "https://example.com/0.16.4",
        rulesPath: "versions/0.16.4/rules.json",
        releaseDate: "2026-08-01",
      },
    ]);
  });

  test("matches multiple versions independent of release list order", () => {
    const releases = [
      { tag_name: "0.16.5", published_at: "2026-08-10T12:00:00Z" },
      { tag_name: "0.16.4", published_at: "2026-08-01T12:00:00Z" },
    ];
    const versions = [
      { version: "0.16.4", wasmUrl: "", rulesPath: "" },
      { version: "0.16.5", wasmUrl: "", rulesPath: "" },
    ];
    expect(matchReleaseDates(releases, versions).map((v) => v.releaseDate)).toEqual(["2026-08-01", "2026-08-10"]);
  });

  test("throws when a version has no matching release", () => {
    const releases = [{ tag_name: "0.16.4", published_at: "2026-08-01T12:00:00Z" }];
    const versions = [{ version: "0.16.5", wasmUrl: "", rulesPath: "" }];
    expect(() => matchReleaseDates(releases, versions)).toThrow(/0\.16\.5/);
  });
});
