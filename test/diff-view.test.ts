import { describe, expect, test } from "vitest";
import { diffLines } from "../src/ui/diff-view";

describe("diffLines", () => {
  test("identical text produces only equal ops", () => {
    expect(diffLines("a\nb\n", "a\nb\n")).toEqual([
      { type: "equal", line: "a" },
      { type: "equal", line: "b" },
    ]);
  });

  test("pure insertion", () => {
    expect(diffLines("a\nb\n", "a\nx\nb\n")).toEqual([
      { type: "equal", line: "a" },
      { type: "insert", line: "x" },
      { type: "equal", line: "b" },
    ]);
  });

  test("pure deletion", () => {
    expect(diffLines("a\nx\nb\n", "a\nb\n")).toEqual([
      { type: "equal", line: "a" },
      { type: "delete", line: "x" },
      { type: "equal", line: "b" },
    ]);
  });

  test("replacement is a delete followed by an insert, not an update op", () => {
    // Formatting is the common case: an indentation change replaces a line
    // wholesale. There is no "modify" op kind — just delete old + insert new.
    expect(diffLines("if True:\n    x = 1\n", "if True:\n  x = 1\n")).toEqual([
      { type: "equal", line: "if True:" },
      { type: "delete", line: "    x = 1" },
      { type: "insert", line: "  x = 1" },
    ]);
  });

  test("no trailing newline on either side does not lose or duplicate the last line", () => {
    expect(diffLines("a\nb", "a\nb")).toEqual([
      { type: "equal", line: "a" },
      { type: "equal", line: "b" },
    ]);
  });

  test("empty before (pure insertion of everything)", () => {
    expect(diffLines("", "a\nb\n")).toEqual([
      { type: "insert", line: "a" },
      { type: "insert", line: "b" },
    ]);
  });

  test("empty after (pure deletion of everything)", () => {
    expect(diffLines("a\nb\n", "")).toEqual([
      { type: "delete", line: "a" },
      { type: "delete", line: "b" },
    ]);
  });

  test("both empty produces no ops", () => {
    expect(diffLines("", "")).toEqual([]);
  });
});
