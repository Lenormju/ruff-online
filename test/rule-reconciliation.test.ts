import { describe, expect, test } from "vitest";
import { buildRulesIndex, type Rule } from "../src/config/rules-data";
import { pruneOverrides, toSelectIgnore } from "../src/config/rule-reconciliation";

const RULES: Rule[] = [
  { code: "E501", name: "line-too-long", linter: "pycodestyle", summary: "", fixable: false, preview: false, enabled: false },
  { code: "E401", name: "multiple-imports-on-one-line", linter: "pycodestyle", summary: "", fixable: false, preview: false, enabled: true },
  { code: "F401", name: "unused-import", linter: "Pyflakes", summary: "", fixable: true, preview: false, enabled: true },
  { code: "F841", name: "unused-variable", linter: "Pyflakes", summary: "", fixable: true, preview: false, enabled: true },
  { code: "B006", name: "mutable-argument-default", linter: "flake8-bugbear", summary: "", fixable: false, preview: false, enabled: false },
  { code: "B008", name: "function-call-argument-default", linter: "flake8-bugbear", summary: "", fixable: false, preview: false, enabled: false },
  { code: "PLR0913", name: "too-many-arguments", linter: "Pylint", summary: "", fixable: false, preview: false, enabled: false },
  { code: "PLW0603", name: "global-statement", linter: "Pylint", summary: "", fixable: false, preview: false, enabled: false },
];
const index = buildRulesIndex(RULES);

describe("toSelectIgnore", () => {
  test("nothing touched -> no keys at all, so Ruff's own defaults apply", () => {
    expect(toSelectIgnore(index, new Set(), new Map())).toEqual({});
  });

  test("category checked -> its full prefix set goes to select", () => {
    const result = toSelectIgnore(index, new Set(["flake8-bugbear"]), new Map());
    expect(result).toEqual({ select: ["B"] });
  });

  test("a category spanning multiple prefixes (Pylint) selects all of them", () => {
    const result = toSelectIgnore(index, new Set(["Pylint"]), new Map());
    expect(result).toEqual({ select: ["PLR", "PLW"] });
  });

  test("category checked + one rule unchecked -> carve-out ignore", () => {
    const result = toSelectIgnore(index, new Set(["flake8-bugbear"]), new Map([["B006", "off"]]));
    expect(result).toEqual({ select: ["B"], ignore: ["B006"] });
  });

  test("one-off 'on' override with NO category selected uses extend-select, not select", () => {
    // Using `select` here would replace Ruff's defaults for every other rule
    // (empirically confirmed: `select = []` disables everything, including
    // defaults) -- extend-select preserves them.
    const result = toSelectIgnore(index, new Set(), new Map([["B006", "on"]]));
    expect(result).toEqual({ extendSelect: ["B006"] });
  });

  test("one-off 'on' override while ANOTHER category is already selected folds into select", () => {
    const result = toSelectIgnore(index, new Set(["flake8-bugbear"]), new Map([["PLR0913", "on"]]));
    expect(result).toEqual({ select: ["B", "PLR0913"] });
  });

  test("'off' override on a rule enabled by Ruff's own default (no category involved) -> plain ignore", () => {
    const result = toSelectIgnore(index, new Set(), new Map([["F401", "off"]]));
    expect(result).toEqual({ ignore: ["F401"] });
  });

  test("redundant override (already matches baseline) contributes nothing", () => {
    // F401 is enabled by default; an 'on' override for it is a no-op.
    const result = toSelectIgnore(index, new Set(), new Map([["F401", "on"]]));
    expect(result).toEqual({});
  });

  test("stale override for a code absent from this version's rules.json is ignored", () => {
    const result = toSelectIgnore(index, new Set(), new Map([["Z999", "on"]]));
    expect(result).toEqual({});
  });

  test("ALL checked -> select: ['ALL']", () => {
    const result = toSelectIgnore(index, new Set(["ALL"]), new Map());
    expect(result).toEqual({ select: ["ALL"] });
  });

  test("ALL checked + one rule carved out -> select ALL, ignore the carve-out", () => {
    const result = toSelectIgnore(index, new Set(["ALL"]), new Map([["B006", "off"]]));
    expect(result).toEqual({ select: ["ALL"], ignore: ["B006"] });
  });

  test("ALL checked makes every other category's rules redundant to override 'on'", () => {
    // F401 is already on via ALL, so an 'on' override for it is a no-op.
    const result = toSelectIgnore(index, new Set(["ALL"]), new Map([["F401", "on"]]));
    expect(result).toEqual({ select: ["ALL"] });
  });
});

describe("pruneOverrides", () => {
  test("drops a carve-out once its category is unchecked and the rule isn't on by default", () => {
    const categorySelected = new Set(["flake8-bugbear"]);
    const ruleOverrides = new Map<string, "on" | "off">([["B006", "off"]]);
    categorySelected.delete("flake8-bugbear");
    pruneOverrides(index, categorySelected, ruleOverrides);
    expect(ruleOverrides.has("B006")).toBe(false);
  });

  test("keeps an override that's still meaningful", () => {
    const categorySelected = new Set<string>();
    const ruleOverrides = new Map<string, "on" | "off">([["F401", "off"]]);
    pruneOverrides(index, categorySelected, ruleOverrides);
    expect(ruleOverrides.get("F401")).toBe("off");
  });

  test("drops an override for a code no longer present in the index without throwing", () => {
    const ruleOverrides = new Map<string, "on" | "off">([["Z999", "on"]]);
    pruneOverrides(index, new Set(), ruleOverrides);
    expect(ruleOverrides.has("Z999")).toBe(false);
  });

  test("drops a redundant 'on' override once ALL gets checked", () => {
    const categorySelected = new Set(["ALL"]);
    const ruleOverrides = new Map<string, "on" | "off">([["F401", "on"]]);
    pruneOverrides(index, categorySelected, ruleOverrides);
    expect(ruleOverrides.has("F401")).toBe(false);
  });
});
