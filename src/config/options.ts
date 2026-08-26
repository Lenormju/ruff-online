import { toSelectIgnore, type CategorySelected, type RuleOverrides } from "./rule-reconciliation";
import type { RulesIndex } from "./rules-data";
import { TIER4_SCHEMA, type Tier4FieldSpec } from "./tier4-schema";
import { lintToVisual, type LintSelectors } from "./toml-to-visual";
import { ruffOptionsToTomlText, type RuffOptions } from "./toml-options";

/**
 * "Code" bundles TOML (base config) + CLI (override flags) — two
 * complementary layers of one merged `RuffOptions`, not alternate views of
 * the same value, so there is no lossy-conversion concept between them.
 * "Visual" is the structured-form facet.
 */
export type Mode = "code" | "visual";

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

/** `flake8-tidy-imports`' `ban-lazy`/`require-lazy` — see `ruff.schema.json`'s `ImportSelector`. */
export interface ImportSelectorValue {
  include: "all" | string[];
  exclude?: string[];
}

/**
 * A Tier 4 field's value, keyed by `Tier4FieldKind`: `boolean`/`integer`/
 * `string`/`enum` are scalars, `stringArray` a list, `record`/`recordArray`
 * a string-keyed map (of strings or of string lists), `importSelector` the
 * one genuine union (see `ImportSelectorValue`).
 */
export type Tier4Value = boolean | number | string | string[] | Record<string, string> | Record<string, string[]> | ImportSelectorValue;

/**
 * Visual mode's Tier 4 (plugin fine-tuning) state — plugin TOML key (e.g.
 * `"isort"`) -> field key (Ruff's own kebab-case, e.g. `"known-first-party"`)
 * -> value. Unlike Tier 1/3, this uses Ruff's own keys directly rather than
 * a hand-declared camelCase interface — with 119 fields across 27 plugins,
 * `TIER4_SCHEMA` (`tier4-schema.ts`) is already the single source of truth
 * for field names, so a second naming layer would add nothing. Only plugin
 * tables and fields that are actually set are present (mirrors Tier 1/3's
 * "only set keys present" convention, one level deeper).
 */
export type Tier4Options = Record<string, Record<string, Tier4Value>>;

export interface VisualOptions {
  tier1: Tier1Options;
  tier3: Tier3Options;
  tier2: Tier2Options;
  tier4: Tier4Options;
}

export const EMPTY_VISUAL_OPTIONS: VisualOptions = {
  tier1: {},
  tier3: {},
  tier2: { categorySelected: [], ruleOverrides: [] },
  tier4: {},
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

/** `ImportSelection` in `ruff.schema.json`: the literal `"all"`, or a bare include list. */
function isImportSelection(value: unknown): value is "all" | string[] {
  return value === "all" || isStringArray(value);
}

/**
 * Parses `flake8-tidy-imports`' `ban-lazy`/`require-lazy` real shape
 * (`ImportSelector` — `ImportSelection | ImportSelectorSettings`) into the
 * always-object `ImportSelectorValue`. Returns `undefined` for anything that
 * doesn't match one of the two real shapes.
 */
function parseImportSelector(value: unknown): ImportSelectorValue | undefined {
  if (isImportSelection(value)) return { include: value };
  if (isTable(value)) {
    const { include, exclude, ...rest } = value;
    if (Object.keys(rest).length > 0 || !isImportSelection(include)) return undefined;
    if (exclude === undefined) return { include };
    if (!isStringArray(exclude)) return undefined;
    return { include, exclude };
  }
  return undefined;
}

/** Reverses `parseImportSelector`: an empty/absent `exclude` collapses to the bare `ImportSelection` shape, matching how a hand-written TOML would naturally look. */
function serializeImportSelector(value: ImportSelectorValue): unknown {
  if (value.exclude !== undefined && value.exclude.length > 0) return { include: value.include, exclude: value.exclude };
  return value.include;
}

/** Serializes one Tier 4 field's value to what Ruff's `Options` expects for it. */
function tier4ValueToRuff(value: Tier4Value, spec: Tier4FieldSpec): unknown {
  if (spec.kind === "importSelector") return serializeImportSelector(value as ImportSelectorValue);
  if (spec.kind === "record" && spec.wrapKey !== undefined) {
    const wrapKey = spec.wrapKey;
    return Object.fromEntries(Object.entries(value as Record<string, string>).map(([key, inner]) => [key, { [wrapKey]: inner }]));
  }
  return value;
}

/** Parses a raw Ruff value into a Tier 4 field's value, per its `kind`. `undefined` means "doesn't match, treat as an extra key". */
function ruffValueToTier4(raw: unknown, spec: Tier4FieldSpec): Tier4Value | undefined {
  switch (spec.kind) {
    case "boolean":
      return typeof raw === "boolean" ? raw : undefined;
    case "integer":
      return typeof raw === "number" && Number.isInteger(raw) ? raw : undefined;
    case "string":
      return typeof raw === "string" ? raw : undefined;
    case "enum":
      return typeof raw === "string" && (spec.enumValues?.includes(raw) ?? false) ? raw : undefined;
    case "stringArray":
      return isStringArray(raw) ? raw : undefined;
    case "recordArray":
      return isTable(raw) && Object.values(raw).every(isStringArray) ? (raw as Record<string, string[]>) : undefined;
    case "record": {
      if (!isTable(raw)) return undefined;
      if (spec.wrapKey === undefined) {
        return Object.values(raw).every((inner) => typeof inner === "string") ? (raw as Record<string, string>) : undefined;
      }
      const wrapKey = spec.wrapKey;
      const result: Record<string, string> = {};
      for (const [key, inner] of Object.entries(raw)) {
        if (!isTable(inner) || Object.keys(inner).length !== 1 || typeof inner[wrapKey] !== "string") return undefined;
        result[key] = inner[wrapKey];
      }
      return result;
    }
    case "importSelector":
      return parseImportSelector(raw);
  }
}

/** Builds the `[tool.ruff.lint.<plugin>]` tables Tier 4 state maps to, one per non-empty plugin. */
function tier4ToRuffLint(tier4: Tier4Options): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const plugin of TIER4_SCHEMA) {
    const fields = tier4[plugin.key];
    if (!fields) continue;
    const pluginResult: Record<string, unknown> = {};
    for (const fieldSpec of plugin.fields) {
      const value = fields[fieldSpec.key];
      if (value === undefined) continue;
      pluginResult[fieldSpec.key] = tier4ValueToRuff(value, fieldSpec);
    }
    if (Object.keys(pluginResult).length > 0) result[plugin.key] = pluginResult;
  }
  return result;
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

  const lint: Record<string, unknown> = {};
  const tier2Lint = tier2ToLint(visual.tier2, rulesIndex);
  if (tier2Lint !== undefined) Object.assign(lint, tier2Lint);
  Object.assign(lint, tier4ToRuffLint(visual.tier4));
  if (Object.keys(lint).length > 0) result.lint = lint;

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

