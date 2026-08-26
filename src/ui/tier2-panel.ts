import {
  applyCategoryPhase,
  categoryPhase,
  cycleOverride,
  isRuleEffectivelyOn,
  isSelectedByCategory,
  nextCategoryPhase,
  pruneStaleOverrides,
  type CategoryPhase,
} from "../config/rule-reconciliation";
import type { Tier2Options } from "../config/options";
import { ALL_CATEGORY_KEY, type Category, type Rule, type RulesIndex } from "../config/rules-data";
import type { Panel } from "./form-controls";

export interface Tier2Panel extends Panel<Tier2Options> {
  /** Called once the current Ruff version's `rules.json` is loaded, and again on every version change. */
  setRulesIndex(index: RulesIndex): void;
}

/** A category header's phase-derived tooltip text. */
function phaseLabel(phase: CategoryPhase, onCount: number, total: number): string {
  if (phase === "selected") return "selected";
  if (phase === "deselected") return "deselected";
  if (onCount === total) return "default (selected)";
  if (onCount === 0) return "default (deselected)";
  return "partially selected (default)";
}

/**
 * Renders Visual mode's Tier 2 (rule selection) fields: a standalone `ALL`
 * toggle (Ruff's own catch-all selector — see `rules-data.ts`) above one
 * `<details>` per real category, each with its own "select all" checkbox
 * and one checkbox per rule inside.
 *
 * Unlike Tier 1/3, this panel's contents are version-dependent — it starts
 * empty and only has anything to render once `setRulesIndex` is called
 * (main.ts does this as soon as the current Ruff version's `rules.json` has
 * loaded, and again on every version change).
 */
