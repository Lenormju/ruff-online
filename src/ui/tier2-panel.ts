import type { Tier2Options } from "../config/options";
import { pruneOverrides } from "../config/rule-reconciliation";
import type { Category, Rule, RulesIndex } from "../config/rules-data";
import type { Panel } from "./form-controls";

export interface Tier2Panel extends Panel<Tier2Options> {
  /** Called once the current Ruff version's `rules.json` is loaded, and again on every version change. */
  setRulesIndex(index: RulesIndex): void;
}

/**
 * Renders Visual mode's Tier 2 (rule selection) fields: one `<details>` per
 * category with a "select all" checkbox, and one checkbox per rule inside.
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

  /** The checked state to show for a rule before any override — category selection, else this version's own default. */
  function effectiveOn(rule: Rule): boolean {
    const override = ruleOverrides.get(rule.code);
    if (override !== undefined) return override === "on";
    if (categorySelected.has(rule.linter)) return true;
    return rule.enabled;
  }

  function renderCategory(category: Category): HTMLElement {
    const ruleCheckboxes = new Map<string, HTMLInputElement>();

    const categoryCheckbox = document.createElement("input");
    categoryCheckbox.type = "checkbox";
    categoryCheckbox.checked = categorySelected.has(category.key);
    categoryCheckbox.addEventListener("change", () => {
      if (categoryCheckbox.checked) categorySelected.add(category.key);
      else categorySelected.delete(category.key);
      if (index) pruneOverrides(index, categorySelected, ruleOverrides);
      for (const rule of category.rules) {
        const checkbox = ruleCheckboxes.get(rule.code);
        if (checkbox) checkbox.checked = effectiveOn(rule);
      }
      onChange();
    });

    const summary = document.createElement("summary");
    summary.append(categoryCheckbox, ` ${category.key} (${category.rules.length})`);

    const list = document.createElement("ul");
    for (const rule of category.rules) {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = effectiveOn(rule);
      checkbox.title = rule.summary;
      checkbox.addEventListener("change", () => {
        const baselineOn = categorySelected.has(category.key) ? true : rule.enabled;
        if (checkbox.checked === baselineOn) ruleOverrides.delete(rule.code);
        else ruleOverrides.set(rule.code, checkbox.checked ? "on" : "off");
        onChange();
      });
      ruleCheckboxes.set(rule.code, checkbox);

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
    if (!index) {
      container.replaceChildren();
      return;
    }
    const categories = [...index.categories].sort((a, b) => a.key.localeCompare(b.key));
    container.replaceChildren(...categories.map(renderCategory));
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
