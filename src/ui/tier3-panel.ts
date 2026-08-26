import type { Tier3Options } from "../config/options";
import { labeled, selectWithOptions, type Panel } from "./form-controls";

const INDENT_STYLES = ["tab", "space"];
const QUOTE_STYLES = ["double", "single", "preserve"];
const LINE_ENDINGS = ["auto", "lf", "cr-lf", "native"];

/** Renders Visual mode's Tier 3 (format) fields, `[tool.ruff.format]`. */
export function createTier3Panel(container: HTMLElement, initial: Tier3Options, onChange: () => void): Panel<Tier3Options> {
  const indentStyle = selectWithOptions("(default)", INDENT_STYLES);
  const quoteStyle = selectWithOptions("(default)", QUOTE_STYLES);
  const lineEnding = selectWithOptions("(default)", LINE_ENDINGS);
  const skipMagicTrailingComma = document.createElement("input");
  skipMagicTrailingComma.type = "checkbox";
  const docstringCodeFormat = document.createElement("input");
  docstringCodeFormat.type = "checkbox";
  const preview = document.createElement("input");
  preview.type = "checkbox";

  container.replaceChildren(
    labeled("Indent style", indentStyle),
    labeled("Quote style", quoteStyle),
    labeled("Line ending", lineEnding),
    labeled("Skip magic trailing comma", skipMagicTrailingComma),
    labeled("Format code in docstrings", docstringCodeFormat),
    labeled("Preview", preview),
  );

  for (const el of [indentStyle, quoteStyle, lineEnding, skipMagicTrailingComma, docstringCodeFormat, preview]) {
    el.addEventListener("change", onChange);
  }

  function get(): Tier3Options {
    const result: Tier3Options = {};
    if (indentStyle.value !== "") result.indentStyle = indentStyle.value;
    if (quoteStyle.value !== "") result.quoteStyle = quoteStyle.value;
    if (lineEnding.value !== "") result.lineEnding = lineEnding.value;
    if (skipMagicTrailingComma.checked) result.skipMagicTrailingComma = true;
    if (docstringCodeFormat.checked) result.docstringCodeFormat = true;
    if (preview.checked) result.preview = true;
    return result;
  }

  function set(value: Tier3Options): void {
    indentStyle.value = typeof value.indentStyle === "string" && INDENT_STYLES.includes(value.indentStyle) ? value.indentStyle : "";
    quoteStyle.value = typeof value.quoteStyle === "string" && QUOTE_STYLES.includes(value.quoteStyle) ? value.quoteStyle : "";
    lineEnding.value = typeof value.lineEnding === "string" && LINE_ENDINGS.includes(value.lineEnding) ? value.lineEnding : "";
    skipMagicTrailingComma.checked = value.skipMagicTrailingComma === true;
    docstringCodeFormat.checked = value.docstringCodeFormat === true;
    preview.checked = value.preview === true;
  }

  set(initial);

  return { get, set };
}
