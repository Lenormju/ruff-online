import type { CategorySelected, RuleOverrides } from "./rule-reconciliation";
import type { RulesIndex } from "./rules-data";

/** The shape of a parsed `[tool.ruff.lint]` table, as far as this conversion cares. */
export interface LintSelectors {
  select?: string[];
  ignore?: string[];
  "extend-select"?: string[];
  "extend-ignore"?: string[];
}

export interface Tier2State {
  categorySelected: CategorySelected;
  ruleOverrides: RuleOverrides;
}

function specificity(index: RulesIndex, selector: string): number {
  return index.byCode.has(selector) ? 1000 : selector.length;
}

/**
 * Reimplements Ruff's rule-selector precedence (exact code beats prefix,
 * longer prefix beats shorter, later-in-the-combined-list wins ties) to
 * resolve an arbitrary `{select, ignore, extend-select, extend-ignore}` into
 * a concrete enabled/disabled boolean per rule.
 *
 * `select`'s presence matters beyond its contents: when present (even as an
 * empty array) it REPLACES Ruff's own default-enabled set, so the baseline
 * for every unmatched rule is `false`. When absent, the baseline is that
 * rule's own default (`rule.enabled`) — both confirmed empirically (see
 * rule-reconciliation.ts's module doc).
 *
 * Best-effort, same caveat as the original spike: this is a reimplementation
 * for OUR rule set, not a substitute for Ruff's real resolver.
 */
function resolveEnabled(index: RulesIndex, lint: LintSelectors): Map<string, boolean> {
  const hasSelect = lint.select !== undefined;
  const allSelectors = [
    ...(lint.select ?? []).map((sel) => ({ sel, value: true })),
    ...(lint["extend-select"] ?? []).map((sel) => ({ sel, value: true })),
    ...(lint.ignore ?? []).map((sel) => ({ sel, value: false })),
    ...(lint["extend-ignore"] ?? []).map((sel) => ({ sel, value: false })),
  ].map((entry, i) => ({ ...entry, i, spec: specificity(index, entry.sel) }));

  const result = new Map<string, boolean>();
  for (const rule of index.rules) {
    const matches = allSelectors.filter(({ sel }) => sel === rule.code || rule.code.startsWith(sel));
    if (matches.length === 0) {
      result.set(rule.code, hasSelect ? false : rule.enabled);
      continue;
    }
    matches.sort((a, b) => a.spec - b.spec || a.i - b.i);
    result.set(rule.code, matches[matches.length - 1].value);
  }
  return result;
}

/**
 * Turns a resolved enabled/disabled map back into `categorySelected`/
 * `ruleOverrides`. Two distinct strategies depending on whether `select` was
 * present in the source TOML:
 *
 *   - `select` ABSENT: the user only ever expressed deltas (`ignore`/
 *     `extend-select`) on top of Ruff's real defaults, so `categorySelected`
 *     stays empty (nothing was ever "fully selected") and every rule whose
 *     resolved state differs from its own `rule.enabled` baseline becomes a
 *     one-off override. This is an EXACT (not best-effort) inverse of
 *     `toSelectIgnore`'s own baseline-preserving branch.
 *   - `select` PRESENT: baseline is `false` for everything, same ambiguity
 *     as the original spike (a category is ambiguous when its rules are an
 *     exact on/off tie) — resolved via majority vote, conservatively leaving
 *     a tied category unchecked. Preserves the *resolved rule set* exactly;
 *     the exact checkbox layout is only guaranteed for a clear majority.
 */
function uiStateFromResolved(index: RulesIndex, resolved: Map<string, boolean>, hasSelect: boolean): Tier2State {
  const categorySelected: CategorySelected = new Set();
  const ruleOverrides: RuleOverrides = new Map();

  if (!hasSelect) {
    for (const rule of index.rules) {
      const on = resolved.get(rule.code) ?? rule.enabled;
      if (on !== rule.enabled) ruleOverrides.set(rule.code, on ? "on" : "off");
    }
    return { categorySelected, ruleOverrides };
  }

  for (const category of index.categories) {
    const onCount = category.rules.filter((rule) => resolved.get(rule.code)).length;
    const offCount = category.rules.length - onCount;
    if (onCount > offCount) categorySelected.add(category.key);
  }
  for (const rule of index.rules) {
    const on = resolved.get(rule.code) ?? false;
    const catSelected = categorySelected.has(rule.linter);
    if (on && !catSelected) ruleOverrides.set(rule.code, "on");
    if (!on && catSelected) ruleOverrides.set(rule.code, "off");
  }
  return { categorySelected, ruleOverrides };
}

/**
 * Top-level entry point: a parsed `[tool.ruff.lint]` table (or `undefined`
 * if absent) -> Tier 2 UI state. Absent/empty lint selectors yield fully
 * empty state (nothing to reconcile), matching PLAN.md Phase 7's "stored
 * state stays empty until the user acts" baseline rule.
 */
export function lintToVisual(index: RulesIndex, lint: LintSelectors | undefined): Tier2State {
  if (
    lint === undefined ||
    (lint.select === undefined &&
      lint.ignore === undefined &&
      lint["extend-select"] === undefined &&
      lint["extend-ignore"] === undefined)
  ) {
    return { categorySelected: new Set(), ruleOverrides: new Map() };
  }
  const resolved = resolveEnabled(index, lint);
  return uiStateFromResolved(index, resolved, lint.select !== undefined);
}
