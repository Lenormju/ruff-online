import { describe, expect, test } from "vitest";
import { compareVersions, formatVersionLabel, supportsUtf16PositionEncoding } from "../src/engine/versions";

describe("compareVersions", () => {
  test("numeric dot-component comparison: 0.10.0 > 0.9.0 (not string comparison)", () => {
    // A naive string comparison would say "0.10.0" < "0.9.0" because "1" < "9"
    // lexicographically. The correct numeric answer is 0.10.0 > 0.9.0.
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("0.9.0", "0.10.0")).toBeLessThan(0);
  });

  test("simple case: 0.16.4 > 0.16.3", () => {
    expect(compareVersions("0.16.4", "0.16.3")).toBeGreaterThan(0);
    expect(compareVersions("0.16.3", "0.16.4")).toBeLessThan(0);
  });

  test("equal versions return 0", () => {
    expect(compareVersions("0.16.4", "0.16.4")).toBe(0);
  });
});

describe("supportsUtf16PositionEncoding", () => {
  test("false just below the 0.13.2 floor", () => {
    expect(supportsUtf16PositionEncoding("0.13.1")).toBe(false);
  });

  test("true exactly at the 0.13.2 floor", () => {
    expect(supportsUtf16PositionEncoding("0.13.2")).toBe(true);
  });

  test("true for a version well above the floor", () => {
    expect(supportsUtf16PositionEncoding("0.16.4")).toBe(true);
  });

  test("false for a much older version", () => {
    expect(supportsUtf16PositionEncoding("0.11.1")).toBe(false);
  });
});

describe("formatVersionLabel", () => {
  const entry = { version: "0.16.4", releaseDate: "2026-08-01", wasmUrl: "", rulesPath: "" };

  test("plain entry: version and date, no latest marker", () => {
    expect(formatVersionLabel(entry, false)).toBe("0.16.4 — 2026-08-01");
  });

  test("latest entry: appends the latest marker", () => {
    expect(formatVersionLabel(entry, true)).toBe("0.16.4 — 2026-08-01 (latest)");
  });
});
