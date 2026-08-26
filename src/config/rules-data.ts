/** One entry from a version's `rules.json` (see `scripts/gen-rules-json.mjs`). */
export interface Rule {
  code: string;
  name: string;
  linter: string;
  summary: string;
  fixable: boolean;
  preview: boolean;
  /** Whether Ruff enables this rule by default (`Workspace.defaultSettings()`), for this Ruff version. */
  enabled: boolean;
}

/**
 * A Tier 2 category — one row of "select all in category" UI, grouped by
 * `rules.json`'s real `linter` field (not a hand-picked prefix list, per
 * PLAN.md Phase 7).
 */
export interface Category {
  /** The rules' shared `linter` field — the category's display name and its identity in `categorySelected`. */
  key: string;
  rules: Rule[];
  /**
   * The actual Ruff rule-selector prefix(es) that together select every rule
   * in this category. Usually one value equal to the rules' shared leading
   * letters, but some linters split across multiple top-level selectors with
   * no single shared prefix — confirmed against real `ruff check --select`
   * output (not assumed): `pycodestyle` is `E`/`W`, `Pylint` is
   * `PLC`/`PLE`/`PLR`/`PLW` (each accepted individually; there is no
   * single "pycodestyle" or "PL"-covers-everything selector needed here,
   * since using each rule's own exact leading-letter run is always valid).
   */
  prefixes: string[];
}

export interface RulesIndex {
  rules: Rule[];
  categories: Category[];
  byCode: Map<string, Rule>;
}

function leadingPrefix(code: string): string {
  const match = /^[A-Za-z]+/.exec(code);
  if (match === null) throw new Error(`Rule code "${code}" has no leading letter prefix.`);
  return match[0];
}

/** Builds category/lookup structures from a flat `rules.json` array. */
export function buildRulesIndex(rules: Rule[]): RulesIndex {
  const byCode = new Map(rules.map((rule) => [rule.code, rule]));

  const byLinter = new Map<string, Rule[]>();
  for (const rule of rules) {
    const list = byLinter.get(rule.linter);
    if (list) list.push(rule);
    else byLinter.set(rule.linter, [rule]);
  }

  const categories: Category[] = [...byLinter.entries()].map(([key, catRules]) => ({
    key,
    rules: catRules,
    prefixes: [...new Set(catRules.map((rule) => leadingPrefix(rule.code)))].sort(),
  }));

  return { rules, categories, byCode };
}

const rulesCache = new Map<string, Promise<Rule[]>>();

/** Fetches and caches a version's `rules.json` (path as given by `VersionEntry.rulesPath`). */
export async function loadRules(rulesPath: string): Promise<Rule[]> {
  let cached = rulesCache.get(rulesPath);
  if (!cached) {
    cached = fetch(`${import.meta.env.BASE_URL}${rulesPath}`).then((res) => res.json() as Promise<Rule[]>);
    rulesCache.set(rulesPath, cached);
  }
  return cached;
}
