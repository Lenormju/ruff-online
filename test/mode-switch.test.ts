import { describe, expect, test } from "vitest";
import { tomlToVisualWarning } from "../src/ui/mode-switch";

describe("tomlToVisualWarning", () => {
  test("no warning when every field is representable in Tier 1/3", () => {
    expect(tomlToVisualWarning({ "line-length": 100, format: { "quote-style": "single" } })).toBeNull();
  });

  test("no warning for empty options", () => {
    expect(tomlToVisualWarning({})).toBeNull();
  });

  test("warns and names the extra keys when something would be discarded", () => {
    const message = tomlToVisualWarning({ "line-length": 88, lint: { select: ["F"] } });
    expect(message).not.toBeNull();
    expect(message).toContain("lint");
  });

  test("warns and names extra format sub-keys separately", () => {
    const message = tomlToVisualWarning({ format: { "docstring-code-line-length": 40 } });
    expect(message).toContain("format.docstring-code-line-length");
  });
});
