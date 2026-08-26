import { basicSetup, EditorView } from "codemirror";
import { python } from "@codemirror/lang-python";

export function createPythonEditor(parent: HTMLElement, doc: string, onChange?: () => void): EditorView {
  return new EditorView({
    doc,
    extensions: [
      basicSetup,
      python(),
      ...(onChange ? [EditorView.updateListener.of((update) => update.docChanged && onChange())] : []),
    ],
    parent,
  });
}

export function jumpToOffset(view: EditorView, offset: number): void {
  view.dispatch({
    selection: { anchor: offset },
    scrollIntoView: true,
  });
  view.focus();
}

/** Only ever called from an explicit user action (the Apply button) — never automatically. */
export function replaceContent(view: EditorView, content: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content },
  });
}