export function createTier2Panel(container: HTMLElement, initial: Tier2Options, onChange: () => void): Tier2Panel {
  let index: RulesIndex | null = null;
  let categorySelected = new Set(initial.categorySelected);
  let ruleOverrides = new Map(initial.ruleOverrides);

  // Populated fresh on every render() — every rule checkbox by code, and
  // every category's (checkbox, countLabel, category) triple, so a change
  // to one category or to the top-level ALL toggle can refresh every other
  // header/checkbox it affects without a full re-render (which would also
  // collapse any <details> the user had open).
  let ruleCheckboxesByCode = new Map<string, HTMLInputElement>();
  let categoryHeaders: Array<{ checkbox: HTMLInputElement; countLabel: HTMLElement; summary: HTMLElement; category: Category }> = [];
  let allHeader: { checkbox: HTMLInputElement; countLabel: HTMLElement; row: HTMLElement } | null = null;

  /** The checked state to show for a rule before any override — category (or ALL) selection, else this version's own default. */
  function effectiveOn(rule: Rule): boolean {
    return isRuleEffectivelyOn(categorySelected, ruleOverrides, rule);
  }

  /**
   * Updates a header's checkbox checked/indeterminate state (fully checked,
   * fully unchecked, or a native tri-state "partial" dash — a genuine
   * "children disagree" signal, since a category has more than one rule
   * under it) and its "N/total selected" count label, both from how many of
   * `rules` are currently effectively on. Used for both real categories and
   * the top-level ALL toggle (whose `rules` is the entire rule set).
   */
  function updateHeader(checkbox: HTMLInputElement, countLabel: HTMLElement, container: HTMLElement, category: Category): void {
    const rules = category.rules;
    const onCount = rules.filter(effectiveOn).length;
    checkbox.checked = onCount === rules.length;
    checkbox.indeterminate = onCount > 0 && onCount < rules.length;
    countLabel.textContent = `(${onCount}/${rules.length})`;

    const phase = categoryPhase(category, categorySelected, ruleOverrides);
    container.title = phaseLabel(phase, onCount, rules.length);
    // Highlight only an explicit bulk choice (phase selected/deselected) —
    // "default" is the normal, untouched look, whether it happens to
    // resolve full/none/partial; see `refreshAll`'s rule loop for why a
    // single rule never uses `indeterminate` for this same distinction.
    container.classList.toggle("tier2-explicit", phase !== "default");
  }

  /** Refreshes every rendered header/checkbox after any state change, wherever it originated. */
  function refreshAll(): void {
    for (const [code, checkbox] of ruleCheckboxesByCode) {
      const rule = index?.byCode.get(code);
      if (rule) {
        const override = ruleOverrides.get(code);
        // Always a plain checked/unchecked value, reflecting what's actually
        // effective — never `indeterminate`. A single rule isn't "partial"
        // the way a category with several children can be; reusing that
        // same dash for "not explicitly set" would visually conflate two
        // different concepts. "default" is the normal look; an explicit
        // choice gets highlighted instead (see the `tier2-explicit` class).
        checkbox.indeterminate = false;
        checkbox.checked = override === undefined ? effectiveOn(rule) : override === "on";
        checkbox.title = override === undefined ? `default — currently ${checkbox.checked ? "on" : "off"}` : `explicitly ${override}`;
        checkbox.closest("label")?.classList.toggle("tier2-explicit", override !== undefined);
      }
    }
    for (const { checkbox, countLabel, summary, category } of categoryHeaders) {
      updateHeader(checkbox, countLabel, summary, category);
    }
    if (allHeader && index) {
      const allCategory: Category = { key: ALL_CATEGORY_KEY, rules: index.rules, prefixes: [ALL_CATEGORY_KEY] };
      updateHeader(allHeader.checkbox, allHeader.countLabel, allHeader.row, allCategory);
    }
  }

  /**
   * Wires a category header checkbox (real category, or the synthetic ALL
   * one) to the shared bulk-action cycle. Uses `change`, not `click`, and
   * ignores the checkbox's own post-click `checked`/`indeterminate` (native
   * behavior always lands on `checked = true` from indeterminate, which we
   * don't want) — `refreshAll()` overwrites it with our own computed state
   * afterwards. A `click` handler with `preventDefault()` would look
   * equivalent but isn't: canceling a checkbox's click rolls its
   * checked/indeterminate back to their pre-click values *after* every click
   * listener has already run, silently undoing anything we set from inside
   * one.
   */
  function attachCategoryToggle(checkbox: HTMLInputElement, category: Category): void {
    checkbox.addEventListener("change", () => {
      const phase = categoryPhase(category, categorySelected, ruleOverrides);
      applyCategoryPhase(category, nextCategoryPhase(phase), categorySelected, ruleOverrides);
      refreshAll();
      onChange();
    });
  }

  function renderAllToggle(rules: Rule[]): HTMLElement {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    const countLabel = document.createElement("span");
    const allCategory: Category = { key: ALL_CATEGORY_KEY, rules, prefixes: [ALL_CATEGORY_KEY] };
    attachCategoryToggle(checkbox, allCategory);

    const label = document.createElement("label");
    label.append(checkbox, ` ${ALL_CATEGORY_KEY} — every rule `, countLabel);
    const row = document.createElement("p");
    row.append(label);
    allHeader = { checkbox, countLabel, row };
    return row;
  }

  function renderCategory(category: Category): HTMLElement {
    const categoryCheckbox = document.createElement("input");
    categoryCheckbox.type = "checkbox";
    const countLabel = document.createElement("span");
    attachCategoryToggle(categoryCheckbox, category);

    const summary = document.createElement("summary");
    summary.append(categoryCheckbox, ` ${category.prefixes.join("/")} — ${category.key} `, countLabel);
    categoryHeaders.push({ checkbox: categoryCheckbox, countLabel, summary, category });

    const list = document.createElement("ul");
    for (const rule of category.rules) {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.addEventListener("change", () => {
        // See `attachCategoryToggle`'s doc comment: `change`, not `click`
        // with `preventDefault()`, for the same reason.
        const baselineOn = isSelectedByCategory(categorySelected, rule) ? true : rule.enabled;
        const next = cycleOverride(ruleOverrides.get(rule.code), baselineOn);
        if (next === undefined) ruleOverrides.delete(rule.code);
        else ruleOverrides.set(rule.code, next);
        refreshAll();
        onChange();
      });
      ruleCheckboxesByCode.set(rule.code, checkbox);

      const label = document.createElement("label");
      label.title = rule.summary;
      label.append(checkbox, ` ${rule.code} — ${rule.name}`);
      const item = document.createElement("li");
      item.append(label);
      list.append(item);
    }

    const details = document.createElement("details");
    details.append(summary, list);
    return details;
  }

  function render(): void {
    ruleCheckboxesByCode = new Map();
    categoryHeaders = [];
    allHeader = null;

    if (!index) {
      container.replaceChildren();
      return;
    }
    const realCategories = index.categories
      .filter((category) => category.key !== ALL_CATEGORY_KEY)
      .sort((a, b) => a.key.localeCompare(b.key));
    container.replaceChildren(renderAllToggle(index.rules), ...realCategories.map(renderCategory));
    refreshAll();
  }

  function get(): Tier2Options {
    return { categorySelected: [...categorySelected], ruleOverrides: [...ruleOverrides] };
  }

  function set(value: Tier2Options): void {
    categorySelected = new Set(value.categorySelected);
    ruleOverrides = new Map(value.ruleOverrides);
    render();
  }

  function setRulesIndex(newIndex: RulesIndex): void {
    index = newIndex;
    pruneStaleOverrides(index, ruleOverrides);
    render();
  }

  render();

  return { get, set, setRulesIndex };
}
