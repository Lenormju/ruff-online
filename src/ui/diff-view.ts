import { EditorView } from "codemirror";
import { EditorState } from "@codemirror/state";
import { python } from "@codemirror/lang-python";
import { unifiedMergeView } from "@codemirror/merge";

/**
 * Builds a read-only preview editor showing `after` with `before` diffed in
 * via `@codemirror/merge` — a throwaway instance, never the live Python
 * input editor, so the real input is never touched by showing a diff.
 * Caller owns the returned view's lifecycle (destroy it before the next call).
 */
export function renderDiff(
  container: HTMLElement,
  before: string,
  after: string,
  collapseUnchanged: boolean,
): EditorView {
  container.replaceChildren();
  return new EditorView({
    doc: after,
    extensions: [
      python(),
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
      unifiedMergeView({
        original: before,
        // A single explicit Apply button (all-or-nothing) is this app's
        // consent model — per-chunk accept/reject buttons would suggest a
        // second, redundant way to edit that isn't wired to anything real.
        mergeControls: false,
        collapseUnchanged: collapseUnchanged ? {} : undefined,
      }),
    ],
    parent: container,
  });
}
