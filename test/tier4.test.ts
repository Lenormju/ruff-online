import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { EMPTY_VISUAL_OPTIONS, ruffOptionsToVisualOptions, visualOptionsToRuffOptions, type Tier4Value, type VisualOptions } from "../src/config/options";
import { buildRulesIndex, type Rule } from "../src/config/rules-data";
import { TIER4_SCHEMA, type Tier4FieldSpec } from "../src/config/tier4-schema";

const RULES: Rule[] = [
  { code: "F401", name: "unused-import", linter: "Pyflakes", summary: "", fixable: true, preview: false, enabled: true },
  { code: "E501", name: "line-too-long", linter: "pycodestyle", summary: "", fixable: false, preview: false, enabled: false },
];
const rulesIndex = buildRulesIndex(RULES);

/** One representative value per `Tier4FieldKind`, used to exercise every real field generically. */
function sampleValue(spec: Tier4FieldSpec): Tier4Value {
  switch (spec.kind) {
    case "boolean":
      return true;
    case "integer":
      return 5;
    case "string":
      return "example";
    case "enum":
      return (spec.enumValues ?? [])[0];
    case "stringArray":
      return ["a", "b"];
    case "record":
      return { mod: "value" };
    case "recordArray":
      return { mod: ["a", "b"] };
    case "importSelector":
      return { include: ["mod.a"], exclude: ["mod.b"] };
  }
}

function visualWith(pluginKey: string, fieldKey: string, value: Tier4Value): VisualOptions {
  return { ...EMPTY_VISUAL_OPTIONS, tier4: { [pluginKey]: { [fieldKey]: value } } };
}

describe("TIER4_SCHEMA", () => {
  test("every categoryKey matches a real linter in a real version's rules.json", () => {
    const rules = JSON.parse(readFileSync("public/versions/0.16.4/rules.json", "utf8")) as Rule[];
    const linters = new Set(rules.map((rule) => rule.linter));
    for (const plugin of TIER4_SCHEMA) {
      expect(linters, `plugin "${plugin.key}"'s categoryKey "${plugin.categoryKey}"`).toContain(plugin.categoryKey);
    }
  });

  test("has 27 plugins covering 119 fields, per the real ruff.schema.json audit", () => {
    expect(TIER4_SCHEMA).toHaveLength(27);
    expect(TIER4_SCHEMA.reduce((total, plugin) => total + plugin.fields.length, 0)).toBe(119);
  });

  for (const plugin of TIER4_SCHEMA) {
    for (const field of plugin.fields) {
      test(`${plugin.key}.${field.key} (${field.kind}) round-trips through RuffOptions with no extra keys`, () => {
        const value = sampleValue(field);
        const visual = visualWith(plugin.key, field.key, value);
        const ruffOptions = visualOptionsToRuffOptions(visual, rulesIndex);
        const { visual: roundTripped, extraKeys } = ruffOptionsToVisualOptions(ruffOptions, rulesIndex);
        expect(extraKeys).toEqual([]);
        expect(roundTripped.tier4).toEqual({ [plugin.key]: { [field.key]: value } });
      });
    }
  }
});

