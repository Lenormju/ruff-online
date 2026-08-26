import { describe, expect, test } from "vitest";
import { toLintDiagnostics } from "../src/editor/lint-integration";
import type { Diagnostic } from "../src/engine/workspace";

function diagnostic(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    code: "F401",
    message: "`os` imported but unused",
    start_location: { row: 1, column: 8 },
    end_location: { row: 1, column: 10 },
    ...overrides,
  };
}

describe("toLintDiagnostics", () => {
  test("maps row/column to from/to offsets via the same convention as click-to-jump", () => {
    const source = "import os";
    const [cmDiagnostic] = toLintDiagnostics(source, [diagnostic()]);
    expect(cmDiagnostic).toMatchObject({ from: 7, to: 9, severity: "error", message: "`os` imported but unused" });
  });

  test("carries the rule code as the diagnostic source", () => {
    const source = "import os";
    const [cmDiagnostic] = toLintDiagnostics(source, [diagnostic({ code: "F401" })]);
    expect(cmDiagnostic!.source).toBe("F401");
  });

  test("a null code (e.g. a syntax error) has no source", () => {
    const source = "import os(";
    const [cmDiagnostic] = toLintDiagnostics(source, [
      diagnostic({ code: null, start_location: { row: 1, column: 1 }, end_location: { row: 1, column: 1 } }),
    ]);
    expect(cmDiagnostic!.source).toBeUndefined();
  });

  test("widens a zero-width range by one character so it's actually visible", () => {
    const source = "import os";
    const [cmDiagnostic] = toLintDiagnostics(source, [
      diagnostic({ start_location: { row: 1, column: 8 }, end_location: { row: 1, column: 8 } }),
    ]);
    expect(cmDiagnostic).toMatchObject({ from: 7, to: 8 });
  });

  test("clamps a range at the very end of the document instead of widening past it", () => {
    const source = "import os";
    const [cmDiagnostic] = toLintDiagnostics(source, [
      diagnostic({ start_location: { row: 1, column: 10 }, end_location: { row: 1, column: 10 } }),
    ]);
    expect(cmDiagnostic).toMatchObject({ from: 9, to: 9 });
  });

  test("maps multiple diagnostics in order", () => {
    const source = "import os\nimport sys\n";
    const diagnostics = [diagnostic(), diagnostic({ start_location: { row: 2, column: 8 }, end_location: { row: 2, column: 11 } })];
    const result = toLintDiagnostics(source, diagnostics);
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ from: 17, to: 20 });
  });

  test("empty diagnostics list maps to an empty array", () => {
    expect(toLintDiagnostics("import os", [])).toEqual([]);
  });
});
