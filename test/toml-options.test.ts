import { describe, expect, test } from "vitest";
import { tomlToOptions } from "../src/config/toml-options";

describe("tomlToOptions", () => {
  test("extracts a scalar option from a [tool.ruff] table", () => {
    const result = tomlToOptions("[tool.ruff]\nline-length = 20\n");
    expect(result).toEqual({
      ok: true,
      hasRuffTable: true,
      options: { "line-length": 20 },
    });
  });

  test("keeps Ruff's kebab-case keys verbatim and preserves nested tables", () => {
    // Ruff's `Options` mirror `[tool.ruff]` ~1:1 and its serde field names are
    // kebab-case, so the TOML keys must be passed through untouched.
    const result = tomlToOptions(
      ['[tool.ruff]', 'line-length = 20', 'target-version = "py311"', '', '[tool.ruff.lint]', 'select = ["E", "F"]', ''].join(
        "\n",
      ),
    );
    expect(result).toEqual({
      ok: true,
      hasRuffTable: true,
      options: {
        "line-length": 20,
        "target-version": "py311",
        lint: { select: ["E", "F"] },
      },
    });
  });

  test("malformed TOML produces a parse error, not a throw", () => {
    const result = tomlToOptions("[tool.ruff\nline-length = 20\n");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a parse failure");
    expect(result.message).toMatch(/line \d+/);
    expect(result.message.length).toBeGreaterThan(0);
  });

  test("malformed TOML: a bare unparseable value also reports a line number", () => {
    const result = tomlToOptions('[tool.ruff]\nline-length = "unclosed\n');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a parse failure");
    expect(result.message).toMatch(/line 2/);
  });

  test("empty document yields default (empty) options", () => {
    expect(tomlToOptions("")).toEqual({ ok: true, hasRuffTable: false, options: {} });
    expect(tomlToOptions("   \n\n# just a comment\n")).toEqual({
      ok: true,
      hasRuffTable: false,
      options: {},
    });
  });

  test("document without a [tool.ruff] table yields default (empty) options", () => {
    const result = tomlToOptions('[project]\nname = "demo"\n\n[tool.black]\nline-length = 20\n');
    expect(result).toEqual({ ok: true, hasRuffTable: false, options: {} });
  });

  test("an empty [tool.ruff] table is reported as present but empty", () => {
    expect(tomlToOptions("[tool.ruff]\n")).toEqual({
      ok: true,
      hasRuffTable: true,
      options: {},
    });
  });

  test("a non-table [tool.ruff] is a parse error rather than bogus options", () => {
    const result = tomlToOptions('[tool]\nruff = "nope"\n');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a parse failure");
    expect(result.message).toMatch(/\[tool\.ruff\]/);
  });

  test("a non-table [tool] is a parse error rather than bogus options", () => {
    const result = tomlToOptions("tool = 1\n");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a parse failure");
    expect(result.message).toMatch(/\[tool\]/);
  });

  test("out-of-range integers are rejected rather than handed to Ruff as BigInt", () => {
    // smol-toml returns a BigInt for integers outside the safe range; a BigInt
    // would blow up inside wasm-bindgen's serde bridge with an opaque error, so
    // catch it here where we can say something useful.
    const result = tomlToOptions("[tool.ruff]\nline-length = 99999999999999999999\n");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a parse failure");
    expect(result.message).toMatch(/line-length/);
  });
});
