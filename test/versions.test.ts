import { describe, expect, test } from "vitest";
import { compareVersions } from "../src/engine/versions";

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
