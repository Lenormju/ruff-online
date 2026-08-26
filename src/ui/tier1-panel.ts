import type { Tier1Options } from "../config/options";
import { labeled, selectWithOptions, type Panel } from "./form-controls";

const TARGET_VERSIONS = ["py37", "py38", "py39", "py310", "py311", "py312", "py313"];

/** Renders Visual mode's Tier 1 (global) fields: `fix`, `unsafe-fixes`, `preview`, `line-length`, `indent-width`, `target-version`. */
export function createTier1Panel(container: HTMLElement, initial: Tier1Options, onChange: () => void): Panel<Tier1Options> {
  const fix = document.createElement("input");
  fix.type = "checkbox";
  const unsafeFixes = document.createElement("input");
  unsafeFixes.type = "checkbox";
  const preview = document.createElement("input");
  preview.type = "checkbox";
  const lineLength = document.createElement("input");
  lineLength.type = "number";
  lineLength.min = "1";
  const indentWidth = document.createElement("input");
  indentWidth.type = "number";
  indentWidth.min = "1";
  const targetVersion = selectWithOptions("(default)", TARGET_VERSIONS);

  container.replaceChildren(
    labeled("Fix", fix),
    labeled("Unsafe fixes", unsafeFixes),
    labeled("Preview", preview),
    labeled("Line length", lineLength),
    labeled("Indent width", indentWidth),
    labeled("Target version", targetVersion),
  );

  for (const el of [fix, unsafeFixes, preview, lineLength, indentWidth, targetVersion]) {
    el.addEventListener("change", onChange);
  }

  function get(): Tier1Options {
    const result: Tier1Options = {};
    if (fix.checked) result.fix = true;
    if (unsafeFixes.checked) result.unsafeFixes = true;
    if (preview.checked) result.preview = true;
    if (lineLength.value !== "") result.lineLength = Number(lineLength.value);
    if (indentWidth.value !== "") result.indentWidth = Number(indentWidth.value);
    if (targetVersion.value !== "") result.targetVersion = targetVersion.value;
    return result;
  }

  function set(value: Tier1Options): void {
    fix.checked = value.fix === true;
    unsafeFixes.checked = value.unsafeFixes === true;
    preview.checked = value.preview === true;
    lineLength.value = typeof value.lineLength === "number" ? String(value.lineLength) : "";
    indentWidth.value = typeof value.indentWidth === "number" ? String(value.indentWidth) : "";
    targetVersion.value =
      typeof value.targetVersion === "string" && TARGET_VERSIONS.includes(value.targetVersion) ? value.targetVersion : "";
  }

  set(initial);

  return { get, set };
}
