import { describe, expect, test } from "vitest";
import { buildRulesIndex, type Rule } from "../src/config/rules-data";
import { toSelectIgnore } from "../src/config/rule-reconciliation";
import { lintToVisual } from "../src/config/toml-to-visual";

const RULES: Rule[] = [
  { code: "E501", name: "line-too-long", linter: "pycodestyle", summary: "", fixable: false, preview: false, enabled: false },
  { code: "E401", name: "multiple-imports-on-one-line", linter: "pycodestyle", summary: "", fixable: false, preview: false, enabled: true },
  { code: "F401", name: "unused-import", linter: "Pyflakes", summary: "", fixable: true, preview: false, enabled: true },
  { code: "F841", name: "unused-variable", linter: "Pyflakes", summary: "", fixable: true, preview: false, enabled: true },
  { code: "B006", name: "mutable-argument-default", linter: "flake8-bugbear", summary: "", fixable: false, preview: false, enabled: false },
  { code: "B008", name: "function-call-argument-default", linter: "flake8-bugbear", summary: "", fixable: false, preview: false, enabled: false },
  { code: "PLC0001", name: "locally-disabled-warning", linter: "Pylint", summary: "", fixable: false, preview: false, enabled: false },
  { code: "PLR0913", name: "too-many-arguments", linter: "Pylint", summary: "", fixable: false, preview: false, enabled: false },
  { code: "PLW0603", name: "global-statement", linter: "Pylint", summary: "", fixable: false, preview: false, enabled: false },
];
const index = buildRulesIndex(RULES);

describe("lintToVisual", () => {
  test("no lint table at all -> fully empty state", () => {
    const result = lintToVisual(index, undefined);
    expect(result.categorySelected.size).toBe(0);
    expect(result.ruleOverrides.size).toBe(0);
  });

  test("empty lint table (no keys) -> fully empty state", () => {
    const result = lintToVisual(index, {});
    expect(result.categorySelected.size).toBe(0);
    expect(result.ruleOverrides.size).toBe(0);
  });

  describe("select absent (deltas on top of Ruff's defaults) — exact, not best-effort", () => {
    test("plain ignore of a default-enabled rule -> one-off 'off' override, no category touched", () => {
      const result = lintToVisual(index, { ignore: ["F401"] });
      expect([...result.categorySelected]).toEqual([]);
      expect([...result.ruleOverrides]).toEqual([["F401", "off"]]);
    });

    test("extend-select of a default-off rule -> one-off 'on' override, no category touched", () => {
      const result = lintToVisual(index, { "extend-select": ["B006"] });
      expect([...result.categorySelected]).toEqual([]);
      expect([...result.ruleOverrides]).toEqual([["B006", "on"]]);
    });

    test("ignoring a rule that's already off by default is a no-op (no spurious override)", () => {
      const result = lintToVisual(index, { ignore: ["B006"] });
      expect(result.ruleOverrides.size).toBe(0);
    });

    test("round-trips exactly through toSelectIgnore for the no-category-selected case", () => {
      const before = lintToVisual(index, { ignore: ["F401"], "extend-select": ["B006"] });
      const encoded = toSelectIgnore(index, before.categorySelected, before.ruleOverrides);
      const after = lintToVisual(index, { ignore: encoded.ignore, "extend-select": encoded.extendSelect });
      expect([...after.categorySelected]).toEqual([...before.categorySelected]);
      expect([...after.ruleOverrides].sort()).toEqual([...before.ruleOverrides].sort());
    });
  });

  describe("select present (best-effort majority heuristic, same ambiguity as the spike)", () => {
    test("a clear majority (2 of 3) keeps the category selected with the minority as a carve-out", () => {
      const categorySelected = new Set(["Pylint"]);
      const ruleOverrides = new Map<string, "on" | "off">([["PLC0001", "off"]]);
      const encoded = toSelectIgnore(index, categorySelected, ruleOverrides);
      const back = lintToVisual(index, { select: encoded.select, ignore: encoded.ignore });
      expect([...back.categorySelected]).toEqual(["Pylint"]);
      expect([...back.ruleOverrides]).toEqual([["PLC0001", "off"]]);
    });

    test("an exact on/off tie (flake8-bugbear, 2 rules) does NOT re-select the category, but the resolved rule set matches", () => {
      const categorySelected = new Set(["flake8-bugbear"]);
      const ruleOverrides = new Map<string, "on" | "off">([["B006", "off"]]);
      const encoded = toSelectIgnore(index, categorySelected, ruleOverrides);
      const back = lintToVisual(index, { select: encoded.select, ignore: encoded.ignore });
      expect([...back.categorySelected]).toEqual([]);
      expect([...back.ruleOverrides]).toEqual([["B008", "on"]]);
    });

    test("exact code beats a prefix selector regardless of list order", () => {
      const result = lintToVisual(index, { select: ["B006"], ignore: ["B"] });
      expect([...result.ruleOverrides]).toEqual([["B006", "on"]]);
    });

    test("select=[] disables everything, including defaults -- no category ends up selected", () => {
      const result = lintToVisual(index, { select: [] });
      expect([...result.categorySelected]).toEqual([]);
      expect(result.ruleOverrides.size).toBe(0);
    });
  });

  describe("ALL (Ruff's own catch-all selector)", () => {
    test("select=['ALL'] resolves to just the ALL category selected, no per-rule overrides", () => {
      const result = lintToVisual(index, { select: ["ALL"] });
      expect([...result.categorySelected]).toEqual(["ALL"]);
      expect(result.ruleOverrides.size).toBe(0);
    });

    test("extend-select=['ALL'] on top of defaults also collapses to just the ALL category", () => {
      const result = lintToVisual(index, { "extend-select": ["ALL"] });
      expect([...result.categorySelected]).toEqual(["ALL"]);
      expect(result.ruleOverrides.size).toBe(0);
    });

    test("a more specific ignore alongside select=['ALL'] is NOT full coverage, so it falls back to the per-category heuristic rather than claiming ALL", () => {
      const result = lintToVisual(index, { select: ["ALL"], ignore: ["B006"] });
      expect(result.categorySelected.has("ALL")).toBe(false);
      expect(result.ruleOverrides.get("B008")).toBe("on");
    });

    test("round-trips exactly through toSelectIgnore", () => {
      const encoded = toSelectIgnore(index, new Set(["ALL"]), new Map());
      expect(encoded).toEqual({ select: ["ALL"] });
      const back = lintToVisual(index, { select: encoded.select });
      expect([...back.categorySelected]).toEqual(["ALL"]);
      expect(back.ruleOverrides.size).toBe(0);
    });
  });
});
