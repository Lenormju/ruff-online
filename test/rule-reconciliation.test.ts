import { describe, expect, test } from "vitest";
import { buildRulesIndex, type Rule } from "../src/config/rules-data";
import {
  applyCategoryPhase,
  categoryPhase,
  cycleOverride,
  isRuleEffectivelyOn,
  nextCategoryPhase,
  pruneStaleOverrides,
  toSelectIgnore,
} from "../src/config/rule-reconciliation";

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

describe("pruneStaleOverrides", () => {
  test("keeps a carve-out even after its category is unchecked and the rule isn't on by default", () => {
    // Overrides are never auto-dropped just for currently matching the
    // baseline -- see `RuleOverrides`' doc comment. Only an explicit action
    // (the rule's own cycle, or its category's bulk action) changes it.
    const ruleOverrides = new Map<string, "on" | "off">([["B006", "off"]]);
    pruneStaleOverrides(index, ruleOverrides);
    expect(ruleOverrides.get("B006")).toBe("off");
  });

  test("keeps an override that's still meaningful", () => {
    const ruleOverrides = new Map<string, "on" | "off">([["F401", "off"]]);
    pruneStaleOverrides(index, ruleOverrides);
    expect(ruleOverrides.get("F401")).toBe("off");
  });

  test("drops an override for a code no longer present in the index without throwing", () => {
    const ruleOverrides = new Map<string, "on" | "off">([["Z999", "on"]]);
    pruneStaleOverrides(index, ruleOverrides);
    expect(ruleOverrides.has("Z999")).toBe(false);
  });

  test("keeps a redundant 'on' override even once ALL is checked", () => {
    const ruleOverrides = new Map<string, "on" | "off">([["F401", "on"]]);
    pruneStaleOverrides(index, ruleOverrides);
    expect(ruleOverrides.get("F401")).toBe("on");
  });
});

describe("isRuleEffectivelyOn", () => {
  const [e501, e401, f401] = RULES;

  test("a rule with no override or category selection falls back to its own default", () => {
    expect(isRuleEffectivelyOn(new Set(), new Map(), e501)).toBe(false); // default off
    expect(isRuleEffectivelyOn(new Set(), new Map(), f401)).toBe(true); // default on
  });

  test("category selection turns a default-off rule on", () => {
    expect(isRuleEffectivelyOn(new Set(["pycodestyle"]), new Map(), e501)).toBe(true);
  });

  test("an explicit override wins over both category selection and the default", () => {
    expect(isRuleEffectivelyOn(new Set(["pycodestyle"]), new Map([["E401", "off"]]), e401)).toBe(false);
    expect(isRuleEffectivelyOn(new Set(), new Map([["E501", "on"]]), e501)).toBe(true);
  });
});

describe("cycleOverride", () => {
  test("default-on rule: first click flips to off, matching what's visually shown", () => {
    expect(cycleOverride(undefined, true)).toBe("off");
  });

  test("default-on rule: full loop is default -> off -> on -> default", () => {
    expect(cycleOverride(undefined, true)).toBe("off");
    expect(cycleOverride("off", true)).toBe("on");
    expect(cycleOverride("on", true)).toBe(undefined);
  });

  test("default-off rule: first click flips to on, matching what's visually shown", () => {
    expect(cycleOverride(undefined, false)).toBe("on");
  });

  test("default-off rule: full loop is default -> on -> off -> default", () => {
    expect(cycleOverride(undefined, false)).toBe("on");
    expect(cycleOverride("on", false)).toBe("off");
    expect(cycleOverride("off", false)).toBe(undefined);
  });
});

describe("categoryPhase / nextCategoryPhase / applyCategoryPhase", () => {
  const bugbear = index.categories.find((category) => category.key === "flake8-bugbear")!;

  test("untouched category is 'default'", () => {
    expect(categoryPhase(bugbear, new Set(), new Map())).toBe("default");
  });

  test("categorySelected marks it 'selected' regardless of per-rule overrides", () => {
    expect(categoryPhase(bugbear, new Set(["flake8-bugbear"]), new Map())).toBe("selected");
  });

  test("every rule explicitly 'off' (and category not selected) marks it 'deselected'", () => {
    const ruleOverrides = new Map<string, "on" | "off">([
      ["B006", "off"],
      ["B008", "off"],
    ]);
    expect(categoryPhase(bugbear, new Set(), ruleOverrides)).toBe("deselected");
  });

  test("a partial mix (not from a prior bulk action) is still 'default'", () => {
    const ruleOverrides = new Map<string, "on" | "off">([["B006", "on"]]);
    expect(categoryPhase(bugbear, new Set(), ruleOverrides)).toBe("default");
  });

  test("nextCategoryPhase cycles default -> selected -> deselected -> default", () => {
    expect(nextCategoryPhase("default")).toBe("selected");
    expect(nextCategoryPhase("selected")).toBe("deselected");
    expect(nextCategoryPhase("deselected")).toBe("default");
  });

  test("applying 'selected' sets categorySelected and pins every rule in the category 'on'", () => {
    const categorySelected = new Set<string>();
    const ruleOverrides = new Map<string, "on" | "off">();
    applyCategoryPhase(bugbear, "selected", categorySelected, ruleOverrides);
    expect(categorySelected.has("flake8-bugbear")).toBe(true);
    expect(ruleOverrides.get("B006")).toBe("on");
    expect(ruleOverrides.get("B008")).toBe("on");
  });

  test("applying 'deselected' clears categorySelected and pins every rule in the category 'off', overwriting prior choices", () => {
    const categorySelected = new Set(["flake8-bugbear"]);
    const ruleOverrides = new Map<string, "on" | "off">([["B006", "on"]]);
    applyCategoryPhase(bugbear, "deselected", categorySelected, ruleOverrides);
    expect(categorySelected.has("flake8-bugbear")).toBe(false);
    expect(ruleOverrides.get("B006")).toBe("off");
    expect(ruleOverrides.get("B008")).toBe("off");
  });

  test("applying 'default' clears categorySelected and every override in the category", () => {
    const categorySelected = new Set(["flake8-bugbear"]);
    const ruleOverrides = new Map<string, "on" | "off">([
      ["B006", "on"],
      ["B008", "off"],
    ]);
    applyCategoryPhase(bugbear, "default", categorySelected, ruleOverrides);
    expect(categorySelected.has("flake8-bugbear")).toBe(false);
    expect(ruleOverrides.has("B006")).toBe(false);
    expect(ruleOverrides.has("B008")).toBe(false);
  });

  test("worked example: individually selecting a rule, then cycling its category selected->deselected, leaves the rule explicitly off", () => {
    const categorySelected = new Set<string>();
    const ruleOverrides = new Map<string, "on" | "off">([["B006", "on"]]); // user selected B006 individually
    applyCategoryPhase(bugbear, "selected", categorySelected, ruleOverrides);
    applyCategoryPhase(bugbear, "deselected", categorySelected, ruleOverrides);
    expect(ruleOverrides.get("B006")).toBe("off");
  });
});
