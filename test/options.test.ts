import { describe, expect, test } from "vitest";
import {
  EMPTY_VISUAL_OPTIONS,
  ruffOptionsToVisualOptions,
  visualOptionsToRuffOptions,
  visualOptionsToTomlText,
  type VisualOptions,
} from "../src/config/options";
import { tomlToOptions } from "../src/config/toml-options";

describe("visualOptionsToRuffOptions", () => {
  test("all-unset visual options produce an empty RuffOptions", () => {
    expect(visualOptionsToRuffOptions(EMPTY_VISUAL_OPTIONS)).toEqual({});
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
    };
    expect(visualOptionsToRuffOptions(visual)).toEqual({
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
    };
    expect(visualOptionsToRuffOptions(visual)).toEqual({
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
    const visual: VisualOptions = { tier1: { lineLength: 88 }, tier3: {} };
    const options = visualOptionsToRuffOptions(visual);
    expect(options).not.toHaveProperty("format");
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
    const { visual, extraKeys } = ruffOptionsToVisualOptions(options);
    expect(visual).toEqual({
      tier1: { fix: true, lineLength: 100, targetVersion: "py311" },
      tier3: { quoteStyle: "single", preview: true },
    });
    expect(extraKeys).toEqual([]);
  });

  test("an unknown top-level key is reported as an extra key, not imported", () => {
    const { visual, extraKeys } = ruffOptionsToVisualOptions({
      "line-length": 88,
      lint: { select: ["F"] },
    });
    expect(visual.tier1).toEqual({ lineLength: 88 });
    expect(extraKeys).toContain("lint");
  });

  test("an unknown format sub-key is reported as an extra key", () => {
    const { visual, extraKeys } = ruffOptionsToVisualOptions({
      format: { "quote-style": "double", "docstring-code-line-length": 40 },
    });
    expect(visual.tier3).toEqual({ quoteStyle: "double" });
    expect(extraKeys).toContain("format.docstring-code-line-length");
  });

  test("a wrong-typed known field is treated as an extra key, not imported", () => {
    const { visual, extraKeys } = ruffOptionsToVisualOptions({ "line-length": "not-a-number" });
    expect(visual.tier1).toEqual({});
    expect(extraKeys).toContain("line-length");
  });

  test("a non-table format value is reported as extra without crashing", () => {
    const { visual, extraKeys } = ruffOptionsToVisualOptions({ format: "oops" });
    expect(visual.tier3).toEqual({});
    expect(extraKeys).toContain("format");
  });

  test("empty options round-trip to empty visual options with no extra keys", () => {
    expect(ruffOptionsToVisualOptions({})).toEqual({ visual: EMPTY_VISUAL_OPTIONS, extraKeys: [] });
  });
});

describe("visualOptionsToTomlText", () => {
  test("produces TOML that tomlToOptions parses back to the same RuffOptions", () => {
    const visual: VisualOptions = {
      tier1: { fix: true, lineLength: 100, targetVersion: "py311" },
      tier3: { quoteStyle: "single", skipMagicTrailingComma: true },
    };
    const text = visualOptionsToTomlText(visual);
    const result = tomlToOptions(text);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a parse success");
    expect(result.options).toEqual(visualOptionsToRuffOptions(visual));
  });

  test("all-unset visual options produce a TOML doc with an empty [tool.ruff] table", () => {
    const text = visualOptionsToTomlText(EMPTY_VISUAL_OPTIONS);
    const result = tomlToOptions(text);
    expect(result).toEqual({ ok: true, hasRuffTable: true, options: {} });
  });
});
