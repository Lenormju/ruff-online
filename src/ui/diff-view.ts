export type DiffOp =
  | { type: "equal"; line: string }
  | { type: "delete"; line: string }
  | { type: "insert"; line: string };

/** Splits on "\n" and drops a trailing empty element from a final newline. */
function toLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Line-level diff via classic LCS dynamic programming + backtrack. Hand-rolled
 * rather than pulling in a diff dependency, per the lightness theme — line
 * counts here (a pasted snippet) are small enough that O(n*m) is fine.
 */
export function diffLines(before: string, after: string): DiffOp[] {
  const a = toLines(before);
  const b = toLines(after);
  const n = a.length;
  const m = b.length;

  // lcs[i][j] = length of the LCS of a[i:] and b[j:]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "equal", line: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ type: "delete", line: a[i] });
      i++;
    } else {
      ops.push({ type: "insert", line: b[j] });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: "delete", line: a[i] });
    i++;
  }
  while (j < m) {
    ops.push({ type: "insert", line: b[j] });
    j++;
  }
  return ops;
}

export function renderDiff(container: HTMLElement, before: string, after: string): void {
  container.replaceChildren();
  const ops = diffLines(before, after);
  if (ops.every((op) => op.type === "equal")) {
    const item = document.createElement("div");
    item.textContent = "No changes.";
    container.append(item);
    return;
  }
  for (const op of ops) {
    const line = document.createElement("div");
    line.classList.add("diff-line", `diff-${op.type}`);
    const prefix = op.type === "insert" ? "+ " : op.type === "delete" ? "- " : "  ";
    line.textContent = prefix + op.line;
    container.append(line);
  }
}
