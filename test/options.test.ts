import { describe, expect, test } from "vitest";
import {
  EMPTY_VISUAL_OPTIONS,
  ruffOptionsToVisualOptions,
  visualOptionsToRuffOptions,
  visualOptionsToTomlText,
  type VisualOptions,
} from "../src/config/options";
import { buildRulesIndex, type Rule } from "../src/config/rules-data";
import { tomlToOptions } from "../src/config/toml-options";

const RULES: Rule[] = [
  { code: "E501", name: "line-too-long", linter: "pycodestyle", summary: "", fixable: false, preview: false, enabled: false },
  { code: "E401", name: "multiple-imports-on-one-line", linter: "pycodestyle", summary: "", fixable: false, preview: false, enabled: true },
  { code: "F401", name: "unused-import", linter: "Pyflakes", summary: "", fixable: true, preview: false, enabled: true },
  { code: "B006", name: "mutable-argument-default", linter: "flake8-bugbear", summary: "", fixable: false, preview: false, enabled: false },
];
const rulesIndex = buildRulesIndex(RULES);

describe("visualOptionsToRuffOptions", () => {
  test("all-unset visual options produce an empty RuffOptions", () => {
    expect(visualOptionsToRuffOptions(EMPTY_VISUAL_OPTIONS, null)).toEqual({});
  });

  test("each tier1 field maps to its kebab-case Ruff key", () => {
    const visual: VisualOptions = {
      tier1: {
        fix: true,
        unsafeFixes: false,
        preview: true,
        lineLength: 100,
        indentWidth: 2,
        targetVersion: "py311",
      },
      tier3: {},
      tier2: EMPTY_VISUAL_OPTIONS.tier2,
    };
    expect(visualOptionsToRuffOptions(visual, null)).toEqual({
      fix: true,
      "unsafe-fixes": false,
      preview: true,
      "line-length": 100,
      "indent-width": 2,
      "target-version": "py311",
    });
  });

  test("tier3 fields are nested under a format table, kebab-cased", () => {
    const visual: VisualOptions = {
      tier1: {},
      tier3: {
        indentStyle: "tab",
        quoteStyle: "single",
        lineEnding: "lf",
        skipMagicTrailingComma: true,
        docstringCodeFormat: true,
        preview: false,
      },
      tier2: EMPTY_VISUAL_OPTIONS.tier2,
    };
    expect(visualOptionsToRuffOptions(visual, null)).toEqual({
      format: {
        "indent-style": "tab",
        "quote-style": "single",
        "line-ending": "lf",
        "skip-magic-trailing-comma": true,
        "docstring-code-format": true,
        preview: false,
      },
    });
  });

  test("the format key is omitted entirely when no tier3 field is set", () => {
    const visual: VisualOptions = { tier1: { lineLength: 88 }, tier3: {}, tier2: EMPTY_VISUAL_OPTIONS.tier2 };
    const options = visualOptionsToRuffOptions(visual, null);
    expect(options).not.toHaveProperty("format");
  });

  describe("tier2 (rule selection)", () => {
    test("without a RulesIndex, tier2 is omitted entirely (defaults apply until it loads)", () => {
      const visual: VisualOptions = {
        tier1: {},
        tier3: {},
        tier2: { categorySelected: ["flake8-bugbear"], ruleOverrides: [] },
      };
      expect(visualOptionsToRuffOptions(visual, null)).toEqual({});
    });

    test("a selected category produces a lint.select table", () => {
      const visual: VisualOptions = {
        tier1: {},
        tier3: {},
        tier2: { categorySelected: ["flake8-bugbear"], ruleOverrides: [] },
      };
      expect(visualOptionsToRuffOptions(visual, rulesIndex)).toEqual({ lint: { select: ["B"] } });
    });

    test("a one-off override with no category selected produces lint.extend-select", () => {
      const visual: VisualOptions = {
        tier1: {},
        tier3: {},
        tier2: { categorySelected: [], ruleOverrides: [["B006", "on"]] },
      };
      expect(visualOptionsToRuffOptions(visual, rulesIndex)).toEqual({ lint: { "extend-select": ["B006"] } });
    });

    test("nothing touched -> no lint key at all", () => {
      const visual: VisualOptions = { tier1: {}, tier3: {}, tier2: EMPTY_VISUAL_OPTIONS.tier2 };
      expect(visualOptionsToRuffOptions(visual, rulesIndex)).toEqual({});
    });
  });
});

