# Ruff Online — Phased Implementation Plan

## Context

Ruff Online is a static GitHub Pages site: a browser-based playground for Ruff
(the Python linter/formatter). Paste Python code, configure Ruff, run it, see
lint diagnostics and/or a format diff — entirely client-side via Ruff's
official WebAssembly build, no backend. The design was worked out over an
extended conversation (engine choice, CDN-hosted wasm, version-ingestion
automation, rule-selection UI, mode architecture, shareable URLs) and
validated with a working spike (`spike/rule-reconciliation.mjs`, all tests
passing) before this plan was written.

The repo is currently empty. The goal now is to turn the agreed design into
a real, incrementally-shippable build: something working after every phase,
starting from the smallest possible end-to-end slice.

## Decisions locked in (do not relitigate during implementation)

- **Engine**: `@astral-sh/ruff-wasm-web`'s `Workspace` class, loaded at
  runtime via dynamic `import()` of a jsdelivr CDN URL — never vendored or
  npm-installed. One `Workspace` instance covers both `.check()` (lint) and
  `.format()`.
- **Versions**: `public/supported-versions.json` is the single source of
  truth (`{version, wasmUrl, rulesPath}` entries). A daily + on-demand
  (`workflow_dispatch`) GitHub Actions workflow finds new **stable-only**
  Ruff releases, generates that version's `rules.json`
  (`ruff rule --all --output-format json`, trimmed), smoke-tests it (real
  `Workspace.check()`/`.format()` against the jsdelivr URL), and **on
  success commits the new entry directly to `main`** — fully unattended, no
  PR checkpoint (the smoke test is the quality gate). A version that fails
  the smoke test is simply never added. Retention: keep all versions
  forever, no pruning.
- **Input modes — build order changed from the original design pass**:
  **Raw TOML ships first**, since Ruff's `Options` mirror `[tool.ruff]`
  ~1:1 and a TOML textarea + parser gives full config coverage almost
  immediately. **Visual (tiered form) mode ships later**, layered on top of
  the same underlying `Options` object, built incrementally (Tier 1+3, then
  Tier 2 rule selection, then Tier 4 plugin fine-tuning). CLI-flags mode
  ships last, as a thin third mode. Modes are **mutually exclusive**, never
  live-synced — switching modes does a one-time explicit conversion, with a
  warning before any lossy switch.
- **Hard UX rule throughout**: never change user input without consent.
  Format never auto-replaces (diff + explicit Apply button). Shareable-URL
  state is only ever applied on initial page load, never on a later
  `hashchange` while the user is editing. Mode-switch conversions warn
  before discarding anything the target mode can't represent.
- **Rule reconciliation** (Tier 2, once built): two separate, explicitly
  user-set state containers — `categorySelected: Set<prefix>` and
  `ruleOverride: Map<code, 'on'|'off'>` — never derived from each other via
  a majority/heuristic. Forward direction (state → `{select, ignore}`) is
  exact and already validated in the spike. The state stored (and put in
  shareable URLs) is the user's *delta* on top of that Ruff version's actual
  default-enabled rules — not a full resolved snapshot.
- **Editor**: CodeMirror 6 (official `@codemirror/lang-python`;
  `@codemirror/legacy-modes` for TOML, since no dedicated `@codemirror/lang-toml`
  exists). Not Monaco.
- **Tech stack**: vanilla TypeScript + Vite, no frontend framework — the UI
  (textareas, checkboxes, a results list, a diff view) doesn't need a
  component framework, and keeping the app shell tiny matters given the
  wasm module itself is already a multi-MB one-time cost. Vitest for unit
  tests. `smol-toml` for TOML parsing (fast, spec-compliant, tiny, works
  both in the browser and in Node scripts).
- **Testing**: unit tests for pure logic (rule reconciliation, TOML↔Options,
  CLI-flag mapping) + the wasm smoke test embedded in the CI ingestion
  workflow. No browser UI/visual-regression suite.

## Project structure

