/**
 * Visual mode's Tier 4 (plugin fine-tuning) schema — one entry per
 * `[tool.ruff.lint.<plugin>]` namespace, transcribed field-for-field from
 * Ruff's real `ruff.schema.json` (astral-sh/ruff, main branch), not
 * hand-guessed. `categoryKey` is the matching `rules.json` `linter` value;
 * three plugin TOML keys don't match their `linter` string verbatim
 * (`pylint` -> "Pylint", `pyflakes` -> "Pyflakes", `ruff` -> "Ruff-specific
 * rules") so it's listed explicitly per plugin rather than derived.
 *
 * Field kinds cover all 119 real fields with no per-plugin bespoke code —
 * see PLAN.md's Phase 9 section for the shape analysis. `record`'s
 * `wrapKey` (only `flake8-tidy-imports.banned-api`) wraps/unwraps each map
 * value as `{[wrapKey]: value}` on the Ruff side, matching `ApiBan`'s real
 * `{msg: string}` shape.
 */

export type Tier4FieldKind =
  | "boolean"
  | "integer"
  | "string"
  | "enum"
  | "stringArray"
  | "record"
  | "recordArray"
  | "importSelector";

export interface Tier4FieldSpec {
  key: string;
  label: string;
  kind: Tier4FieldKind;
  enumValues?: string[];
  wrapKey?: string;
}

export interface Tier4PluginSpec {
  key: string;
  label: string;
  categoryKey: string;
  fields: Tier4FieldSpec[];
}