describe("ruffOptionsToVisualOptions", () => {
  test("round-trips known tier1 + tier3 fields with no extra keys", () => {
    const options = {
      fix: true,
      "line-length": 100,
      "target-version": "py311",
      format: { "quote-style": "single", preview: true },
    };
    const { visual, extraKeys } = ruffOptionsToVisualOptions(options, null);
    expect(visual.tier1).toEqual({ fix: true, lineLength: 100, targetVersion: "py311" });
    expect(visual.tier3).toEqual({ quoteStyle: "single", preview: true });
    expect(extraKeys).toEqual([]);
  });

  test("an unknown top-level key is reported as an extra key, not imported", () => {
    const { visual, extraKeys } = ruffOptionsToVisualOptions({ "line-length": 88, banana: true }, null);
    expect(visual.tier1).toEqual({ lineLength: 88 });
    expect(extraKeys).toContain("banana");
  });

  test("a lint table without a loaded RulesIndex is reported as an extra key, not imported", () => {
    const { visual, extraKeys } = ruffOptionsToVisualOptions({ "line-length": 88, lint: { select: ["F"] } }, null);
    expect(visual.tier1).toEqual({ lineLength: 88 });
    expect(visual.tier2).toEqual(EMPTY_VISUAL_OPTIONS.tier2);
    expect(extraKeys).toContain("lint");
  });

  test("an unknown format sub-key is reported as an extra key", () => {
    const { visual, extraKeys } = ruffOptionsToVisualOptions(
      { format: { "quote-style": "double", "docstring-code-line-length": 40 } },
      null,
    );
    expect(visual.tier3).toEqual({ quoteStyle: "double" });
    expect(extraKeys).toContain("format.docstring-code-line-length");
  });

  test("a wrong-typed known field is treated as an extra key, not imported", () => {
    const { visual, extraKeys } = ruffOptionsToVisualOptions({ "line-length": "not-a-number" }, null);
    expect(visual.tier1).toEqual({});
    expect(extraKeys).toContain("line-length");
  });

  test("a non-table format value is reported as extra without crashing", () => {
    const { visual, extraKeys } = ruffOptionsToVisualOptions({ format: "oops" }, null);
    expect(visual.tier3).toEqual({});
    expect(extraKeys).toContain("format");
  });

  test("empty options round-trip to empty visual options with no extra keys", () => {
    expect(ruffOptionsToVisualOptions({}, null)).toEqual({ visual: EMPTY_VISUAL_OPTIONS, extraKeys: [] });
    expect(ruffOptionsToVisualOptions({}, rulesIndex)).toEqual({ visual: EMPTY_VISUAL_OPTIONS, extraKeys: [] });
  });

  describe("tier2 (rule selection), with a loaded RulesIndex", () => {
    test("lint.select round-trips into categorySelected with no extra keys", () => {
      const { visual, extraKeys } = ruffOptionsToVisualOptions({ lint: { select: ["B"] } }, rulesIndex);
      expect(visual.tier2).toEqual({ categorySelected: ["flake8-bugbear"], ruleOverrides: [] });
      expect(extraKeys).toEqual([]);
    });

    test("lint.ignore of a default-enabled rule round-trips into a one-off 'off' override", () => {
      const { visual, extraKeys } = ruffOptionsToVisualOptions({ lint: { ignore: ["F401"] } }, rulesIndex);
      expect(visual.tier2).toEqual({ categorySelected: [], ruleOverrides: [["F401", "off"]] });
      expect(extraKeys).toEqual([]);
    });

    test("an unknown lint sub-key is reported as an extra key", () => {
      const { extraKeys } = ruffOptionsToVisualOptions({ lint: { "per-file-ignores": {} } }, rulesIndex);
      expect(extraKeys).toContain("lint.per-file-ignores");
    });

    test("a non-table lint value is reported as extra without crashing", () => {
      const { visual, extraKeys } = ruffOptionsToVisualOptions({ lint: "oops" }, rulesIndex);
      expect(visual.tier2).toEqual(EMPTY_VISUAL_OPTIONS.tier2);
      expect(extraKeys).toContain("lint");
    });
  });
});

describe("visualOptionsToTomlText", () => {
  test("produces TOML that tomlToOptions parses back to the same RuffOptions", () => {
    const visual: VisualOptions = {
      tier1: { fix: true, lineLength: 100, targetVersion: "py311" },
      tier3: { quoteStyle: "single", skipMagicTrailingComma: true },
      tier2: { categorySelected: ["flake8-bugbear"], ruleOverrides: [] },
    };
    const text = visualOptionsToTomlText(visual, rulesIndex);
    const result = tomlToOptions(text);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a parse success");
    expect(result.options).toEqual(visualOptionsToRuffOptions(visual, rulesIndex));
  });

  test("all-unset visual options produce a TOML doc with an empty [tool.ruff] table", () => {
    const text = visualOptionsToTomlText(EMPTY_VISUAL_OPTIONS, null);
    const result = tomlToOptions(text);
    expect(result).toEqual({ ok: true, hasRuffTable: true, options: {} });
  });
});
