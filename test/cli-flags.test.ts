import { describe, expect, test } from "vitest";
import { shellTokenize, cliFlagsToOptions, optionsToCliFlags, deepMergeOptions } from "../src/config/cli-flags";
import type { RuffOptions } from "../src/config/toml-options";

describe("shellTokenize", () => {
  test("splits on unquoted whitespace", () => {
    expect(shellTokenize("--select E,F --preview")).toEqual(["--select", "E,F", "--preview"]);
  });

  test("keeps a double-quoted value with internal spaces as one token, unquoting it", () => {
    expect(shellTokenize('--config "lint.select=[\\"E\\", \\"F\\"]"')).toEqual([
      "--config",
      'lint.select=["E", "F"]',
    ]);
  });

  test("keeps a single-quoted value with internal spaces as one token, unquoting it", () => {
    expect(shellTokenize("--config 'line-length = 20'")).toEqual(["--config", "line-length = 20"]);
  });

  test("collapses repeated whitespace and trims ends", () => {
    expect(shellTokenize("  --preview   --fix  ")).toEqual(["--preview", "--fix"]);
  });

  test("empty input yields no tokens", () => {
    expect(shellTokenize("")).toEqual([]);
    expect(shellTokenize("   ")).toEqual([]);
  });
});

describe("cliFlagsToOptions", () => {
  test("empty input succeeds with empty options and no ignored flags", () => {
    expect(cliFlagsToOptions("")).toEqual({ ok: true, hasRuffTable: true, options: {}, ignoredFlags: [] });
  });

  test("strips a leading 'ruff' and 'check' token, not reporting them as ignored", () => {
    const result = cliFlagsToOptions("ruff check --preview");
    expect(result).toEqual({ ok: true, hasRuffTable: true, options: { preview: true }, ignoredFlags: [] });
  });

  test("strips a leading 'format' token too", () => {
    const result = cliFlagsToOptions("ruff format --preview");
    expect(result).toEqual({ ok: true, hasRuffTable: true, options: { preview: true }, ignoredFlags: [] });
  });

  test("works with no leading ruff/check token at all", () => {
    expect(cliFlagsToOptions("--preview")).toEqual({
      ok: true,
      hasRuffTable: true,
      options: { preview: true },
      ignoredFlags: [],
    });
  });

  describe("native flags", () => {
    test("--select/--ignore/--extend-select as comma lists under lint", () => {
      const result = cliFlagsToOptions("--select E,F --ignore E501 --extend-select B006");
      expect(result).toEqual({
        ok: true,
        hasRuffTable: true,
        options: { lint: { select: ["E", "F"], ignore: ["E501"], "extend-select": ["B006"] } },
        ignoredFlags: [],
      });
    });

    test("--fixable/--unfixable/--extend-fixable as comma lists under lint", () => {
      const result = cliFlagsToOptions("--fixable E --unfixable F401 --extend-fixable B");
      expect(result).toEqual({
        ok: true,
        hasRuffTable: true,
        options: { lint: { fixable: ["E"], unfixable: ["F401"], "extend-fixable": ["B"] } },
        ignoredFlags: [],
      });
    });

    test("--target-version is a bare top-level string", () => {
      expect(cliFlagsToOptions("--target-version py311")).toEqual({
        ok: true,
        hasRuffTable: true,
        options: { "target-version": "py311" },
        ignoredFlags: [],
      });
    });

    test("--preview/--fix/--unsafe-fixes are top-level booleans with no value", () => {
      const result = cliFlagsToOptions("--preview --fix --unsafe-fixes");
      expect(result).toEqual({
        ok: true,
        hasRuffTable: true,
        options: { preview: true, fix: true, "unsafe-fixes": true },
        ignoredFlags: [],
      });
    });

    test("supports the --flag=value inline form", () => {
      expect(cliFlagsToOptions("--select=E,F --target-version=py311")).toEqual({
        ok: true,
        hasRuffTable: true,
        options: { lint: { select: ["E", "F"] }, "target-version": "py311" },
        ignoredFlags: [],
      });
    });

    test("comma-list values are trimmed and empty entries filtered", () => {
      expect(cliFlagsToOptions("--select ' E , F ,, '")).toEqual({
        ok: true,
        hasRuffTable: true,
        options: { lint: { select: ["E", "F"] } },
        ignoredFlags: [],
      });
    });
  });

  describe("--config generic escape hatch", () => {
    test("sets a top-level scalar", () => {
      expect(cliFlagsToOptions('--config "line-length=20"')).toEqual({
        ok: true,
        hasRuffTable: true,
        options: { "line-length": 20 },
        ignoredFlags: [],
      });
    });

    test("sets a nested dotted path, creating intermediate tables", () => {
      expect(cliFlagsToOptions('--config \'lint.pydocstyle.convention="google"\'')).toEqual({
        ok: true,
        hasRuffTable: true,
        options: { lint: { pydocstyle: { convention: "google" } } },
        ignoredFlags: [],
      });
    });

    test("accepts an inline array value", () => {
      expect(cliFlagsToOptions('--config \'lint.select=["E", "F"]\'')).toEqual({
        ok: true,
        hasRuffTable: true,
        options: { lint: { select: ["E", "F"] } },
        ignoredFlags: [],
      });
    });

    test("accepts an inline table value", () => {
      const result = cliFlagsToOptions("--config 'lint.per-file-ignores={\"__init__.py\" = [\"F401\"]}'");
      expect(result).toEqual({
        ok: true,
        hasRuffTable: true,
        options: { lint: { "per-file-ignores": { "__init__.py": ["F401"] } } },
        ignoredFlags: [],
      });
    });

    test("a bare unquoted string value is a distinct parse error naming the flag", () => {
      const result = cliFlagsToOptions('--config "target-version=py311"');
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.message).toContain("--config");
      expect(result.message).toContain("target-version");
    });

    test("an intermediate path segment that's already a non-table is an error", () => {
      const result = cliFlagsToOptions('--config "line-length=20" --config "line-length.x=1"');
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.message).toContain("line-length");
    });

    test("repeated --config flags merge together", () => {
      expect(cliFlagsToOptions('--config "line-length=20" --config "preview=true"')).toEqual({
        ok: true,
        hasRuffTable: true,
        options: { "line-length": 20, preview: true },
        ignoredFlags: [],
      });
    });
  });

  describe("last-write-wins ordering", () => {
    test("a later --select overrides an earlier one", () => {
      expect(cliFlagsToOptions("--select E --select F")).toEqual({
        ok: true,
        hasRuffTable: true,
        options: { lint: { select: ["F"] } },
        ignoredFlags: [],
      });
    });

    test("a later --config overrides an earlier native flag at the same path", () => {
      expect(cliFlagsToOptions('--select E --config \'lint.select=["F"]\'')).toEqual({
        ok: true,
        hasRuffTable: true,
        options: { lint: { select: ["F"] } },
        ignoredFlags: [],
      });
    });

    test("a native flag after --config at the same path wins in turn", () => {
      expect(cliFlagsToOptions('--config \'lint.select=["F"]\' --select E')).toEqual({
        ok: true,
        hasRuffTable: true,
        options: { lint: { select: ["E"] } },
        ignoredFlags: [],
      });
    });
  });

  describe("recognized-but-inert flags and positional arguments", () => {
    test("a 0-value inert flag is reported in ignoredFlags and doesn't affect options", () => {
      expect(cliFlagsToOptions("--watch --preview")).toEqual({
        ok: true,
        hasRuffTable: true,
        options: { preview: true },
        ignoredFlags: ["--watch"],
      });
    });

    test("a 1-value inert flag correctly consumes its value and doesn't swallow the next flag", () => {
      const result = cliFlagsToOptions("--output-file out.json --preview");
      expect(result).toEqual({
        ok: true,
        hasRuffTable: true,
        options: { preview: true },
        ignoredFlags: ["--output-file"],
      });
    });

    test("a positional argument is reported in ignoredFlags", () => {
      expect(cliFlagsToOptions("--preview src/")).toEqual({
        ok: true,
        hasRuffTable: true,
        options: { preview: true },
        ignoredFlags: ["src/"],
      });
    });

    test("multiple ignored items appear in encounter order", () => {
      const result = cliFlagsToOptions("--watch --preview src/ --no-cache");
      expect(result).toEqual({
        ok: true,
        hasRuffTable: true,
        options: { preview: true },
        ignoredFlags: ["--watch", "src/", "--no-cache"],
      });
    });

    test("--per-file-ignores is inert (non-TOML value syntax) but reachable via --config instead", () => {
      const result = cliFlagsToOptions('--per-file-ignores "x.py:F401" --preview');
      expect(result).toEqual({
        ok: true,
        hasRuffTable: true,
        options: { preview: true },
        ignoredFlags: ["--per-file-ignores"],
      });
    });
  });

  describe("errors", () => {
    test("an unknown flag is a hard error naming the flag and pointing at --config", () => {
      const result = cliFlagsToOptions("--line-length 20");
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.message).toContain("--line-length");
      expect(result.message).toContain("--config");
    });

    test("a native value flag missing its value is an error", () => {
      const result = cliFlagsToOptions("--select");
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.message).toContain("--select");
    });

    test("--config missing its value is an error", () => {
      const result = cliFlagsToOptions("--config");
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.message).toContain("--config");
    });
  });
});

