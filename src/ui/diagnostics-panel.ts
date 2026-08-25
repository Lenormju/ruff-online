import type { EditorView } from "codemirror";
import type { Diagnostic } from "../engine/workspace";
import { offsetFromRowColumn } from "../editor/position";
import { jumpToOffset } from "../editor/python-editor";

export function formatDiagnostic(diagnostic: Diagnostic): string {
  const { row, column } = diagnostic.start_location;
  const code = diagnostic.code ?? "?";
  return `${code} — ${diagnostic.message} (${row}:${column})`;
}

export function renderDiagnostics(
  container: HTMLElement,
  diagnostics: Diagnostic[],
  editor: EditorView,
): void {
  container.replaceChildren();
  if (diagnostics.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No issues found.";
    container.append(item);
    return;
  }
  for (const diagnostic of diagnostics) {
    const item = document.createElement("li");
    item.textContent = formatDiagnostic(diagnostic);
    item.classList.add("diagnostic");
    item.addEventListener("click", () => {
      const offset = offsetFromRowColumn(
        editor.state.doc.toString(),
        diagnostic.start_location.row,
        diagnostic.start_location.column,
      );
      jumpToOffset(editor, offset);
    });
    container.append(item);
  }
}
