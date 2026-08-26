import { describe, expect, test } from "vitest";
import { buildRulesIndex, type Rule } from "../src/config/rules-data";
import { tomlToVisualWarning } from "../src/ui/mode-switch";

const RULES: Rule[] = [
  { code: "F401", name: "unused-import", linter: "Pyflakes", summary: "", fixable: true, preview: false, enabled: true },
];
const rulesIndex = buildRulesIndex(RULES);

describe("tomlToVisualWarning", () => {
  test("no warning when every field is representable in Tier 1/3", () => {
    expect(tomlToVisualWarning({ "line-length": 100, format: { "quote-style": "single" } }, null)).toBeNull();
  });

  test("no warning for empty options", () => {
    expect(tomlToVisualWarning({}, null)).toBeNull();
  });

  test("warns and names the extra keys when something would be discarded", () => {
    const message = tomlToVisualWarning({ "line-length": 88, banana: true }, null);
    expect(message).not.toBeNull();
    expect(message).toContain("banana");
  });

  test("warns about a lint table when no RulesIndex has loaded yet to convert it", () => {
    const message = tomlToVisualWarning({ lint: { select: ["F"] } }, null);
    expect(message).toContain("lint");
  });

  test("no warning for a lint table once a RulesIndex is available to convert it", () => {
    expect(tomlToVisualWarning({ lint: { select: ["F"] } }, rulesIndex)).toBeNull();
  });

  test("warns and names extra format sub-keys separately", () => {
    const message = tomlToVisualWarning({ format: { "docstring-code-line-length": 40 } }, null);
    expect(message).toContain("format.docstring-code-line-length");
  });
});
