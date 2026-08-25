import { basicSetup, EditorView } from "codemirror";
import { python } from "@codemirror/lang-python";

export function createPythonEditor(parent: HTMLElement, doc: string): EditorView {
  return new EditorView({
    doc,
    extensions: [basicSetup, python()],
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
