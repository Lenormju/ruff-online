import { linter, lintGutter, setDiagnostics, type Diagnostic as CMDiagnostic } from "@codemirror/lint";
import type { EditorView } from "codemirror";
import type { Diagnostic } from "../engine/workspace";
import { offsetFromRowColumn } from "./position";

/**
 * No automatic linting source (`Check` stays the single explicit trigger for
 * a Ruff run, same as the results list) — `applyLintDiagnostics` pushes
 * diagnostics in externally via `setDiagnostics` after each `Check`.
 */
export const lintExtensions = [linter(() => []), lintGutter()];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function toLintDiagnostics(source: string, diagnostics: Diagnostic[]): CMDiagnostic[] {
  const docLength = source.length;
  return diagnostics.map((diagnostic) => {
    const from = clamp(offsetFromRowColumn(source, diagnostic.start_location.row, diagnostic.start_location.column), 0, docLength);
    let to = clamp(offsetFromRowColumn(source, diagnostic.end_location.row, diagnostic.end_location.column), 0, docLength);
    if (to <= from) to = Math.min(from + 1, docLength);
    return {
      from,
      to,
      severity: "error" as const,
      message: diagnostic.message,
      source: diagnostic.code ?? undefined,
    };
  });
}

export function applyLintDiagnostics(view: EditorView, diagnostics: Diagnostic[]): void {
  const source = view.state.doc.toString();
  view.dispatch(setDiagnostics(view.state, toLintDiagnostics(source, diagnostics)));
}
