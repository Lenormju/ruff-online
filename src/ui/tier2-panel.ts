import { isSelectedByCategory, pruneOverrides } from "../config/rule-reconciliation";
import type { Tier2Options } from "../config/options";
import { ALL_CATEGORY_KEY, type Category, type Rule, type RulesIndex } from "../config/rules-data";
import type { Panel } from "./form-controls";

export interface Tier2Panel extends Panel<Tier2Options> {
  /** Called once the current Ruff version's `rules.json` is loaded, and again on every version change. */
  setRulesIndex(index: RulesIndex): void;
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
  let categoryHeaders: Array<{ checkbox: HTMLInputElement; countLabel: HTMLElement; category: Category }> = [];
  let allHeader: { checkbox: HTMLInputElement; countLabel: HTMLElement } | null = null;

  /** The checked state to show for a rule before any override — category (or ALL) selection, else this version's own default. */
  function effectiveOn(rule: Rule): boolean {
    const override = ruleOverrides.get(rule.code);
    if (override !== undefined) return override === "on";
    if (isSelectedByCategory(categorySelected, rule)) return true;
    return rule.enabled;
  }

  /**
   * Updates a header's checkbox checked/indeterminate state (fully checked,
   * fully unchecked, or a native tri-state "partial" dash) and its
   * "N/total selected" count label, both from how many of `rules` are
   * currently effectively on. Used for both real categories and the
   * top-level ALL toggle (whose `rules` is the entire rule set).
   */
  function updateHeader(checkbox: HTMLInputElement, countLabel: HTMLElement, rules: Rule[]): void {
    const onCount = rules.filter(effectiveOn).length;
    checkbox.checked = onCount === rules.length;
    checkbox.indeterminate = onCount > 0 && onCount < rules.length;
    countLabel.textContent = `(${onCount}/${rules.length})`;
  }

  /** Refreshes every rendered header/checkbox after any state change, wherever it originated. */
  function refreshAll(): void {
    for (const [code, checkbox] of ruleCheckboxesByCode) {
      const rule = index?.byCode.get(code);
      if (rule) checkbox.checked = effectiveOn(rule);
    }
    for (const { checkbox, countLabel, category } of categoryHeaders) {
      updateHeader(checkbox, countLabel, category.rules);
    }
    if (allHeader && index) updateHeader(allHeader.checkbox, allHeader.countLabel, index.rules);
  }

  function renderAllToggle(rules: Rule[]): HTMLElement {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    const countLabel = document.createElement("span");
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) categorySelected.add(ALL_CATEGORY_KEY);
      else categorySelected.delete(ALL_CATEGORY_KEY);
      if (index) pruneOverrides(index, categorySelected, ruleOverrides);
      refreshAll();
      onChange();
    });
    allHeader = { checkbox, countLabel };

    const label = document.createElement("label");
    label.append(checkbox, ` ${ALL_CATEGORY_KEY} — every rule `, countLabel);
    const row = document.createElement("p");
    row.append(label);
    updateHeader(checkbox, countLabel, rules);
    return row;
  }

  function renderCategory(category: Category): HTMLElement {
    const categoryCheckbox = document.createElement("input");
    categoryCheckbox.type = "checkbox";
    const countLabel = document.createElement("span");
    categoryCheckbox.addEventListener("change", () => {
      // Clicking a partial (indeterminate) checkbox always lands on checked=true
      // (native browser behavior) — i.e. "select the rest of this category".
      if (categoryCheckbox.checked) categorySelected.add(category.key);
      else categorySelected.delete(category.key);
      if (index) pruneOverrides(index, categorySelected, ruleOverrides);
      refreshAll();
      onChange();
    });
    categoryHeaders.push({ checkbox: categoryCheckbox, countLabel, category });

    const summary = document.createElement("summary");
    summary.append(categoryCheckbox, ` ${category.prefixes.join("/")} — ${category.key} `, countLabel);
    updateHeader(categoryCheckbox, countLabel, category.rules);

    const list = document.createElement("ul");
    for (const rule of category.rules) {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = effectiveOn(rule);
      checkbox.title = rule.summary;
      checkbox.addEventListener("change", () => {
        const baselineOn = isSelectedByCategory(categorySelected, rule) ? true : rule.enabled;
        if (checkbox.checked === baselineOn) ruleOverrides.delete(rule.code);
        else ruleOverrides.set(rule.code, checkbox.checked ? "on" : "off");
        refreshAll();
        onChange();
      });
      ruleCheckboxesByCode.set(rule.code, checkbox);

      const label = document.createElement("label");
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
    render();
  }

  render();

  return { get, set, setRulesIndex };
}