```
ruff-online/
  index.html
  src/
    main.ts
    editor/           # CodeMirror setup (python editor, toml editor)
    engine/           # wasm loading, Workspace wrapper, version registry access
    config/           # Options model, TOML<->Options, rule reconciliation, CLI flags
    ui/                # results panel, diagnostics list, diff view, mode switch, config tiers
    state/             # app state, URL (de)serialization
  public/
    supported-versions.json
    versions/<version>/rules.json
  scripts/             # Node scripts, run locally and by CI
    gen-rules-json.mjs
    smoke-test.mjs
    check-new-ruff-releases.mjs
  .github/workflows/
    deploy.yml
    ingest-versions.yml
  test/
  spike/               # kept as historical reference only, not built upon
```

---

## Phase 0 — Walking Skeleton

**Goal**: prove the whole chain works end-to-end on a real deployed page:
static site → wasm from CDN → `Workspace.check()` → results shown.

**Scope**: one hardcoded Ruff version (a constant string + CDN URL, no
`supported-versions.json` yet). No config UI — `Workspace` built with
default `Options`. Plain `<textarea>`, no CodeMirror. Check (lint) only, no
format. Results as a plain list: `code — message (line:col)`. A thrown
exception (syntax error) shown as a distinct red banner, never mixed into
the diagnostics list — cheap to get right now, establishes the pattern.

**Critical files**: `index.html`, `src/main.ts`, `src/engine/workspace.ts`
(dynamic `import()` of the hardcoded CDN URL, wraps `new Workspace(...)`
and `.check()`), `.github/workflows/deploy.yml` (build → `actions/upload-pages-artifact`
→ `actions/deploy-pages`).

**One-time manual step**: set repo Settings → Pages → Source → "GitHub
Actions" (outside any workflow file).

**Verification**: open the deployed Pages URL (not just localhost, to catch
CORS/MIME/base-path issues), paste `import os`, click Run, see `F401`.
Paste unbalanced parens, confirm the red banner (not a crash or empty list).

**Missing after this phase**: everything — version choice, any config,
formatting, syntax highlighting, sharing, CI. Note this on the page itself.

---

## Phase 1 — CodeMirror Python Editor

**Adds**: `@codemirror/lang-python`, line numbers/highlighting, click-to-jump
from a diagnostic to its line:col.

**Watch for**: `Workspace`'s `PositionEncoding` (UTF-8 vs UTF-16) — get the
offset math right now with an explicit non-ASCII test case (an emoji, not
just accented Latin — surrogate pairs are the real edge case), since Tier 2
squiggles (Phase 10) will depend on this being correct.

**Critical files**: `src/editor/python-editor.ts`, `src/ui/diagnostics-panel.ts`.

**Verification**: F401 test from Phase 0 + click-to-jump lands on the right
line; a snippet with an emoji in a string still jumps to the correct column.

---

## Phase 2 — Multi-Version Support + CI Ingestion

**Goal**: replace the hardcoded version with the real, automated
`supported-versions.json` pipeline.

**Adds**:
- `scripts/gen-rules-json.mjs` — `uv tool run ruff==<version> rule --all --output-format json`,
  trimmed to `{code, name, linter, summary, fixable, preview}`, written to
  `public/versions/<version>/rules.json`.
  **Open research item**: how to get each rule's default-enabled status per
  version. Investigate `Workspace.defaultSettings()` in `ruff-wasm-web`
  first; if it doesn't give a usable answer, fall back to a hardcoded
  default-select-prefix constant (currently ~`E4,E7,E9,F`) kept in one
  shared module with a comment flagging it needs manual review if Ruff ever
  changes its defaults, plus a smoke-test assertion that would catch drift.
- `scripts/smoke-test.mjs` — dynamic `import()` of the jsdelivr URL for a
  version, instantiate `Workspace`, run `.check()`/`.format()` on a fixed
  trivial snippet, non-zero exit on any exception.
- `scripts/check-new-ruff-releases.mjs` — GitHub Releases API for
  `astral-sh/ruff` **using the workflow's `GITHUB_TOKEN`** (avoid the low
  unauthenticated rate limit), filtering on the API's `prerelease`/`draft`
  booleans (not tag-string pattern matching — verify actual tag format
  first), diffed against existing `supported-versions.json` entries.