describe("Tier 4 special shapes", () => {
  test("banned-api's wrapKey wraps each value as {msg: ...} on the Ruff side", () => {
    const visual = visualWith("flake8-tidy-imports", "banned-api", { "os.path": "use pathlib instead" });
    const options = visualOptionsToRuffOptions(visual, rulesIndex);
    expect(options).toMatchObject({ lint: { "flake8-tidy-imports": { "banned-api": { "os.path": { msg: "use pathlib instead" } } } } });
  });

  test("banned-api unwraps {msg: ...} back to a plain string map", () => {
    const options = { lint: { "flake8-tidy-imports": { "banned-api": { "os.path": { msg: "use pathlib instead" } } } } };
    const { visual, extraKeys } = ruffOptionsToVisualOptions(options, rulesIndex);
    expect(visual.tier4).toEqual({ "flake8-tidy-imports": { "banned-api": { "os.path": "use pathlib instead" } } });
    expect(extraKeys).toEqual([]);
  });

  test("banned-api's wrapped object with extra keys or wrong inner shape is an extra key", () => {
    const { extraKeys: e1 } = ruffOptionsToVisualOptions(
      { lint: { "flake8-tidy-imports": { "banned-api": { "os.path": { msg: "x", extra: true } } } } },
      rulesIndex,
    );
    expect(e1).toContain("lint.flake8-tidy-imports.banned-api");

    const { extraKeys: e2 } = ruffOptionsToVisualOptions(
      { lint: { "flake8-tidy-imports": { "banned-api": { "os.path": "not-an-object" } } } },
      rulesIndex,
    );
    expect(e2).toContain("lint.flake8-tidy-imports.banned-api");
  });

  test("importSelector serializes a bare include list to a plain array when exclude is empty", () => {
    const visual = visualWith("flake8-tidy-imports", "ban-lazy", { include: ["mod.a"] });
    const options = visualOptionsToRuffOptions(visual, rulesIndex);
    expect(options).toMatchObject({ lint: { "flake8-tidy-imports": { "ban-lazy": ["mod.a"] } } });
  });

  test("importSelector serializes include: 'all' to the literal string when exclude is empty", () => {
    const visual = visualWith("flake8-tidy-imports", "ban-lazy", { include: "all" });
    const options = visualOptionsToRuffOptions(visual, rulesIndex);
    expect(options).toMatchObject({ lint: { "flake8-tidy-imports": { "ban-lazy": "all" } } });
  });

  test("importSelector serializes to the full {include, exclude} object once exclude is non-empty", () => {
    const visual = visualWith("flake8-tidy-imports", "ban-lazy", { include: "all", exclude: ["mod.b"] });
    const options = visualOptionsToRuffOptions(visual, rulesIndex);
    expect(options).toMatchObject({ lint: { "flake8-tidy-imports": { "ban-lazy": { include: "all", exclude: ["mod.b"] } } } });
  });

  test("importSelector parses all three real shapes back", () => {
    for (const [raw, expected] of [
      ["all", { include: "all" }],
      [["mod.a"], { include: ["mod.a"] }],
      [{ include: "all", exclude: ["mod.b"] }, { include: "all", exclude: ["mod.b"] }],
    ] as const) {
      const { visual, extraKeys } = ruffOptionsToVisualOptions({ lint: { "flake8-tidy-imports": { "ban-lazy": raw } } }, rulesIndex);
      expect(visual.tier4).toEqual({ "flake8-tidy-imports": { "ban-lazy": expected } });
      expect(extraKeys).toEqual([]);
    }
  });

  test("a malformed value for each non-scalar kind is reported as an extra key, not imported", () => {
    const cases: Array<[string, string, unknown]> = [
      ["isort", "known-first-party", { not: "an array" }], // stringArray
      ["flake8-import-conventions", "aliases", { mod: 42 }], // record
      ["isort", "sections", { section: "not-an-array" }], // recordArray
      ["flake8-tidy-imports", "ban-lazy", { include: 42 }], // importSelector
    ];
    for (const [pluginKey, fieldKey, badValue] of cases) {
      const { visual, extraKeys } = ruffOptionsToVisualOptions({ lint: { [pluginKey]: { [fieldKey]: badValue } } }, rulesIndex);
      expect(visual.tier4, `${pluginKey}.${fieldKey}`).toEqual({});
      expect(extraKeys, `${pluginKey}.${fieldKey}`).toContain(`lint.${pluginKey}.${fieldKey}`);
    }
  });

  test("an unrecognized plugin key under lint is reported as an extra key", () => {
    const { extraKeys } = ruffOptionsToVisualOptions({ lint: { "not-a-real-plugin": { x: 1 } } }, rulesIndex);
    expect(extraKeys).toContain("lint.not-a-real-plugin");
  });

  test("an unrecognized field within a real plugin is reported as an extra key", () => {
    const { visual, extraKeys } = ruffOptionsToVisualOptions({ lint: { isort: { "not-a-real-field": true } } }, rulesIndex);
    expect(visual.tier4).toEqual({});
    expect(extraKeys).toContain("lint.isort.not-a-real-field");
  });

  test("select/ignore/extend-select still route to tier2, not tier4, when tier4 fields are also present", () => {
    const options = { lint: { select: ["F"], isort: { "known-first-party": ["myapp"] } } };
    const { visual, extraKeys } = ruffOptionsToVisualOptions(options, rulesIndex);
    expect(visual.tier2.categorySelected).toEqual(["Pyflakes"]);
    expect(visual.tier4).toEqual({ isort: { "known-first-party": ["myapp"] } });
    expect(extraKeys).toEqual([]);
  });
});
