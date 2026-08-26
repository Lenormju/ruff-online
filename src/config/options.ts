import { stringify } from "smol-toml";
import { toSelectIgnore, type CategorySelected, type RuleOverrides } from "./rule-reconciliation";
import type { RulesIndex } from "./rules-data";
import { lintToVisual, type LintSelectors } from "./toml-to-visual";
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

/**
 * Visual mode's rule-selection (Tier 2) state — the JSON-serializable form
 * used in `VisualOptions`/shareable URLs. `Set`/`Map` (the shape
 * `rule-reconciliation.ts` actually operates on) are converted to/from these
 * arrays at the boundary, in `tier2ToSelectors`/`tier2FromState` below.
 */
export interface Tier2Options {
  categorySelected: string[];
  ruleOverrides: Array<[string, "on" | "off"]>;
}

export interface VisualOptions {
  tier1: Tier1Options;
  tier3: Tier3Options;
  tier2: Tier2Options;
}

export const EMPTY_VISUAL_OPTIONS: VisualOptions = {
  tier1: {},
  tier3: {},
  tier2: { categorySelected: [], ruleOverrides: [] },
};

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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

const LINT_ARRAY_KEYS = ["select", "ignore", "extend-select", "extend-ignore"] as const;

/**
 * Builds the `[tool.ruff.lint]` table's `select`/`ignore`/`extend-select`
 * from Tier 2 state. Requires a `RulesIndex` — unlike Tier 1/3's static
 * field maps, this conversion is inherently version-dependent (category
 * membership and default-enabled status both come from that version's
 * `rules.json`). Returns `undefined` when there's nothing to say (no
 * `RulesIndex` yet, or nothing touched), so Ruff's own defaults apply.
 */
function tier2ToLint(tier2: Tier2Options, rulesIndex: RulesIndex | null): Record<string, string[]> | undefined {
  if (!rulesIndex) return undefined;
  const categorySelected: CategorySelected = new Set(tier2.categorySelected);
  const ruleOverrides: RuleOverrides = new Map(tier2.ruleOverrides);
  const { select, ignore, extendSelect } = toSelectIgnore(rulesIndex, categorySelected, ruleOverrides);
  if (select === undefined && ignore === undefined && extendSelect === undefined) return undefined;

  const lint: Record<string, string[]> = {};
  if (select !== undefined) lint.select = select;
  if (ignore !== undefined) lint.ignore = ignore;
  if (extendSelect !== undefined) lint["extend-select"] = extendSelect;
  return lint;
}

/**
 * Builds the flattened `RuffOptions` for `Workspace`/TOML from Visual mode's
 * state. `rulesIndex` is only needed for Tier 2 (rule selection); pass
 * `null` when it hasn't loaded yet for the current Ruff version — Tier 2 is
 * simply omitted in that case (Ruff's own defaults apply until it's ready).
 */
export function visualOptionsToRuffOptions(visual: VisualOptions, rulesIndex: RulesIndex | null): RuffOptions {
  const result = tierToRuffOptions(visual.tier1, TIER1_FIELDS);
  const format = tierToRuffOptions(visual.tier3, TIER3_FIELDS);
  if (Object.keys(format).length > 0) result.format = format;
  const lint = tier2ToLint(visual.tier2, rulesIndex);
  if (lint !== undefined) result.lint = lint;
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

const EMPTY_TIER2: Tier2Options = { categorySelected: [], ruleOverrides: [] };

/**
 * Extracts the four selector arrays this conversion understands from a
 * parsed `[tool.ruff.lint]` table, reporting anything else (an unknown key,
 * or a known key with the wrong type) via `extraKeys` — same pattern as
 * `ruffOptionsToTier`'s `format.*` handling.
 */
function extractLintSelectors(lint: Record<string, unknown>): { selectors: LintSelectors; extraKeys: string[] } {
  const selectors: LintSelectors = {};
  const extraKeys: string[] = [];
  for (const [key, value] of Object.entries(lint)) {
    if (!(LINT_ARRAY_KEYS as readonly string[]).includes(key)) {
      extraKeys.push(`lint.${key}`);
    } else if (!isStringArray(value)) {
      extraKeys.push(`lint.${key}`);
    } else {
      (selectors as Record<string, string[]>)[key] = value;
    }
  }
  return { selectors, extraKeys };
}

/**
 * Reverses `visualOptionsToRuffOptions`. Never throws — anything Tier 1/2/3
 * can't represent (an unknown key, an unknown `format`/`lint` sub-key, a
 * wrong-typed known field, a non-table `format`/`lint`, or a `lint` table
 * encountered before `rulesIndex` has loaded) is reported in `extraKeys`
 * instead of being imported or crashing, so callers can warn before a lossy
 * mode switch.
 */
export function ruffOptionsToVisualOptions(
  options: RuffOptions,
  rulesIndex: RulesIndex | null,
): { visual: VisualOptions; extraKeys: string[] } {
  const { format, lint, ...rest } = options;
  const { tier: tier1, extraKeys: tier1Extra } = ruffOptionsToTier<Tier1Options>(rest, TIER1_FIELDS, "");

  let tier3: Tier3Options = {};
  const extraKeys: string[] = [...tier1Extra];
  if (format !== undefined) {
    if (!isTable(format)) {
      extraKeys.push("format");
    } else {
      const result = ruffOptionsToTier<Tier3Options>(format, TIER3_FIELDS, "format.");
      tier3 = result.tier;
      extraKeys.push(...result.extraKeys);
    }
  }

  let tier2: Tier2Options = EMPTY_TIER2;
  if (lint !== undefined) {
    if (rulesIndex === null) {
      extraKeys.push("lint");
    } else if (!isTable(lint)) {
      extraKeys.push("lint");
    } else {
      const { selectors, extraKeys: lintExtra } = extractLintSelectors(lint);
      const { categorySelected, ruleOverrides } = lintToVisual(rulesIndex, selectors);
      tier2 = { categorySelected: [...categorySelected], ruleOverrides: [...ruleOverrides] };
      extraKeys.push(...lintExtra);
    }
  }

  return { visual: { tier1, tier3, tier2 }, extraKeys };
}

/**
 * Serializes Visual mode's state to TOML text. Always succeeds — Tier 1/2/3
 * together can't produce anything TOML can't express.
 */
export function visualOptionsToTomlText(visual: VisualOptions, rulesIndex: RulesIndex | null): string {
  return stringify({ tool: { ruff: visualOptionsToRuffOptions(visual, rulesIndex) } });
}