- `.github/workflows/ingest-versions.yml` — `schedule` (daily) +
  `workflow_dispatch`; per new version, generate + smoke-test, and **on
  success commit directly to main** (rules.json + new manifest entry).
- Frontend: version `<select>` populated from `supported-versions.json`,
  defaulting to latest; `workspace.ts` now reads `wasmUrl` verbatim from the
  matched entry instead of templating one.

**Critical files**: the three `scripts/*.mjs`, `.github/workflows/ingest-versions.yml`,
`public/supported-versions.json`, `src/engine/versions.ts`.

**Verification**: run both scripts locally for one version, confirm
`rules.json` is well-formed and the smoke test exits 0. Manually trigger the
workflow against a repo missing the latest release, confirm exactly that
entry is added with a valid `rules.json`. In-browser: switch versions,
confirm reload happens and a previously-used version loads instantly
(cached).

---

## Phase 3 — Raw TOML Mode (first, and for now only, config mode)

**Goal**: full config coverage, fast — this is the reprioritized phase; no
mode-switch machinery needed yet since it's the only mode.

**Adds**: CodeMirror TOML editor (`@codemirror/legacy-modes`), `smol-toml`
for parsing. Textarea → `Options` on explicit "Apply" (not live
per-keystroke, consistent with the consent rule). `Options` fed straight
into `Workspace` construction, replacing Phase 0's hardcoded defaults.

**Critical files**: `src/editor/toml-editor.ts`, `src/config/toml-options.ts`.

**Verification**: paste `[tool.ruff]\nline-length = 20`, Apply, run Check
against a long line, confirm `E501`. Paste malformed TOML, confirm a clear
parse-error message (distinct from a Ruff diagnostic or a Ruff exception).

---

## Phase 4 — Format Diff + Apply

**Adds**: "Format" action calling `workspace.format(code)`. Diff view
(before/after) — a small hand-rolled line-diff (LCS-based) rather than
adding a diff dependency, consistent with the lightness theme. Explicit
"Apply" button replaces editor content only on click. Exceptions (can't
parse) shown via the same red-banner pattern as Check.

**Critical files**: `src/ui/diff-view.ts`, `src/engine/workspace.ts` (add
`.format()` wrapper).

**Verification**: badly-indented code → Format → diff shown, editor
untouched until Apply is clicked → Apply → editor updates. Syntax error →
red banner, not a broken/empty diff.

---

## Phase 5 — Shareable URL State

**Adds**: `src/state/url-state.ts` — serializes `{version, code, toml}` to
JSON, compresses via `CompressionStream('deflate-raw')`, base64url-encodes
into `location.hash`. Debounced `history.replaceState` (never `pushState`).
Applied **only on initial page load** — never on a later `hashchange` while
editing. Soft cap ~6000 chars with a warning if exceeded, no backend
fallback. Code comment noting `lz-string` (~4KB) as a documented future
option if compression ratio becomes a real problem, deliberately not added
now.

**Critical files**: `src/state/url-state.ts`, `src/state/app-state.ts`.

**Verification**: configure + paste a snippet, copy URL, open in a fresh
incognito window, confirm exact restoration. Edit after load, confirm hash
updates without growing browser history, and that a stale previously-copied
URL never clobbers an in-progress edit.

---

## Phase 6 — Visual Mode, Tier 1 + Tier 3 (second mode; mode-switch machinery introduced here)

**Goal**: introduce the Visual form as a second mode, and — because this is
where two modes first coexist — the one-time mode-switch conversion +
lossy-switch warning.

**Adds**: Tier 1 (global: `fix`, `unsafe_fixes`, `preview`, `line_length`,
`indent_width`, `target_version`) and Tier 3 (format: `indent_style`,
`quote_style`, `line_ending`, `skip_magic_trailing_comma`,
`docstring_code_format`, preview) form controls, mapped directly onto
scalar `Options` fields — no select/ignore ambiguity at this tier, so
TOML⇄Visual conversion here is straightforward pure serialization both
ways. `src/ui/mode-switch.ts`: on switching away from a mode, detect fields
the other mode can't yet represent (e.g. anything not yet wired, or TOML
comments) and warn before discarding.

