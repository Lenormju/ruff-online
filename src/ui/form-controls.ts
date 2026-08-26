import type { ImportSelectorValue } from "../config/options";

export interface Panel<T> {
  get(): T;
  set(value: T): void;
}

export function labeled(text: string, input: HTMLElement): HTMLLabelElement {
  const label = document.createElement("label");
  label.append(text + " ", input);
  return label;
}

export function selectWithOptions(defaultLabel: string, values: string[]): HTMLSelectElement {
  const select = document.createElement("select");
  select.appendChild(new Option(defaultLabel, ""));
  for (const value of values) select.appendChild(new Option(value, value));
  return select;
}

/** The comma-separated convention every list-shaped Tier 4 field input uses. */
export function splitList(text: string): string[] {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function joinList(values: string[]): string {
  return values.join(", ");
}

export type RecordEditorValueKind = "string" | "stringArray";

export interface RecordEditor {
  element: HTMLElement;
  /** `{}` when every row is empty/removed — callers decide whether that means "unset". */
  get(): Record<string, string> | Record<string, string[]>;
  set(value: Record<string, string> | Record<string, string[]> | undefined): void;
}

/**
 * A repeatable key+value row editor for Tier 4's `record`/`recordArray`
 * fields (e.g. `isort.import-heading`, `flake8-import-conventions.aliases`)
 * — the first dynamic-row widget in this app, since every other form field
 * so far has a fixed identity. `valueKind` controls whether each row's value
 * input is a plain string or a comma-separated list (`splitList`/`joinList`,
 * the same convention `stringArray`-kind fields use).
 */
export function createRecordEditor(valueKind: RecordEditorValueKind, onChange: () => void): RecordEditor {
  const rows = document.createElement("div");
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.textContent = "+ add";
  addButton.addEventListener("click", () => addRow());

  function addRow(key = "", value = "") {
    const keyInput = document.createElement("input");
    keyInput.type = "text";
    keyInput.placeholder = "key";
    keyInput.value = key;
    keyInput.addEventListener("change", onChange);

    const valueInput = document.createElement("input");
    valueInput.type = "text";
    valueInput.placeholder = valueKind === "stringArray" ? "comma-separated" : "value";
    valueInput.value = value;
    valueInput.addEventListener("change", onChange);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "×";

    const row = document.createElement("span");
    row.append(keyInput, valueInput, removeButton);
    removeButton.addEventListener("click", () => {
      row.remove();
      onChange();
    });
    rows.append(row);
  }

  const element = document.createElement("span");
  element.append(rows, addButton);

  function get(): Record<string, string> | Record<string, string[]> {
    const result: Record<string, string | string[]> = {};
    for (const row of Array.from(rows.children)) {
      const inputs = row.querySelectorAll("input");
      const keyInput = inputs[0];
      const valueInput = inputs[1];
      const key = keyInput.value.trim();
      if (key === "") continue;
      result[key] = valueKind === "stringArray" ? splitList(valueInput.value) : valueInput.value;
    }
    return result as Record<string, string> | Record<string, string[]>;
  }

  function set(value: Record<string, string> | Record<string, string[]> | undefined): void {
    rows.replaceChildren();
    if (!value) return;
    for (const [key, entryValue] of Object.entries(value)) {
      addRow(key, valueKind === "stringArray" ? joinList(entryValue as string[]) : (entryValue as string));
    }
  }

  return { element, get, set };
}

export interface ImportSelectorEditor {
  element: HTMLElement;
  get(): ImportSelectorValue;
  set(value: ImportSelectorValue): void;
}

/** A checkbox ("all modules") plus include/exclude list inputs — see `ImportSelectorValue`. */
export function createImportSelectorEditor(onChange: () => void): ImportSelectorEditor {
  const allCheckbox = document.createElement("input");
  allCheckbox.type = "checkbox";
  const includeInput = document.createElement("input");
  includeInput.type = "text";
  includeInput.placeholder = "comma-separated modules";
  const excludeInput = document.createElement("input");
  excludeInput.type = "text";
  excludeInput.placeholder = "comma-separated modules";

  function syncIncludeDisabled() {
    includeInput.disabled = allCheckbox.checked;
  }
  allCheckbox.addEventListener("change", () => {
    syncIncludeDisabled();
    onChange();
  });
  includeInput.addEventListener("change", onChange);
  excludeInput.addEventListener("change", onChange);

  const element = document.createElement("span");
  element.append(labeled("all modules", allCheckbox), labeled("include", includeInput), labeled("except", excludeInput));

  function get(): ImportSelectorValue {
    const exclude = splitList(excludeInput.value);
    const include: "all" | string[] = allCheckbox.checked ? "all" : splitList(includeInput.value);
    return exclude.length > 0 ? { include, exclude } : { include };
  }

  function set(value: ImportSelectorValue): void {
    allCheckbox.checked = value.include === "all";
    includeInput.value = value.include === "all" ? "" : joinList(value.include);
    excludeInput.value = value.exclude ? joinList(value.exclude) : "";
    syncIncludeDisabled();
  }

  set({ include: [] });

  return { element, get, set };
}
