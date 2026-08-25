/**
 * Converts a Ruff diagnostic's 1-based row and 1-based column (UTF-16 code
 * units, since the Workspace is constructed with PositionEncoding.Utf16)
 * into an absolute character offset into `source`, using plain JS string
 * indexing so it stays aligned with CodeMirror's own UTF-16-based offsets.
 */
export function offsetFromRowColumn(source: string, row: number, column: number): number {
  let lineStart = 0;
  for (let currentRow = 1; currentRow < row; currentRow++) {
    const newlineIndex = source.indexOf("\n", lineStart);
    lineStart = newlineIndex + 1;
  }
  return lineStart + column - 1;
}
