import { describe, expect, test } from "vitest";
import { offsetFromRowColumn } from "../src/editor/position";

describe("offsetFromRowColumn", () => {
  test("finds offset on the first line (1-based row and column, like Ruff)", () => {
    // "import os" -> F401 on `os`, Ruff reports (1:8), pointing at the 'o'.
    expect(offsetFromRowColumn("import os", 1, 8)).toBe(7);
  });

  test("finds offset on a later line", () => {
    const source = "import os\nimport sys\n";
    // second line, same (1:8) convention -> offset into "import sys"
    expect(offsetFromRowColumn(source, 2, 8)).toBe(10 + 7);
  });

  test("a surrogate-pair emoji before the target column shifts the offset by 2 UTF-16 units", () => {
    // "🐍" is a surrogate pair (2 UTF-16 code units). Ruff reports columns in
    // UTF-16 code units (Workspace was constructed with PositionEncoding.Utf16),
    // which is also how JS string indices/CodeMirror doc offsets count — so
    // plain arithmetic on JS string indices stays aligned, but a naive
    // code-point-based implementation (e.g. iterating with `for...of` or
    // `Array.from`) would miscount by 1 here.
    const source = '    s = "🐍"; unused_var = 1\n';
    // Ruff reports (2:15) for `unused_var` in `def f():\n<this line>` — landing
    // on the 'u', one past the closing quote and semicolon-space that follow
    // the 2-UTF-16-unit-wide emoji.
    const offset = offsetFromRowColumn(source, 1, 15);
    expect(offset).toBe(14);
    expect(source[offset]).toBe("u");
  });
});
