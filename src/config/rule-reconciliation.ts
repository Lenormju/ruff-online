import { ALL_CATEGORY_KEY, type Rule, type RulesIndex } from "./rules-data";

/** Categories the user explicitly checked "select all" for. Keyed by `Category.key` (the `linter` field, or `ALL_CATEGORY_KEY`). */
export type CategorySelected = Set<string>;

/** Whether `rule` is on because its own category (or the catch-all `ALL_CATEGORY_KEY`) is explicitly selected. */
export function isSelectedByCategory(categorySelected: CategorySelected, rule: Rule): boolean {
  return categorySelected.has(ALL_CATEGORY_KEY) || categorySelected.has(rule.linter);
}

/**
 * Meaningful per-rule deviations only — never the full resolved set.
 * `'off'` = "turn this rule off even though it would otherwise be on"
 * (whether "on" comes from an explicitly selected category, or from Ruff's
 * own per-version default-enabled set). `'on'` is the mirror image.
 */
export type RuleOverrides = Map<string, "on" | "off">;

export interface SelectIgnoreResult {
  select?: string[];
  ignore?: string[];
  /** One-off additions made while no category is selected — see module doc. */
  extendSelect?: string[];
}

/**
 * Turns UI state into the `{select, ignore, extend-select}` Ruff expects.
 *
 * Ruff's `select` REPLACES its own default-enabled set entirely — confirmed
 * empirically (`lint.select = []` disables every rule, including the
 * defaults) — while `ignore`/`extend-select` are always additive on top of
 * whatever's in effect. So:
 *
 *   - A checked category goes into `select` (the user has taken over
 *     selection explicitly; this is expected to replace Ruff's defaults,
 *     same as hand-writing `select` in TOML).
 *   - A one-off `'on'` override, when at least one category is already
 *     selected, is folded into that same `select` list (it's just extending
 *     an already-explicit list).
 *   - A one-off `'on'` override, when NO category is selected at all, MUST
 *     go into `extend-select` instead — using `select` here would silently
 *     wipe out Ruff's real defaults for every other rule.
 *   - `'off'` overrides always go into plain `ignore`, which subtracts from
 *     whatever's in effect (defaults or a custom `select`) either way.
 *
 * Returns `{}` (no keys at all) when nothing has been touched, so Ruff's own
 * defaults apply untouched — the "baseline" state from PLAN.md Phase 7.
 */
export function toSelectIgnore(
  index: RulesIndex,
  categorySelected: CategorySelected,
  ruleOverrides: RuleOverrides,
): SelectIgnoreResult {
  const categoryByKey = new Map(index.categories.map((category) => [category.key, category]));
  const hasCategorySelection = categorySelected.size > 0;

  const select = [...categorySelected].flatMap((key) => categoryByKey.get(key)?.prefixes ?? []);
  const ignore: string[] = [];
  const extendSelect: string[] = [];

  for (const [code, state] of ruleOverrides) {
    const rule = index.byCode.get(code);
    if (!rule) continue; // stale override for a code absent from this Ruff version's rules.json

    const baselineOn = isSelectedByCategory(categorySelected, rule) ? true : rule.enabled;
    if (state === "off" && baselineOn) {
      ignore.push(code);
    } else if (state === "on" && !baselineOn) {
      if (hasCategorySelection) select.push(code);
      else extendSelect.push(code);
    }
    // else: override is redundant given current category/baseline state; a
    // caller that calls pruneOverrides on every category toggle shouldn't
    // hit this, but skip defensively rather than emit a no-op selector.
  }

  const result: SelectIgnoreResult = {};
  if (select.length > 0) result.select = select.sort();
  if (ignore.length > 0) result.ignore = ignore.sort();
  if (extendSelect.length > 0) result.extendSelect = extendSelect.sort();
  return result;
}

/**
 * Drops overrides that are no longer meaningful given the current
 * `categorySelected` (e.g. an `'off'` carve-out left behind after its
 * category got unchecked and the rule isn't enabled by default either).
 * Call this whenever `categorySelected` changes.
 */
export function pruneOverrides(index: RulesIndex, categorySelected: CategorySelected, ruleOverrides: RuleOverrides): void {
  for (const [code, state] of [...ruleOverrides]) {
    const rule = index.byCode.get(code);
    if (!rule) {
      ruleOverrides.delete(code); // code doesn't exist in this version's rules.json anymore
      continue;
    }
    const baselineOn = isSelectedByCategory(categorySelected, rule) ? true : rule.enabled;
    const stillMeaningful = (state === "off" && baselineOn) || (state === "on" && !baselineOn);
    if (!stillMeaningful) ruleOverrides.delete(code);
  }
}
