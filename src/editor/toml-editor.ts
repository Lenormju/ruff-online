import { basicSetup, EditorView } from "codemirror";
import { StreamLanguage } from "@codemirror/language";
import { toml } from "@codemirror/legacy-modes/mode/toml";

/**
 * There is no official `@codemirror/lang-toml`, so TOML highlighting comes from
 * the ported CodeMirror 5 stream mode in `@codemirror/legacy-modes`.
 */
export function createTomlEditor(parent: HTMLElement, doc: string, onChange?: () => void): EditorView {
  return new EditorView({
    doc,
    extensions: [
      basicSetup,
      StreamLanguage.define(toml),
      ...(onChange ? [EditorView.updateListener.of((update) => update.docChanged && onChange())] : []),
    ],
    parent,
  });
}
