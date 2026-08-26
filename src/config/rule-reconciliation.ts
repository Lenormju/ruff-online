import { ALL_CATEGORY_KEY, type Category, type Rule, type RulesIndex } from "./rules-data";

/** Categories the user explicitly checked "select all" for. Keyed by `Category.key` (the `linter` field, or `ALL_CATEGORY_KEY`). */
export type CategorySelected = Set<string>;

/** Whether `rule` is on because its own category (or the catch-all `ALL_CATEGORY_KEY`) is explicitly selected. */
export function isSelectedByCategory(categorySelected: CategorySelected, rule: Rule): boolean {
  return categorySelected.has(ALL_CATEGORY_KEY) || categorySelected.has(rule.linter);
}

/**
 * Whether `rule` is effectively on right now: an explicit per-rule override
 * wins, else category selection, else this version's own default. Shared by
 * `tier2-panel.ts` (per-rule checkbox state) and Tier 4's progressive
 * disclosure (a plugin panel shows once any rule in its category is on).
 */
export function isRuleEffectivelyOn(categorySelected: CategorySelected, ruleOverrides: RuleOverrides, rule: Rule): boolean {
  const override = ruleOverrides.get(rule.code);
  if (override !== undefined) return override === "on";
  return isSelectedByCategory(categorySelected, rule) || rule.enabled;
}

/**
 * An explicit per-rule choice, distinct from the category/default baseline.
 * `'off'` = "turn this rule off even though it would otherwise be on"
 * (whether "on" comes from an explicitly selected category, or from Ruff's
 * own per-version default-enabled set). `'on'` is the mirror image.
 *
 * Kept until something explicit changes it again — the rule's own control
 * cycling past it back to "default" (`tier2-panel.ts`'s `cycleOverride`), or
 * its category's bulk select/deselect action overwriting it
 * (`applyCategoryPhase`) — never silently dropped just because it currently
 * happens to match the baseline (e.g. a category selection elsewhere, or a
 * version switch, shifting what the baseline resolves to).
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
    // else: override is redundant given current category/baseline state
    // right now (e.g. a pinned 'on' rule inside a category already
    // selecting it) — contributes nothing to this call's output, but stays
    // in `ruleOverrides` so it's picked up correctly if the baseline later
    // changes (see `RuleOverrides`' doc comment).
  }

  const result: SelectIgnoreResult = {};
  if (select.length > 0) result.select = select.sort();
  if (ignore.length > 0) result.ignore = ignore.sort();
  if (extendSelect.length > 0) result.extendSelect = extendSelect.sort();
  return result;
}

/**
 * Drops overrides for rule codes that no longer exist in this version's
 * `rules.json` (e.g. after switching Ruff versions). Overrides are
 * otherwise never auto-dropped just for currently matching the baseline —
 * see `RuleOverrides`' doc comment — so this is the only cleanup left; call
 * it whenever `rulesIndex` changes.
 */
export function pruneStaleOverrides(index: RulesIndex, ruleOverrides: RuleOverrides): void {
  for (const code of [...ruleOverrides.keys()]) {
    if (!index.byCode.has(code)) ruleOverrides.delete(code);
  }
}

/**
 * Advances one rule's override through its 3-state cycle on a single click:
 * `default -> flipped -> matching -> default -> ...`, where "flipped"/
 * "matching" are relative to `baselineOn` (recomputed by the caller on every
 * click, since it can shift between clicks — e.g. the rule's category was
 * toggled in between). Deliberately baseline-*relative* rather than a fixed
 * `"on" -> "off" -> default` order: a fixed order would mean the first click
 * out of "default" on an already-default-on rule does nothing visible (it'd
 * just get silently pinned while staying checked) — confusing, and exactly
 * the "can't disable it" symptom this whole cycle exists to fix. This way
 * the first click out of "default" always flips what's actually shown.
 */
export function cycleOverride(current: "on" | "off" | undefined, baselineOn: boolean): "on" | "off" | undefined {
  const flipped = baselineOn ? "off" : "on";
  const matching = baselineOn ? "on" : "off";
  if (current === undefined) return flipped;
  if (current === flipped) return matching;
  return undefined;
}

/**
 * A category header's own 3-state cycle, mirroring `cycleOverride` in shape
 * but applied in bulk to every rule in the category (see
 * `applyCategoryPhase`). `"default"` covers both "genuinely untouched" and
 * any partial/mixed state that doesn't exactly match a prior bulk action —
 * the same "land on selected first" convention a native indeterminate
 * checkbox uses.
 */
export type CategoryPhase = "selected" | "deselected" | "default";

/** The category's current phase, derived from state — never itself stored. */
export function categoryPhase(category: Category, categorySelected: CategorySelected, ruleOverrides: RuleOverrides): CategoryPhase {
  if (categorySelected.has(category.key)) return "selected";
  if (category.rules.every((rule) => ruleOverrides.get(rule.code) === "off")) return "deselected";
  return "default";
}

export function nextCategoryPhase(phase: CategoryPhase): CategoryPhase {
  if (phase === "default") return "selected";
  if (phase === "selected") return "deselected";
  return "default";
}

/**
 * Bulk-applies `phase` to every rule in `category`, "as if the user had
 * clicked each one individually" — which is what makes unchecking a
 * category that's coincidentally all-on by default actually work (it
 * writes a real `'off'` to every rule, rather than only ever touching
 * `categorySelected`), and what lets a category's bulk action supersede any
 * prior one-off choice on a rule inside it.
 */
export function applyCategoryPhase(
  category: Category,
  phase: CategoryPhase,
  categorySelected: CategorySelected,
  ruleOverrides: RuleOverrides,
): void {
  if (phase === "selected") {
    categorySelected.add(category.key);
    for (const rule of category.rules) ruleOverrides.set(rule.code, "on");
  } else if (phase === "deselected") {
    categorySelected.delete(category.key);
    for (const rule of category.rules) ruleOverrides.set(rule.code, "off");
  } else {
    categorySelected.delete(category.key);
    for (const rule of category.rules) ruleOverrides.delete(rule.code);
  }
}
