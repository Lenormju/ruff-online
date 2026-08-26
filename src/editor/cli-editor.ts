import { basicSetup, EditorView } from "codemirror";

/** No dedicated language mode — it's a single line of CLI flags, not a language to highlight. */
export function createCliEditor(parent: HTMLElement, doc: string, onChange?: () => void): EditorView {
  return new EditorView({
    doc,
    extensions: [basicSetup, ...(onChange ? [EditorView.updateListener.of((update) => update.docChanged && onChange())] : [])],
    parent,
  });
}