**Critical files**: `src/config/options.ts`, `src/ui/tier1-panel.ts`,
`src/ui/tier3-panel.ts`, `src/ui/mode-switch.ts`.

**Verification**: set `line_length` in Visual, switch to TOML, confirm it
appears correctly serialized; edit it in TOML, switch back to Visual,
confirm the field updates. Trigger a lossy switch (once Tier 2/4 fields
exist in TOML but not yet in Visual) and confirm the warning appears rather
than silent data loss.

---

## Phase 7 — Visual Mode, Tier 2: Rule Selection

**Goal**: the most complex piece — category + per-rule override UI, and
where the genuinely ambiguous TOML→Visual reverse conversion is needed for
the first time.

**Adds**:
- `src/config/rule-reconciliation.ts` — port `toSelectIgnore` +
  `pruneOverrides` from `spike/rule-reconciliation.mjs` near-verbatim,
  typed against real `rules.json`.
- Category derivation grouped from `rules.json`'s real `linter` field —
  **not** a hand-picked prefix list. Verify against real generated
  `rules.json` (available since Phase 2) whether `linter` alone is
  sufficient or whether prefix needs deriving some other way — pylint in
  particular splits into PLR/PLW/PLC/PLE, a case the spike deliberately
  flagged as unresolved.
- Two separate, explicitly-set state containers wired to two visually
  distinct control types (a "select all in category" checkbox, separate
  from individual rule row checkboxes) — never inferred from counting
  children. `pruneOverrides` called on every category toggle.
- Baseline: render checkboxes as checked according to that version's actual
  default-enabled set (from Phase 2's research item) before any user
  interaction, while `categorySelected`/`ruleOverride` themselves stay
  empty until the user acts — stored state is the delta only.
- `src/config/toml-to-visual.ts` — the best-effort reverse conversion
  (arbitrary `select`/`ignore`/`extend-*` arrays → `categorySelected`/
  `ruleOverride`), reusing the spike's `resolveEnabled` +
  `uiStateFromResolved` approach, **isolated to this one conversion path
  only** — never used as the canonical Visual-mode state model elsewhere.
  Documented caveat carried over from the spike: preserves the *resolved
  rule set*, not necessarily the exact checkbox layout, for ambiguous
  inputs — acceptable here since the goal is "good enough to keep editing."

**Critical files**: `src/config/rule-reconciliation.ts`,
`src/config/toml-to-visual.ts`, `src/ui/tier2-panel.ts`,
`src/config/rules-data.ts`.

**Verification**: port the spike's test suite into
`test/rule-reconciliation.test.ts`, confirm all cases pass against the
real category derivation. In-browser: check "flake8-bugbear", uncheck
`B006`, confirm only `B008` fires on matching code. Hand-write TOML with
`select=["B"], ignore=["B006"]`, switch to Visual, confirm category B
checked with B006 shown as a carve-out.

---

## Phase 8 — CLI Flags Mode

**Adds**: `src/config/cli-flags.ts` — hand-rolled parser for a documented
subset only: `--select`, `--ignore`, `--extend-select`, `--line-length`,
`--target-version`, `--preview`, `--fixable`, `--unfixable`,
`--extend-ignore` (cross-check exact flag names against real
`ruff check --help` before implementing, not assumed). First token
(`check`/`format`) is cosmetic framing only. Reuses Phase 7's
`toml-to-visual`-style logic for its own select/ignore parsing.

**Critical files**: `src/config/cli-flags.ts`, `src/editor/cli-editor.ts`
(plain styled textarea — no syntax highlighting needed for a flag string).

**Verification**: unit tests per supported flag + a combination; an
unsupported flag shows a clear message rather than silently no-op'ing.

---

## Phase 9 — Visual Mode, Tier 4: Plugin Fine-Tuning

**Adds**: progressive disclosure — a plugin's panel (isort, pep8-naming,
pylint, flake8-pytest-style, etc., ~130 fields across ~25 namespaces) only
renders once its Tier 2 category has at least one rule enabled. Build
incrementally by plugin, each as its own verified sub-step, not all at
once. `Options` schema and TOML/CLI conversions extend to cover these
fields (CLI mode's documented subset likely doesn't need to grow).

