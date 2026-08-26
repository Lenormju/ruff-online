import type { EditorView } from "codemirror";

/** Only ever called from an explicit user action (Apply, mode switch) — never automatically. */
export function replaceContent(view: EditorView, content: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content },
  });
}
