import { stringify } from "smol-toml";
import type { RuffOptions } from "./toml-options";

export type Mode = "toml" | "visual";

/** Visual mode's global (Tier 1) fields — a subset of Ruff's top-level `Options`. */
export interface Tier1Options {
  fix?: boolean;
  unsafeFixes?: boolean;
  preview?: boolean;
  lineLength?: number;
  indentWidth?: number;
  targetVersion?: string;
}

/** Visual mode's format (Tier 3) fields — a subset of `[tool.ruff.format]`. */
export interface Tier3Options {
  indentStyle?: string;
  quoteStyle?: string;
  lineEnding?: string;
  skipMagicTrailingComma?: boolean;
  docstringCodeFormat?: boolean;
  preview?: boolean;
}

export interface VisualOptions {
  tier1: Tier1Options;
  tier3: Tier3Options;
}

export const EMPTY_VISUAL_OPTIONS: VisualOptions = { tier1: {}, tier3: {} };

type FieldKind = "boolean" | "number" | "string";

interface FieldSpec {
  ruffKey: string;
  kind: FieldKind;
}

/**
 * Explicit visual-field <-> Ruff-key maps — deliberately not derived from
 * each other's key casing, since Ruff's kebab-case keys don't uniformly
 * map back from camelCase (e.g. no ambiguity here, but this keeps the two
 * directions equally explicit and equally easy to extend in later phases).
 */
const TIER1_FIELDS: Record<keyof Tier1Options, FieldSpec> = {
  fix: { ruffKey: "fix", kind: "boolean" },
  unsafeFixes: { ruffKey: "unsafe-fixes", kind: "boolean" },
  preview: { ruffKey: "preview", kind: "boolean" },
  lineLength: { ruffKey: "line-length", kind: "number" },
  indentWidth: { ruffKey: "indent-width", kind: "number" },
  targetVersion: { ruffKey: "target-version", kind: "string" },
};

const TIER3_FIELDS: Record<keyof Tier3Options, FieldSpec> = {
  indentStyle: { ruffKey: "indent-style", kind: "string" },
  quoteStyle: { ruffKey: "quote-style", kind: "string" },
  lineEnding: { ruffKey: "line-ending", kind: "string" },
  skipMagicTrailingComma: { ruffKey: "skip-magic-trailing-comma", kind: "boolean" },
  docstringCodeFormat: { ruffKey: "docstring-code-format", kind: "boolean" },
  preview: { ruffKey: "preview", kind: "boolean" },
};

function matchesKind(value: unknown, kind: FieldKind): boolean {
  return typeof value === kind;
}

function tierToRuffOptions<T extends object>(tier: T, fields: Record<keyof T, FieldSpec>): RuffOptions {
  const result: RuffOptions = {};
  for (const key of Object.keys(fields) as (keyof T)[]) {
    const value = tier[key];
    if (value === undefined) continue;
    result[fields[key].ruffKey] = value;
  }
  return result;
}

/** Builds the flattened `RuffOptions` for `Workspace`/TOML from Visual mode's state. */
export function visualOptionsToRuffOptions(visual: VisualOptions): RuffOptions {
  const result = tierToRuffOptions(visual.tier1, TIER1_FIELDS);
  const format = tierToRuffOptions(visual.tier3, TIER3_FIELDS);
  if (Object.keys(format).length > 0) result.format = format;
  return result;
}

function ruffOptionsToTier<T extends object>(
  options: RuffOptions,
  fields: Record<keyof T, FieldSpec>,
  extraKeyPrefix: string,
): { tier: T; extraKeys: string[] } {
  const ruffKeyToField = new Map<string, { field: keyof T; kind: FieldKind }>();
  for (const key of Object.keys(fields) as (keyof T)[]) {
    ruffKeyToField.set(fields[key].ruffKey, { field: key, kind: fields[key].kind });
  }

  const tier = {} as T;
  const extraKeys: string[] = [];
  for (const [ruffKey, value] of Object.entries(options)) {
    const match = ruffKeyToField.get(ruffKey);
    if (!match) {
      extraKeys.push(extraKeyPrefix + ruffKey);
      continue;
    }
    if (!matchesKind(value, match.kind)) {
      extraKeys.push(extraKeyPrefix + ruffKey);
      continue;
    }
    tier[match.field] = value as T[keyof T];
  }
  return { tier, extraKeys };
}

function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reverses `visualOptionsToRuffOptions`. Never throws — anything Tier 1/3
 * can't represent (an unknown key, an unknown `format` sub-key, a
 * wrong-typed known field, or a non-table `format`) is reported in
 * `extraKeys` instead of being imported or crashing, so callers can warn
 * before a lossy mode switch.
 */
export function ruffOptionsToVisualOptions(options: RuffOptions): { visual: VisualOptions; extraKeys: string[] } {
  const { format, ...rest } = options;
  const { tier: tier1, extraKeys: tier1Extra } = ruffOptionsToTier<Tier1Options>(rest, TIER1_FIELDS, "");

  if (format === undefined) {
    return { visual: { tier1, tier3: {} }, extraKeys: tier1Extra };
  }
  if (!isTable(format)) {
    return { visual: { tier1, tier3: {} }, extraKeys: [...tier1Extra, "format"] };
  }
  const { tier: tier3, extraKeys: tier3Extra } = ruffOptionsToTier<Tier3Options>(format, TIER3_FIELDS, "format.");
  return { visual: { tier1, tier3 }, extraKeys: [...tier1Extra, ...tier3Extra] };
}

/**
 * Serializes Visual mode's state to TOML text. Always succeeds — Tier 1+3
 * alone can't produce anything TOML can't express.
 */
export function visualOptionsToTomlText(visual: VisualOptions): string {
  return stringify({ tool: { ruff: visualOptionsToRuffOptions(visual) } });
}