describe("optionsToCliFlags", () => {
  test("empty options produce empty text", () => {
    expect(optionsToCliFlags({})).toEqual({ text: "" });
  });

  test("round-trips native fields as native flags, in real Ruff's help order", () => {
    const options: RuffOptions = {
      preview: true,
      fix: true,
      "unsafe-fixes": true,
      "target-version": "py311",
      lint: {
        select: ["E", "F"],
        ignore: ["E501"],
        "extend-select": ["B006"],
        fixable: ["E"],
        unfixable: ["F401"],
        "extend-fixable": ["B"],
      },
    };
    const { text } = optionsToCliFlags(options);
    expect(text).toBe(
      [
        "--select E,F",
        "--ignore E501",
        "--extend-select B006",
        "--fixable E",
        "--unfixable F401",
        "--extend-fixable B",
        "--target-version py311",
        "--preview",
        "--fix",
        "--unsafe-fixes",
      ].join(" "),
    );
  });

  test("falls back to --config for a top-level key with no native flag", () => {
    expect(optionsToCliFlags({ "line-length": 88 })).toEqual({ text: '--config "line-length=88"' });
  });

  test("falls back to --config for a nested plugin field, dotted path", () => {
    // Wrapped in single quotes rather than escaped double quotes -- minimal-escaping is a
    // deliberate readability choice, not a correctness requirement (both parse identically).
    expect(optionsToCliFlags({ lint: { pydocstyle: { convention: "google" } } })).toEqual({
      text: "--config 'lint.pydocstyle.convention=\"google\"'",
    });
  });

  test("falls back to --config with inline array/table syntax for values not shaped like native flags", () => {
    const { text } = optionsToCliFlags({ lint: { "per-file-ignores": { "__init__.py": ["F401"] } } });
    expect(text).toBe('--config \'lint.per-file-ignores={ "__init__.py" = [ "F401" ] }\'');
  });

  test("--config fallback keys are sorted by path for determinism", () => {
    const { text } = optionsToCliFlags({ "unsafe-fixes": "not-a-bool", "indent-width": 2 });
    expect(text).toBe("--config \"indent-width=2\" --config 'unsafe-fixes=\"not-a-bool\"'");
  });

  test("a wrong-typed native-looking field falls back to --config instead of the native flag", () => {
    // e.g. `preview` as a string, not a boolean -- shouldn't be emitted as bare `--preview`
    const { text } = optionsToCliFlags({ preview: "yes" });
    expect(text).toBe("--config 'preview=\"yes\"'");
  });

  test("parse -> serialize -> parse round-trips for a representative option tree", () => {
    const original: RuffOptions = {
      preview: true,
      "target-version": "py311",
      "line-length": 100,
      lint: {
        select: ["E", "F"],
        "extend-select": ["B006"],
        pydocstyle: { convention: "google" },
      },
    };
    const { text } = optionsToCliFlags(original);
    const reparsed = cliFlagsToOptions(text);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) throw new Error("expected success");
    expect(reparsed.options).toEqual(original);
  });
});

