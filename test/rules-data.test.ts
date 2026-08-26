import { describe, expect, test } from "vitest";
import { ALL_CATEGORY_KEY, buildRulesIndex, type Rule } from "../src/config/rules-data";

const RULES: Rule[] = [
  { code: "E501", name: "line-too-long", linter: "pycodestyle", summary: "", fixable: false, preview: false, enabled: false },
  { code: "E401", name: "multiple-imports-on-one-line", linter: "pycodestyle", summary: "", fixable: false, preview: false, enabled: true },
  { code: "W291", name: "trailing-whitespace", linter: "pycodestyle", summary: "", fixable: true, preview: false, enabled: false },
  { code: "F401", name: "unused-import", linter: "Pyflakes", summary: "", fixable: true, preview: false, enabled: true },
  { code: "F841", name: "unused-variable", linter: "Pyflakes", summary: "", fixable: true, preview: false, enabled: true },
  { code: "B006", name: "mutable-argument-default", linter: "flake8-bugbear", summary: "", fixable: false, preview: false, enabled: false },
  { code: "PLR0913", name: "too-many-arguments", linter: "Pylint", summary: "", fixable: false, preview: false, enabled: false },
  { code: "PLW0603", name: "global-statement", linter: "Pylint", summary: "", fixable: false, preview: false, enabled: false },
];

describe("buildRulesIndex", () => {
  test("byCode looks up a rule by its exact code", () => {
    const index = buildRulesIndex(RULES);
    expect(index.byCode.get("F401")?.name).toBe("unused-import");
    expect(index.byCode.get("Z999")).toBeUndefined();
  });

  test("groups rules into categories by their linter field, plus a synthetic ALL category", () => {
    const index = buildRulesIndex(RULES);
    const keys = index.categories.map((c) => c.key).sort();
    expect(keys).toEqual(["ALL", "Pyflakes", "Pylint", "flake8-bugbear", "pycodestyle"]);
  });

  test("the ALL category spans every rule under a single 'ALL' prefix", () => {
    const index = buildRulesIndex(RULES);
    const all = index.categories.find((c) => c.key === ALL_CATEGORY_KEY);
    expect(all?.rules).toHaveLength(RULES.length);
    expect(all?.prefixes).toEqual(["ALL"]);
  });

  test("a category spanning one prefix reports that single prefix", () => {
    const index = buildRulesIndex(RULES);
    const bugbear = index.categories.find((c) => c.key === "flake8-bugbear");
    expect(bugbear?.prefixes).toEqual(["B"]);
  });

  test("pycodestyle spans two unrelated top-level prefixes (E and W)", () => {
    const index = buildRulesIndex(RULES);
    const pycodestyle = index.categories.find((c) => c.key === "pycodestyle");
    expect(pycodestyle?.prefixes).toEqual(["E", "W"]);
  });

  test("Pylint's sub-linter codes (PLR/PLW/...) each report their own full prefix", () => {
    const index = buildRulesIndex(RULES);
    const pylint = index.categories.find((c) => c.key === "Pylint");
    expect(pylint?.prefixes).toEqual(["PLR", "PLW"]);
  });
});