export const TIER4_SCHEMA: Tier4PluginSpec[] = [
  {
    key: "flake8-annotations",
    label: "flake8-annotations",
    categoryKey: "flake8-annotations",
    fields: [
      { key: "allow-star-arg-any", label: "Allow star arg any", kind: "boolean" },
      { key: "ignore-fully-untyped", label: "Ignore fully untyped", kind: "boolean" },
      { key: "mypy-init-return", label: "Mypy init return", kind: "boolean" },
      { key: "suppress-dummy-args", label: "Suppress dummy args", kind: "boolean" },
      { key: "suppress-none-returning", label: "Suppress none returning", kind: "boolean" },
    ],
  },
  {
    key: "flake8-bandit",
    label: "flake8-bandit",
    categoryKey: "flake8-bandit",
    fields: [
      { key: "allowed-markup-calls", label: "Allowed markup calls", kind: "stringArray" },
      { key: "check-typed-exception", label: "Check typed exception", kind: "boolean" },
      { key: "extend-markup-names", label: "Extend markup names", kind: "stringArray" },
      { key: "hardcoded-tmp-directory", label: "Hardcoded tmp directory", kind: "stringArray" },
      { key: "hardcoded-tmp-directory-extend", label: "Hardcoded tmp directory extend", kind: "stringArray" },
    ],
  },
  {
    key: "flake8-boolean-trap",
    label: "flake8-boolean-trap",
    categoryKey: "flake8-boolean-trap",
    fields: [{ key: "extend-allowed-calls", label: "Extend allowed calls", kind: "stringArray" }],
  },
  {
    key: "flake8-bugbear",
    label: "flake8-bugbear",
    categoryKey: "flake8-bugbear",
    fields: [{ key: "extend-immutable-calls", label: "Extend immutable calls", kind: "stringArray" }],
  },
  {
    key: "flake8-builtins",
    label: "flake8-builtins",
    categoryKey: "flake8-builtins",
    fields: [
      { key: "allowed-modules", label: "Allowed modules", kind: "stringArray" },
      { key: "builtins-allowed-modules", label: "Builtins allowed modules", kind: "stringArray" },
      { key: "builtins-ignorelist", label: "Builtins ignorelist", kind: "stringArray" },
      { key: "builtins-strict-checking", label: "Builtins strict checking", kind: "boolean" },
      { key: "ignorelist", label: "Ignorelist", kind: "stringArray" },
      { key: "strict-checking", label: "Strict checking", kind: "boolean" },
    ],
  },
  {
    key: "flake8-comprehensions",
    label: "flake8-comprehensions",
    categoryKey: "flake8-comprehensions",
    fields: [
      { key: "allow-dict-calls-with-keyword-arguments", label: "Allow dict calls with keyword arguments", kind: "boolean" },
    ],
  },
  {
    key: "flake8-copyright",
    label: "flake8-copyright",
    categoryKey: "flake8-copyright",
    fields: [
      { key: "author", label: "Author", kind: "string" },
      { key: "min-file-size", label: "Min file size", kind: "integer" },
      { key: "notice-rgx", label: "Notice rgx", kind: "string" },
    ],
  },
  {
    key: "flake8-errmsg",
    label: "flake8-errmsg",
    categoryKey: "flake8-errmsg",
    fields: [{ key: "max-string-length", label: "Max string length", kind: "integer" }],
  },
  {
    key: "flake8-gettext",
    label: "flake8-gettext",
    categoryKey: "flake8-gettext",
    fields: [
      { key: "extend-function-names", label: "Extend function names", kind: "stringArray" },
      { key: "function-names", label: "Function names", kind: "stringArray" },
    ],
  },
  {
    key: "flake8-implicit-str-concat",
    label: "flake8-implicit-str-concat",
    categoryKey: "flake8-implicit-str-concat",
    fields: [{ key: "allow-multiline", label: "Allow multiline", kind: "boolean" }],
  },
  {
    key: "flake8-import-conventions",
    label: "flake8-import-conventions",
    categoryKey: "flake8-import-conventions",
    fields: [
      { key: "aliases", label: "Aliases", kind: "record" },
      { key: "banned-aliases", label: "Banned aliases", kind: "recordArray" },
      { key: "banned-from", label: "Banned from", kind: "stringArray" },
      { key: "extend-aliases", label: "Extend aliases", kind: "record" },
    ],
  },
  {
    key: "flake8-pytest-style",
    label: "flake8-pytest-style",
    categoryKey: "flake8-pytest-style",
    fields: [
      { key: "fixture-parentheses", label: "Fixture parentheses", kind: "boolean" },
      { key: "mark-parentheses", label: "Mark parentheses", kind: "boolean" },
      { key: "parametrize-names-type", label: "Parametrize names type", kind: "enum", enumValues: ["csv", "tuple", "list"] },
      { key: "parametrize-values-row-type", label: "Parametrize values row type", kind: "enum", enumValues: ["tuple", "list"] },
      { key: "parametrize-values-type", label: "Parametrize values type", kind: "enum", enumValues: ["tuple", "list"] },
      { key: "raises-extend-require-match-for", label: "Raises extend require match for", kind: "stringArray" },
      { key: "raises-require-match-for", label: "Raises require match for", kind: "stringArray" },
      { key: "warns-extend-require-match-for", label: "Warns extend require match for", kind: "stringArray" },
      { key: "warns-require-match-for", label: "Warns require match for", kind: "stringArray" },
    ],
  },
  {
    key: "flake8-quotes",
    label: "flake8-quotes",
    categoryKey: "flake8-quotes",
    fields: [
      { key: "avoid-escape", label: "Avoid escape", kind: "boolean" },
      { key: "docstring-quotes", label: "Docstring quotes", kind: "enum", enumValues: ["double", "single"] },
      { key: "inline-quotes", label: "Inline quotes", kind: "enum", enumValues: ["double", "single"] },
      { key: "multiline-quotes", label: "Multiline quotes", kind: "enum", enumValues: ["double", "single"] },
    ],
  },
  {
    key: "flake8-self",
    label: "flake8-self",
    categoryKey: "flake8-self",
    fields: [
      { key: "extend-ignore-names", label: "Extend ignore names", kind: "stringArray" },
      { key: "ignore-names", label: "Ignore names", kind: "stringArray" },
    ],
  },
  {
    key: "flake8-tidy-imports",
    label: "flake8-tidy-imports",
    categoryKey: "flake8-tidy-imports",
    fields: [
      { key: "ban-lazy", label: "Ban lazy", kind: "importSelector" },
      { key: "ban-relative-imports", label: "Ban relative imports", kind: "enum", enumValues: ["parents", "all"] },
      { key: "banned-api", label: "Banned api", kind: "record", wrapKey: "msg" },
      { key: "banned-module-level-imports", label: "Banned module level imports", kind: "stringArray" },
      { key: "require-lazy", label: "Require lazy", kind: "importSelector" },
    ],
  },
  {
    key: "flake8-type-checking",
    label: "flake8-type-checking",
    categoryKey: "flake8-type-checking",
    fields: [
      { key: "exempt-modules", label: "Exempt modules", kind: "stringArray" },
      { key: "quote-annotations", label: "Quote annotations", kind: "boolean" },
      { key: "runtime-evaluated-base-classes", label: "Runtime evaluated base classes", kind: "stringArray" },
      { key: "runtime-evaluated-decorators", label: "Runtime evaluated decorators", kind: "stringArray" },
      { key: "strict", label: "Strict", kind: "boolean" },
    ],
  },
  {
    key: "flake8-unused-arguments",
    label: "flake8-unused-arguments",
    categoryKey: "flake8-unused-arguments",
    fields: [{ key: "ignore-variadic-names", label: "Ignore variadic names", kind: "boolean" }],
  },
  {
    key: "isort",
    label: "isort",
    categoryKey: "isort",
    fields: [
      { key: "case-sensitive", label: "Case sensitive", kind: "boolean" },
      { key: "classes", label: "Classes", kind: "stringArray" },
      { key: "combine-as-imports", label: "Combine as imports", kind: "boolean" },
      { key: "constants", label: "Constants", kind: "stringArray" },
      { key: "default-section", label: "Default section", kind: "string" },
      { key: "detect-same-package", label: "Detect same package", kind: "boolean" },
      { key: "extra-standard-library", label: "Extra standard library", kind: "stringArray" },
      { key: "force-single-line", label: "Force single line", kind: "boolean" },
      { key: "force-sort-within-sections", label: "Force sort within sections", kind: "boolean" },
      { key: "force-to-top", label: "Force to top", kind: "stringArray" },
      { key: "force-wrap-aliases", label: "Force wrap aliases", kind: "boolean" },
      { key: "forced-separate", label: "Forced separate", kind: "stringArray" },
      { key: "from-first", label: "From first", kind: "boolean" },
      { key: "import-heading", label: "Import heading", kind: "record" },
      { key: "known-first-party", label: "Known first party", kind: "stringArray" },
      { key: "known-local-folder", label: "Known local folder", kind: "stringArray" },
      { key: "known-third-party", label: "Known third party", kind: "stringArray" },
      { key: "length-sort", label: "Length sort", kind: "boolean" },
      { key: "length-sort-straight", label: "Length sort straight", kind: "boolean" },
      { key: "lines-after-imports", label: "Lines after imports", kind: "integer" },
      { key: "lines-between-types", label: "Lines between types", kind: "integer" },
      { key: "no-lines-before", label: "No lines before", kind: "stringArray" },
      { key: "no-sections", label: "No sections", kind: "boolean" },
      { key: "order-by-type", label: "Order by type", kind: "boolean" },
      { key: "relative-imports-order", label: "Relative imports order", kind: "enum", enumValues: ["closest-to-furthest", "furthest-to-closest"] },
      { key: "required-imports", label: "Required imports", kind: "stringArray" },
      { key: "section-order", label: "Section order", kind: "stringArray" },
      { key: "sections", label: "Sections", kind: "recordArray" },
      { key: "single-line-exclusions", label: "Single line exclusions", kind: "stringArray" },
      { key: "split-on-trailing-comma", label: "Split on trailing comma", kind: "boolean" },
      { key: "variables", label: "Variables", kind: "stringArray" },
    ],
  },
  {
    key: "mccabe",
    label: "mccabe",
    categoryKey: "mccabe",
    fields: [{ key: "max-complexity", label: "Max complexity", kind: "integer" }],
  },
  {
    key: "pep8-naming",
    label: "pep8-naming",
    categoryKey: "pep8-naming",
    fields: [
      { key: "classmethod-decorators", label: "Classmethod decorators", kind: "stringArray" },
      { key: "extend-ignore-names", label: "Extend ignore names", kind: "stringArray" },
      { key: "ignore-names", label: "Ignore names", kind: "stringArray" },
      { key: "staticmethod-decorators", label: "Staticmethod decorators", kind: "stringArray" },
    ],
  },
  {
    key: "pycodestyle",
    label: "pycodestyle",
    categoryKey: "pycodestyle",
    fields: [
      { key: "ignore-overlong-task-comments", label: "Ignore overlong task comments", kind: "boolean" },
      { key: "max-doc-length", label: "Max doc length", kind: "integer" },
      { key: "max-line-length", label: "Max line length", kind: "integer" },
    ],
  },
  {
    key: "pydoclint",
    label: "pydoclint",
    categoryKey: "pydoclint",
    fields: [{ key: "ignore-one-line-docstrings", label: "Ignore one line docstrings", kind: "boolean" }],
  },
  {
    key: "pydocstyle",
    label: "pydocstyle",
    categoryKey: "pydocstyle",
    fields: [
      { key: "convention", label: "Convention", kind: "enum", enumValues: ["google", "numpy", "pep257"] },
      { key: "ignore-decorators", label: "Ignore decorators", kind: "stringArray" },
      { key: "ignore-var-parameters", label: "Ignore var parameters", kind: "boolean" },
      { key: "property-decorators", label: "Property decorators", kind: "stringArray" },
    ],
  },
  {
    key: "pyflakes",
    label: "pyflakes",
    categoryKey: "Pyflakes",
    fields: [
      { key: "allowed-unused-imports", label: "Allowed unused imports", kind: "stringArray" },
      { key: "extend-generics", label: "Extend generics", kind: "stringArray" },
    ],
  },
  {
    key: "pylint",
    label: "pylint",
    categoryKey: "Pylint",
    fields: [
      { key: "allow-dunder-method-names", label: "Allow dunder method names", kind: "stringArray" },
      { key: "allow-magic-value-types", label: "Allow magic value types", kind: "stringArray" },
      { key: "max-args", label: "Max args", kind: "integer" },
      { key: "max-bool-expr", label: "Max bool expr", kind: "integer" },
      { key: "max-branches", label: "Max branches", kind: "integer" },
      { key: "max-locals", label: "Max locals", kind: "integer" },
      { key: "max-nested-blocks", label: "Max nested blocks", kind: "integer" },
      { key: "max-positional-args", label: "Max positional args", kind: "integer" },
      { key: "max-public-methods", label: "Max public methods", kind: "integer" },
      { key: "max-returns", label: "Max returns", kind: "integer" },
      { key: "max-statements", label: "Max statements", kind: "integer" },
      { key: "max-statements-in-try", label: "Max statements in try", kind: "integer" },
    ],
  },
  {
    key: "pyupgrade",
    label: "pyupgrade",
    categoryKey: "pyupgrade",
    fields: [{ key: "keep-runtime-typing", label: "Keep runtime typing", kind: "boolean" }],
  },
  {
    key: "ruff",
    label: "ruff",
    categoryKey: "Ruff-specific rules",
    fields: [
      { key: "allowed-markup-calls", label: "Allowed markup calls", kind: "stringArray" },
      { key: "extend-markup-names", label: "Extend markup names", kind: "stringArray" },
      { key: "parenthesize-tuple-in-subscript", label: "Parenthesize tuple in subscript", kind: "boolean" },
      { key: "strictly-empty-init-modules", label: "Strictly empty init modules", kind: "boolean" },
    ],
  },
];