describe("deepMergeOptions", () => {
  test("override's scalar replaces base's scalar", () => {
    expect(deepMergeOptions({ "line-length": 88 }, { "line-length": 100 })).toEqual({ "line-length": 100 });
  });

  test("override's array wholesale-replaces base's array (not element-merged)", () => {
    expect(deepMergeOptions({ lint: { select: ["E"] } }, { lint: { select: ["F"] } })).toEqual({
      lint: { select: ["F"] },
    });
  });

  test("sibling keys from base and override both survive (select from base, extend-select from override)", () => {
    expect(deepMergeOptions({ lint: { select: ["E", "F"] } }, { lint: { "extend-select": ["B006"] } })).toEqual({
      lint: { select: ["E", "F"], "extend-select": ["B006"] },
    });
  });

  test("nested-table merge leaves untouched siblings alone", () => {
    const base: RuffOptions = { lint: { select: ["E"], pydocstyle: { convention: "numpy" } } };
    const override: RuffOptions = { lint: { ignore: ["E501"] } };
    expect(deepMergeOptions(base, override)).toEqual({
      lint: { select: ["E"], pydocstyle: { convention: "numpy" }, ignore: ["E501"] },
    });
  });

  test("an empty override returns the base's content unchanged", () => {
    const base: RuffOptions = { "line-length": 88, lint: { select: ["E"] } };
    expect(deepMergeOptions(base, {})).toEqual(base);
  });

  test("an empty base returns the override's content unchanged", () => {
    const override: RuffOptions = { "line-length": 88, lint: { select: ["E"] } };
    expect(deepMergeOptions({}, override)).toEqual(override);
  });
});
