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