**Critical files**: `src/config/options.ts` (extended), one file per plugin
under `src/ui/tier4-panels/`, or a schema-driven generic form if field
shapes prove regular enough to justify it.

**Verification**: one concrete example per plugin (e.g. set
`isort.known-first-party`, confirm Format output's import ordering
changes).

---

## Phase 10 — Inline Squiggly Diagnostics

**Adds**: `@codemirror/lint` integration mapping `Workspace.check()`
results into CodeMirror's linter source — underlines/gutter markers
alongside (not instead of) the existing diagnostics list.

**Critical files**: `src/editor/lint-integration.ts`.

**Verification**: F401 test again, confirm squiggly + hover message appear
in addition to the list entry.

---

## Summary Table

| Phase | Adds | Still missing after |
|---|---|---|
| 0 | Walking skeleton: 1 version, check-only | almost everything |
| 1 | CodeMirror editor + click-to-jump | multi-version, config, format, sharing |
| 2 | supported-versions.json + CI ingestion | config, format, sharing |
| 3 | Raw TOML mode (full config coverage) | format, sharing, Visual/CLI modes |
| 4 | Format diff + Apply | sharing, Visual/CLI modes |
| 5 | Shareable URL state | Visual/CLI modes |
| 6 | Visual Tier 1+3 (+ mode-switch machinery) | rule selection, plugins, CLI mode |
| 7 | Visual Tier 2 (rule reconciliation) | plugins, CLI mode |
| 8 | CLI flags mode | plugins, squiggles |
| 9 | Visual Tier 4 (plugins) | squiggles |
| 10 | Inline squiggles | (feature-complete per current spec) |

---

## Open Risks / Verify-Before-Building Items

1. **Default-enabled rule data source** (Phase 2) — no confirmed clean API
   yet; largest single technical risk in the plan.
2. **License/attribution** — Ruff and `ruff-wasm-web` are MIT-licensed; the
   wasm is CDN-loaded not vendored (lighter obligation), but a visible
   footer credit + link to Ruff/Astral is appropriate given the whole site
   showcases their tool.
3. **Deployment mechanism** — official `actions/upload-pages-artifact` +
   `actions/deploy-pages` (OIDC, no PAT/secrets) over any `gh-pages`-branch
   action.
4. **Exact CLI flag names** (Phase 8) — verify against real
   `ruff check --help` output before implementing, don't assume the
   drafted list is exact.
5. **"Stable-only" determination** (Phase 2) — use the Releases API's
   `prerelease`/`draft` booleans as the authoritative signal; verify Ruff's
   actual tag format first, don't pattern-match tag strings blind.
6. **GitHub Actions cron isn't guaranteed to the minute** — not a blocker
   given `workflow_dispatch` exists as a manual fallback and a missed day
   has low impact.
7. **Position encoding** (Phase 1) — verify UTF-8 vs UTF-16 handling with a
   non-BMP character test case before Phase 10 builds squiggles on top of it.
8. **Category→prefix derivation** (Phase 7) — confirm against real
   generated `rules.json`, not assumed solvable from the `linter` field
   name alone.
9. **Unauthenticated GitHub API rate limits** (Phase 2) — use the
   workflow's `GITHUB_TOKEN` for the releases-check request.

## Critical Files Reference

- `spike/rule-reconciliation.mjs` — source algorithm for Phase 7 (and the
  reverse-conversion reference)
- `public/supported-versions.json` — version→wasmUrl/rulesPath source of
  truth (Phase 2 on)
- `scripts/gen-rules-json.mjs` / `scripts/smoke-test.mjs` — the CI gate
  deciding which versions ever become usable
- `src/config/rule-reconciliation.ts` — production port of the spike,
  most conceptually load-bearing client logic
- `src/state/url-state.ts` — must respect the load-only-on-open consent rule
- `.github/workflows/ingest-versions.yml` — keeps the version list alive
  unattended
