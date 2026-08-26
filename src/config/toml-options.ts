import { parse, stringify, TomlError } from "smol-toml";

/**
 * Ruff's `Options` — the value handed verbatim to `new Workspace(options, ...)`.
 *
 * There is no useful static type for this: `ruff_wasm.d.ts` declares the
 * constructor as `constructor(options: any, ...)`, and the real shape is
 * whatever Ruff's serde `Options` struct deserializes. Confirmed empirically
 * against `@astral-sh/ruff-wasm-web@0.16.4`:
 *
 *   - it is the *contents* of `[tool.ruff]`, flattened — `{ tool: { ruff: … } }`
 *     is rejected with "unknown field `tool`";
 *   - field names are kebab-case exactly as written in TOML — `lineLength` is
 *     rejected with "unknown field `lineLength`", `"line-length"` works;
 *   - unknown fields throw rather than being ignored, so a typo surfaces as a
 *     Ruff exception at `Workspace` construction time.
 *
 * So the conversion is a pass-through of the `[tool.ruff]` table, with no key
 * renaming at all.
 */
export type RuffOptions = Record<string, unknown>;

export interface TomlOptionsSuccess {
  ok: true;
  options: RuffOptions;
  /**
   * `false` when the document parsed fine but had no `[tool.ruff]` table, so
   * `options` is `{}` and Ruff's own defaults apply. Callers surface this so
   * that an Apply on, say, a stray `[tool.black]` table isn't a silent no-op.
   */
  hasRuffTable: boolean;
}

export interface TomlOptionsFailure {
  ok: false;
  /** Human-readable, including line/column when smol-toml reports them. */
  message: string;
}

/**
 * Result of turning TOML config text into Ruff `Options`.
 *
 * A failure here is a *third* kind of error, deliberately distinct from both a
 * lint diagnostic and a Ruff exception: the config text never reached Ruff at
 * all, and the previously applied config is still the active one.
 */
export type TomlOptionsResult = TomlOptionsSuccess | TomlOptionsFailure;

function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * smol-toml returns a BigInt for integers outside the safe-integer range.
 * Passing one into wasm-bindgen's serde bridge fails with an opaque error, so
 * reject it here where we can point at the offending key.
 */
function findBigIntKey(value: unknown, path: string[] = []): string | null {
  if (typeof value === "bigint") return path.join(".");
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findBigIntKey(item, [...path, String(index)]);
      if (found !== null) return found;
    }
    return null;
  }
  if (isTable(value)) {
    for (const [key, item] of Object.entries(value)) {
      const found = findBigIntKey(item, [...path, key]);
      if (found !== null) return found;
    }
  }
  return null;
}

function failure(message: string): TomlOptionsFailure {
  return { ok: false, message };
}

/**
 * Parses pyproject.toml-shaped config text and extracts `[tool.ruff]` as Ruff
 * `Options`. Never throws — malformed input comes back as `{ ok: false }`.
 */
export function tomlToOptions(text: string): TomlOptionsResult {
  let document: unknown;
  try {
    document = parse(text);
  } catch (error) {
    if (error instanceof TomlError) {
      return failure(`TOML syntax error at line ${error.line}, column ${error.column}: ${error.message}`);
    }
    return failure(`TOML syntax error: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isTable(document)) {
    return failure("TOML document is not a table.");
  }

  if (!("tool" in document)) {
    return { ok: true, options: {}, hasRuffTable: false };
  }
  const tool = document.tool;
  if (!isTable(tool)) {
    return failure("`[tool]` must be a table, so that `[tool.ruff]` can hold Ruff's config.");
  }

  if (!("ruff" in tool)) {
    return { ok: true, options: {}, hasRuffTable: false };
  }
  const options = tool.ruff;
  if (!isTable(options)) {
    return failure("`[tool.ruff]` must be a table of Ruff config options.");
  }

  const bigIntKey = findBigIntKey(options);
  if (bigIntKey !== null) {
    return failure(`\`${bigIntKey}\` is too large an integer for Ruff to accept.`);
  }

  return { ok: true, options, hasRuffTable: true };
}

/** Reverses `tomlToOptions`'s extraction: wraps flattened `Options` back into `[tool.ruff]` TOML text. */
export function ruffOptionsToTomlText(options: RuffOptions): string {
  return stringify({ tool: { ruff: options } });
}