const TIER4_PLUGIN_BY_KEY = new Map(TIER4_SCHEMA.map((plugin) => [plugin.key, plugin]));

/**
 * Extracts everything this conversion understands from a parsed
 * `[tool.ruff.lint]` table: the four selector arrays (Tier 2) and any
 * recognized plugin sub-table (Tier 4, matched against `TIER4_SCHEMA`).
 * Anything else — an unrecognized top-level key, a known selector key or
 * plugin field with the wrong shape, a non-table plugin value — is reported
 * via `extraKeys` instead, same pattern as `ruffOptionsToTier`'s `format.*`
 * handling.
 */
function extractLintTables(lint: Record<string, unknown>): { selectors: LintSelectors; tier4: Tier4Options; extraKeys: string[] } {
  const selectors: LintSelectors = {};
  const tier4: Tier4Options = {};
  const extraKeys: string[] = [];

  for (const [key, value] of Object.entries(lint)) {
    if ((LINT_ARRAY_KEYS as readonly string[]).includes(key)) {
      if (isStringArray(value)) (selectors as Record<string, string[]>)[key] = value;
      else extraKeys.push(`lint.${key}`);
      continue;
    }

    const plugin = TIER4_PLUGIN_BY_KEY.get(key);
    if (!plugin) {
      extraKeys.push(`lint.${key}`);
      continue;
    }
    if (!isTable(value)) {
      extraKeys.push(`lint.${key}`);
      continue;
    }
    const fieldByKey = new Map(plugin.fields.map((field) => [field.key, field]));
    const fields: Record<string, Tier4Value> = {};
    for (const [fieldKey, rawValue] of Object.entries(value)) {
      const fieldSpec = fieldByKey.get(fieldKey);
      const parsed = fieldSpec ? ruffValueToTier4(rawValue, fieldSpec) : undefined;
      if (parsed === undefined) extraKeys.push(`lint.${key}.${fieldKey}`);
      else fields[fieldKey] = parsed;
    }
    if (Object.keys(fields).length > 0) tier4[key] = fields;
  }

  return { selectors, tier4, extraKeys };
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
  let tier4: Tier4Options = {};
  if (lint !== undefined) {
    if (rulesIndex === null) {
      extraKeys.push("lint");
    } else if (!isTable(lint)) {
      extraKeys.push("lint");
    } else {
      const { selectors, tier4: parsedTier4, extraKeys: lintExtra } = extractLintTables(lint);
      const { categorySelected, ruleOverrides } = lintToVisual(rulesIndex, selectors);
      tier2 = { categorySelected: [...categorySelected], ruleOverrides: [...ruleOverrides] };
      tier4 = parsedTier4;
      extraKeys.push(...lintExtra);
    }
  }

  return { visual: { tier1, tier3, tier2, tier4 }, extraKeys };
}

/**
 * Serializes Visual mode's state to TOML text. Always succeeds — Tier 1/2/3
 * together can't produce anything TOML can't express.
 */
export function visualOptionsToTomlText(visual: VisualOptions, rulesIndex: RulesIndex | null): string {
  return ruffOptionsToTomlText(visualOptionsToRuffOptions(visual, rulesIndex));
}
