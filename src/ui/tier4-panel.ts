import type { ImportSelectorValue, Tier2Options, Tier4Options, Tier4Value } from "../config/options";
import { isRuleEffectivelyOn } from "../config/rule-reconciliation";
import type { RulesIndex } from "../config/rules-data";
import { TIER4_SCHEMA, type Tier4FieldSpec } from "../config/tier4-schema";
import { createImportSelectorEditor, createRecordEditor, joinList, labeled, selectWithOptions, splitList } from "./form-controls";

export interface Tier4Panel {
  get(): Tier4Options;
  set(value: Tier4Options): void;
  /** Shows/hides each plugin's `<details>` — a plugin appears once any rule in its Tier 2 category is effectively on. Call whenever Tier 2 state or `rulesIndex` changes. */
  refreshVisibility(rulesIndex: RulesIndex | null, tier2: Tier2Options): void;
}

interface FieldControl {
  /** `undefined` means "unset" — nothing typed/checked for this field. */
  get(): Tier4Value | undefined;
  set(value: Tier4Value | undefined): void;
}

/** One `<label>`-wrapped input per `Tier4FieldKind`, uniformly returning `undefined` for "nothing entered" so empty fields don't pollute `Tier4Options`. */
function createFieldControl(spec: Tier4FieldSpec, onChange: () => void): { element: HTMLElement; control: FieldControl } {
  switch (spec.kind) {
    case "boolean": {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.addEventListener("change", onChange);
      return {
        element: labeled(spec.label, input),
        control: {
          get: () => (input.checked ? true : undefined),
          set: (value) => {
            input.checked = value === true;
          },
        },
      };
    }
    case "integer": {
      const input = document.createElement("input");
      input.type = "number";
      input.step = "1";
      input.addEventListener("change", onChange);
      return {
        element: labeled(spec.label, input),
        control: {
          get: () => (input.value === "" ? undefined : Number(input.value)),
          set: (value) => {
            input.value = typeof value === "number" ? String(value) : "";
          },
        },
      };
    }
    case "string": {
      const input = document.createElement("input");
      input.type = "text";
      input.addEventListener("change", onChange);
      return {
        element: labeled(spec.label, input),
        control: {
          get: () => (input.value === "" ? undefined : input.value),
          set: (value) => {
            input.value = typeof value === "string" ? value : "";
          },
        },
      };
    }
    case "enum": {
      const select = selectWithOptions("(default)", spec.enumValues ?? []);
      select.addEventListener("change", onChange);
      return {
        element: labeled(spec.label, select),
        control: {
          get: () => (select.value === "" ? undefined : select.value),
          set: (value) => {
            select.value = typeof value === "string" ? value : "";
          },
        },
      };
    }
    case "stringArray": {
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "comma-separated";
      input.addEventListener("change", onChange);
      return {
        element: labeled(spec.label, input),
        control: {
          get: () => {
            const values = splitList(input.value);
            return values.length > 0 ? values : undefined;
          },
          set: (value) => {
            input.value = Array.isArray(value) ? joinList(value) : "";
          },
        },
      };
    }
    case "record":
    case "recordArray": {
      const editor = createRecordEditor(spec.kind === "recordArray" ? "stringArray" : "string", onChange);
      return {
        element: labeled(spec.label, editor.element),
        control: {
          get: () => {
            const value = editor.get();
            return Object.keys(value).length > 0 ? value : undefined;
          },
          set: (value) => editor.set(value as Record<string, string> | Record<string, string[]> | undefined),
        },
      };
    }
    case "importSelector": {
      const editor = createImportSelectorEditor(onChange);
      return {
        element: labeled(spec.label, editor.element),
        control: {
          get: () => {
            const value = editor.get();
            const includeEmpty = Array.isArray(value.include) && value.include.length === 0;
            const excludeEmpty = !value.exclude || value.exclude.length === 0;
            return includeEmpty && excludeEmpty ? undefined : value;
          },
          set: (value) => editor.set((value as ImportSelectorValue | undefined) ?? { include: [] }),
        },
      };
    }
  }
}

/**
 * Renders Visual mode's Tier 4 (plugin fine-tuning) fields — one generic
 * panel driven entirely by `TIER4_SCHEMA`, not one file per plugin (see
 * PLAN.md's Phase 9 section). Every plugin's `<details>` is always rendered
 * so a typed value survives a category being temporarily disabled — only
 * visibility (the `hidden` attribute) is toggled, via `refreshVisibility`.
 */
export function createTier4Panel(container: HTMLElement, initial: Tier4Options, onChange: () => void): Tier4Panel {
  const pluginDetails = new Map<string, HTMLDetailsElement>();
  const pluginSummaries = new Map<string, HTMLElement>();
  const fieldControls = new Map<string, Map<string, FieldControl>>();

  for (const plugin of TIER4_SCHEMA) {
    const summary = document.createElement("summary");
    summary.textContent = plugin.label;

    const controls = new Map<string, FieldControl>();
    const details = document.createElement("details");
    details.hidden = true;
    details.append(summary);
    for (const field of plugin.fields) {
      const { element, control } = createFieldControl(field, onChange);
      details.append(element);
      controls.set(field.key, control);
    }

    fieldControls.set(plugin.key, controls);
    pluginDetails.set(plugin.key, details);
    pluginSummaries.set(plugin.key, summary);
    container.append(details);
  }

  function get(): Tier4Options {
    const result: Tier4Options = {};
    for (const plugin of TIER4_SCHEMA) {
      const controls = fieldControls.get(plugin.key);
      if (!controls) continue;
      const fields: Record<string, Tier4Value> = {};
      for (const field of plugin.fields) {
        const value = controls.get(field.key)?.get();
        if (value !== undefined) fields[field.key] = value;
      }
      if (Object.keys(fields).length > 0) result[plugin.key] = fields;
    }
    return result;
  }

  function set(value: Tier4Options): void {
    for (const plugin of TIER4_SCHEMA) {
      const controls = fieldControls.get(plugin.key);
      if (!controls) continue;
      const fields = value[plugin.key] ?? {};
      for (const field of plugin.fields) {
        controls.get(field.key)?.set(fields[field.key]);
      }
    }
  }

  function refreshVisibility(rulesIndex: RulesIndex | null, tier2: Tier2Options): void {
    if (!rulesIndex) {
      for (const plugin of TIER4_SCHEMA) {
        const details = pluginDetails.get(plugin.key);
        const summary = pluginSummaries.get(plugin.key);
        if (details) details.hidden = true;
        if (summary) summary.textContent = plugin.label;
      }
      return;
    }
    const categorySelected = new Set(tier2.categorySelected);
    const ruleOverrides = new Map(tier2.ruleOverrides);
    const categoryByKey = new Map(rulesIndex.categories.map((category) => [category.key, category]));
    for (const plugin of TIER4_SCHEMA) {
      const category = categoryByKey.get(plugin.categoryKey);
      const details = pluginDetails.get(plugin.key);
      const summary = pluginSummaries.get(plugin.key);
      if (!details || !summary) continue;
      details.hidden = !category || !category.rules.some((rule) => isRuleEffectivelyOn(categorySelected, ruleOverrides, rule));
      summary.textContent = category ? `${category.prefixes.join("/")} — ${plugin.label}` : plugin.label;
    }
  }

  set(initial);

  return { get, set, refreshVisibility };
}
