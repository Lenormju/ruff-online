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
- **Input modes — build order changed from the original design pass, and the
  mode model itself was revised in Phase 8**: **Raw TOML ships first**, since
  Ruff's `Options` mirror `[tool.ruff]` ~1:1 and a TOML textarea + parser
  gives full config coverage almost immediately. **Visual (tiered form) mode
  ships later**, layered on top of the same underlying `Options` object,
  built incrementally (Tier 1+3, then Tier 2 rule selection, then Tier 4
  plugin fine-tuning). As of Phase 8, there are two top-level facets, not
  three parallel modes: **Code** (TOML base config + CLI override flags,
  merged — see Phase 8) and **Visual**. Both facets are `mode` values
  (`"code" | "visual"`); TOML and CLI are not alternate views switched
  between, but complementary layers combined at Check/Format time — see
  Phase 8's section for the full rationale. The Code/Visual split is still
  **mutually exclusive** and never live-synced — switching between them does
  a one-time explicit conversion (Code→Visual can warn before a lossy
  discard; Visual→Code is an explicit "Fill from Visual" action, never
  automatic and never lossy).
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
CORS/MIME/base-path issues), paste `import os`, click Check, see `F401`.
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

**Version floor (as of the 2026-08-26 fix)**: `check-new-ruff-releases.mjs`
only offers Ruff releases `>= 0.11.1` for ingestion. `@astral-sh/ruff-wasm-web`
never published a build before `0.5.3` (2024-07-18), and `0.5.3`-`0.11.0`
have two unhandled incompatibilities beyond the `0.13.2` `PositionEncoding`
one `workspace.ts` already tolerates: the diagnostic field was named
`location` instead of `start_location` (renamed exactly at `0.11.0` ->
`0.11.1`), and there's no `"invalid-syntax"` diagnostic code to detect syntax
errors by (message-text only). The `Workspace` options schema across that
whole span is also unverified. Supporting `0.5.3`-`0.11.0` is possible but
deferred — would need field normalization, syntax-error detection by message
prefix, and an options-schema audit across ~60 versions.

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
for parsing. Textarea → `Options` parsed fresh on every explicit "Check" click
(not live per-keystroke, consistent with the consent rule) — no separate
"Apply"/staging step; whatever TOML is in the editor at the moment Check is
clicked is what's used. `Options` fed straight into `Workspace` construction,
replacing Phase 0's hardcoded defaults.

**Critical files**: `src/editor/toml-editor.ts`, `src/config/toml-options.ts`.

**Verification**: paste `[tool.ruff]\nline-length = 20\n\n[tool.ruff.lint]\nselect = ["E", "F"]`,
run Check against a long line, confirm `E501` (Ruff's default
`lint.select` — `E4,E7,E9,F` — excludes `E5`, so `line-length` alone has no
observable effect; `select` must include `E`/`E501` to exercise it). Paste
malformed TOML and click Check, confirm a clear parse-error message (distinct
from a Ruff diagnostic or a Ruff exception) and that Ruff is not invoked.

---

## Phase 4 — Format Diff + Apply

**Adds**: "Format" action calling `workspace.format(code)`. Diff view via
`@codemirror/merge`'s `unifiedMergeView` — a read-only, throwaway preview
editor built fresh per Format click, entirely separate from the live Python
input editor (which is never touched, and stays editable at any time).
Per-chunk accept/reject controls disabled (`mergeControls: false`); the only
state-changing action is the single explicit "Apply" button, which replaces
the real editor's content on click. A "Collapse unchanged lines" checkbox
toggles `collapseUnchanged` on the preview, off by default; re-renders the
existing diff immediately without re-running Format (planned to become part
of persisted page state in Phase 5). Exceptions (can't parse) shown via the
same red-banner pattern as Check.

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

**Known gap, deferred (not this phase)**: the sync from "component state
changed" to "URL updated" is currently three manually-wired call-sites in
`main.ts` (the Python editor's and TOML editor's `onChange`, and the
version `<select>`'s `change` listener each explicitly call
`notifyUrlSync()`) — not a single funnel a new control is forced to go
through. `main.ts`'s wiring itself has no automated test (this repo has no
jsdom, by design — see Testing decisions above), so a future edit that
silently drops one of those calls, or a new Phase 6/7 control (Tier 1/3
fields, rule-override checkboxes, mode switch) that forgets to wire itself
up, would pass `pnpm test` and `tsc -b` while quietly no longer round-
tripping through the URL. Before or during Phase 6, when the number of
state-affecting controls grows, revisit: either centralize all
state-affecting writes through one setter that itself triggers sync
(harder to forget), or add a jsdom-based wiring test for this specific
path despite the general no-jsdom stance.

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

**Status: done.** `src/config/options.ts` (`visualOptionsToRuffOptions`/
`ruffOptionsToVisualOptions`/`visualOptionsToTomlText`, TDD'd) holds the
Tier 1+3 field maps, confirmed against Ruff's real `ruff.schema.json` rather
than guessed. `src/ui/mode-switch.ts` exposes the pure
`tomlToVisualWarning` (also TDD'd); the actual `confirm()` dialog and DOM
writes live in `main.ts`'s `switchMode`, next to `check()`/`format()`.
`src/ui/tier1-panel.ts`/`tier3-panel.ts` are DOM-only (untested, same as
`diff-view.ts`'s render half — no jsdom in this repo). Two mutually
exclusive radio inputs, not a `<select>`, per the "mutually exclusive"
wording above. `AppState` (`src/state/url-state.ts`) gained `mode` and
`visual` fields — **a breaking change to the URL format**, accepted
deliberately since the page still says "missing" for Visual mode until
now and there are no real shared links to preserve; both `toml` and
`visual` are always present regardless of active mode, since each mode's
data is a snapshot only updated by an explicit switch, never derived live
from the other. Also closes the Phase 5 "known gap" flagged above: a
`wireStateControl` helper in `main.ts` wraps every native control
(version `<select>`, the two mode radios) that isn't already funneled
through a single constructor-time `onChange` the way editors/panels are,
so a forgotten `notifyUrlSync()` now requires visibly bypassing the shared
helper rather than silently omitting a trailing call. Verified via
`pnpm test` (63/63), `tsc -b`, `pnpm build`, and a real headless-Chromium
pass: Visual→TOML→Visual round-trip of `line_length`/`target_version`/
`indent_style`/`quote_style`, Format actually reflecting a Visual-set
`quote_style` in its diff, a lossy TOML→Visual switch triggering the
`confirm()` warning (accept discards `lint.select`, cancel reverts to TOML
with the text untouched), and a full Copy-link → fresh-context reload
restoring Visual mode plus every field.

**Known gap, deferred (not this phase)**: Tier 1/3's field names and enum
values (`src/config/options.ts`'s `TIER1_FIELDS`/`TIER3_FIELDS`) are a
single static list, taken from Ruff's `ruff.schema.json` on the `main`
branch (i.e. today's latest Ruff) — **not generated per-version the way
`rules.json` already is** (Phase 2's `scripts/gen-rules-json.mjs`
pipeline). The Visual form has no notion of which Ruff version is
currently selected: the same fields/options are offered regardless of
whether `0.13.2` or `0.16.4` is picked in the version `<select>`.
Empirically verified (2026-08-26, real `Workspace` construction against
the actual CDN wasm) that every current Tier 1/3 field/enum value is
accepted on every currently-supported version (`0.13.2` through
`0.16.4`) — so there is no live bug today. But nothing guards against
future drift: a Ruff release that renames/removes a field, or (in
principle) a version old enough to predate one, would make `Workspace`
throw, surfacing as the same generic red error banner used for any Ruff
exception — not a crash, but a confusing top-level error tied to what
looks like a valid form selection, with no per-field "unsupported on this
version" signal. Revisit before/during Phase 7 (Tier 2) or Phase 9 (Tier
4, ~130 fields across ~25 plugins, where the risk multiplies): likely
fix is extending the version-ingestion workflow to also emit a
per-version options schema (or at least a smoke-test assertion covering
Tier 1/3/4's exact field set) alongside each version's `rules.json`, so
schema drift is caught the same way rule drift already is, rather than
relying solely on the runtime exception path.

**Known gap, deferred (UI/UX polish)**: the page's visual design has been
built purely feature-by-feature since Phase 0 — plain default browser form
controls, no visual hierarchy beyond `<h2>`/`<h3>` headings, no responsive/
mobile layout consideration, and inconsistent spacing across the growing
number of status/warning banners (`#error-banner`, `#config-status`,
`#url-warning`, `#format-status`). Tier 1/3's General/Formatting groups
added in this phase are visually cramped, tiny inline labels with no
grouping beyond a bare `<h3>` (see the Phase 6 verification screenshot).
No phase in this plan currently includes a design/UX pass — Phase 11 is
scoped to a README + an in-app help notice, not general styling. Revisit
once the config UI stabilizes, likely after Tier 2/4 (Phases 7/9) add
significantly more form surface — probably worth its own dedicated pass
rather than folded into a feature phase, so it doesn't keep getting
deferred in favor of the next functional slice.

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

**Status: done.** `src/config/rules-data.ts` (`buildRulesIndex`/`loadRules`),
`src/config/rule-reconciliation.ts` (`toSelectIgnore`/`pruneOverrides`), and
`src/config/toml-to-visual.ts` (`lintToVisual`) hold the logic, all TDD'd
(`test/rules-data.test.ts`, `test/rule-reconciliation.test.ts`,
`test/toml-to-visual.test.ts`, plus new cases in `test/options.test.ts`).
`src/ui/tier2-panel.ts` renders one `<details>` per category (a native,
collapsible, dependency-free tree — no virtualization needed for ~1000
rules) with a "select all" checkbox and per-rule checkboxes underneath.
Category derivation groups by `rules.json`'s real `linter` field, as
planned. `src/main.ts` loads that version's `rules.json` into a
`RulesIndex` alongside `supported-versions.json` (on initial load and on
every version switch), threading it through `visualOptionsToRuffOptions`/
`ruffOptionsToVisualOptions`/`tomlToVisualWarning`/`visualOptionsToTomlText`,
all now taking a nullable `RulesIndex` parameter (`null` only in the brief
window before the first version's rules have loaded, in which case Tier 2
is simply omitted rather than blocking Check/Format). `switchMode` is now
async to allow waiting for that fetch on a TOML→Visual switch.
Verified via `pnpm test` (12 files, 101 passing), `tsc -b`, `pnpm build`,
and a real headless-Chromium pass: checking "flake8-bugbear" then
unchecking `B006` leaves only `B008` firing on matching code; a Visual→
TOML→Visual round trip preserves the exact `B006`/`B008` checkbox layout;
hand-written TOML with `select=["B"], ignore=["B006"]` switches to Visual
with category B checked and B006 shown as a carve-out; a freshly-loaded
page shows `F401` pre-checked (Ruff's real per-version default) with
nothing in `categorySelected`/`ruleOverrides` yet, matching the "baseline"
rule below.

Two decisions made during implementation that PLAN.md's original text
didn't anticipate, both confirmed empirically against real `ruff check`
(not assumed) — documented in code, repeated here since they're
non-obvious enough to matter for future phases (CLI mode reuses this
logic per Phase 8's own text):

- **Category → selector-prefix derivation.** The spike's open question
  ("pylint splits into PLR/PLW/PLC/PLE") resolved as: a `Category`'s
  identity (`categorySelected`'s key) is the `linter` field itself, but
  its underlying Ruff selector(s) (`Category.prefixes`) are *every
  distinct leading-letter run* actually present among its rule codes —
  usually one value, but two for `pycodestyle` (`E`/`W`) and four for
  `Pylint` (`PLC`/`PLE`/`PLR`/`PLW`). Confirmed real Ruff accepts each of
  these individually as a selector; no shorter common-prefix shortcut
  (e.g. a single `"PL"`) is relied on, even where it happens to also work,
  since that's not guaranteed for every linter.
- **`select` replaces defaults; `ignore`/`extend-select` don't.** Empirically
  confirmed `lint.select = []` disables every rule, including Ruff's own
  default-enabled set — `select`'s mere *presence* replaces the defaults,
  it's not additive. This forced `toSelectIgnore` to route a one-off `'on'`
  override into `extend-select` (not `select`) whenever no category is
  selected, so enabling one extra default-off rule doesn't silently wipe
  out every other default-on rule. `ignore` needed no such treatment — it
  subtracts from whatever's in effect either way. This also shapes the
  reverse conversion (`toml-to-visual.ts`): when a parsed `[tool.ruff.lint]`
  table has no `select` key at all, the baseline for every rule is that
  rule's own `enabled` flag (not `false`), and the conversion back to
  `categorySelected`/`ruleOverrides` is *exact* (not best-effort) in that
  case — only the `select`-present branch keeps the spike's original
  majority-vote ambiguity for ties.

**Known gap, deferred:** a stale `ruleOverrides` entry for a code that no
longer exists in a newly-selected version's `rules.json` (rule renamed or
removed between versions) is silently dropped by `pruneOverrides`/
`toSelectIgnore`, but only the next time either runs (a category toggle,
or the next Check/Format) — switching versions alone doesn't proactively
clean it up. Low impact (it's simply excluded from `select`/`ignore` in
the meantime, never sent to Ruff), not addressed now.

---

## Phase 8 — Code facet: TOML base config + CLI override flags, merged

**Status: done**, built as a substantial redesign from the original draft
below (kept for history) after the user reframed the goal mid-planning: the
app's one real interface is `RuffOptions`, offered via two facets — **Code**
(this phase) and **Visual**. Both should independently be as close to a full
bijection with `RuffOptions` as possible; Code gets there now, Visual's
remaining gap (Tier 4, `fixable`/`unfixable`) is accepted but must always be
documented and warned-about before anything is silently discarded.

**Original draft (superseded)**: a thin third mode parsing a small hand-rolled
subset of flags (`--select`, `--ignore`, `--extend-select`, `--line-length`,
`--target-version`, `--preview`, `--fixable`, `--unfixable`,
`--extend-ignore`). Verifying against real `ruff check --help` (not assumed,
per this section's own open-risk item) found two of those flags don't exist:
**`--line-length` isn't a real flag at all** (only `--config
"line-length=N"`), and **`--extend-ignore` doesn't exist** (only
`--extend-select`/`--extend-fixable`). That verification pass is what
triggered the redesign below rather than a small find-and-replace.

**Design — Code = TOML (base) + CLI (overrides), merged**: mirrors how real
Ruff actually behaves — a checked-in `pyproject.toml` plus ad-hoc CLI flags
for one run, where CLI/`--config` settings "always take precedence over all
configuration files" (Ruff's own `--config` help text, confirmed directly).
Both boxes are always shown together, independently editable, never synced
or converted into each other — there is no lossy-conversion concept between
TOML and CLI at all. `effectiveOptions = deepMergeOptions(parse(toml),
parse(cli))` (`src/config/cli-flags.ts`): plain-object/table values merge
key-by-key (so TOML's `lint.select` and CLI's `lint.extend-select` both
survive as siblings), arrays/scalars are atomic replacements by the
override — this alone reproduces Ruff's real `select`-replaces-vs-
`extend-select`-adds semantics, since that's just two different keys and
`rule-reconciliation.ts` already interprets their interaction downstream.

**Full `RuffOptions` coverage for CLI**: native ergonomic flags (`--select`,
`--ignore`, `--extend-select`, `--fixable`, `--unfixable`,
`--extend-fixable`, `--target-version`, `--preview`, `--fix`,
`--unsafe-fixes`) plus a generic `--config "<dotted.path>=<toml-value>"`
escape hatch — a real, repeatable Ruff flag, confirmed empirically to accept
genuine TOML value syntax at arbitrary depth (a top-level scalar, a nested
plugin field `lint.pydocstyle.convention="google"`, an inline table; bare
unquoted strings are rejected, numbers/booleans are fine). This makes CLI a
full, lossless serialization of `RuffOptions`, same as TOML. `smol-toml`'s
`stringify` only emits block-table syntax for nested tables, not inline, so
`optionsToCliFlags` has its own small hand-rolled inline-TOML-value writer
(`tomlValueLiteral`) for the generic-fallback direction; parsing needed no
such thing (`smol-toml.parse` already understands inline tables/arrays).
Real Ruff users paste **shell-quoted** command lines (`--config
"lint.select=[\"E\", \"F\"]"`), so `shellTokenize` does real quote-aware
tokenization, not naive whitespace-splitting.

**Permissive by design (explicit user decision)**: any *real* Ruff CLI flag
with no meaning in a filesystem-less browser tool (`--watch`,
`--output-file`, `--cache-dir`, positional file/dir args, etc.) is accepted,
not a parse error — arity-correct so tokenization stays right — but **not
silent**: `#cli-ignored-notice` shows a live, amber notice naming exactly
which recognized flags/arguments were ignored, updated on every CLI-box
edit. Only a flag that isn't a real Ruff flag at all (typo/invented) is a
hard parse error, pointing the user at `--config` as the general escape
hatch. `--per-file-ignores`/`--extend-per-file-ignores` are real
`RuffOptions` fields but use a non-TOML `pattern:codes` mini-syntax this
parser doesn't special-case — also reported as ignored, still reachable via
`--config "lint.per-file-ignores={...}"`.

**A real correctness edge case, handled**: `optionsToCliFlags`'s generic
`--config` fallback recurses into nested tables to emit one flag per leaf
(e.g. `--config "lint.pydocstyle.convention=..."`) — but only when every key
at that level is a safe bare identifier. A table with a literal-dot key (a
file-pattern key like `"__init__.py"` in `per-file-ignores`) would otherwise
produce a dotted path indistinguishable from genuine nesting and fail to
round-trip back through `--config`'s own `path.split(".")`; such a table is
instead emitted whole, as one opaque inline-TOML-value leaf.

**Visual ⇄ Code, and why there's no live sync**: Code→Visual parses TOML,
parses CLI, merges, then runs the merged `RuffOptions` through the existing
`ruffOptionsToVisualOptions`/`optionsToVisualWarning` (renamed from
`tomlToVisualWarning` — the source was always a generic `RuffOptions`, never
TOML-specific) exactly like the old TOML→Visual switch, warning before
discarding anything Visual can't yet represent (Tier 4, `fixable`/
`unfixable`). **Visual→Code is deliberately not automatic** — an earlier
version of this design converted-and-overwrote on every mode-radio click,
but that risked silently clobbering whatever WIP text the user already had
in the TOML/CLI boxes even though the *resulting* `RuffOptions` is never
lossy in that direction. Clicking the "Code" radio from Visual is now a pure
visibility change (editors untouched); populating Code from Visual is a
separate, explicit **"Fill from Visual"** button that writes the full state
into the TOML box (`ruffOptionsToTomlText`) and resets the CLI box to empty
— deliberately, so the merge stays unambiguous and nothing stale in CLI can
silently combine with the fresh TOML. Never warns (the explicit click is the
consent step) since Visual's coverage is always a subset of what Code can
express.

**Critical files**: `src/config/cli-flags.ts` (`shellTokenize`,
`cliFlagsToOptions`, `optionsToCliFlags`, `deepMergeOptions`, `deepSet`),
`src/editor/cli-editor.ts` (plain CodeMirror, no language mode — just a flag
string, no syntax to highlight), `src/config/toml-options.ts`
(`ruffOptionsToTomlText`, the TOML-serialization half of the same pivot),
`src/ui/mode-switch.ts` (`optionsToVisualWarning`).

**Verification**: `pnpm test` (179/179), `tsc -b`, `pnpm build`, and a real
headless-Chromium pass confirming: TOML-only Check/Format unaffected; TOML
`select=["F"]` + CLI `--extend-select E501` firing both `F401` and `E501`
(sibling-key merge); CLI `--select E501` wholesale-replacing TOML's
`select=["F"]` (only `E501` fires, `F401` doesn't — override-wins
precedence, matching real Ruff); a `--config format.quote-style` example
changing Format's diff; an unknown flag showing the amber parse-error
banner; inert flags (`--watch`, a positional `src/`) parsing successfully
with the live ignored-flags notice listing both, Check succeeding (not
blocked); a Code→Visual switch with an unmodeled TOML key showing the
discard-warning dialog, cancel reverting cleanly; toggling Code→Visual→Code
leaving a hand-typed TOML marker completely untouched; "Fill from Visual"
correctly resetting CLI to its default and populating TOML with Visual's
full state (including Tier 2 rule selection), never prompting a dialog;
Copy-link round-tripping `mode` plus both TOML/CLI text buffers into a fresh
browser context.

---

## Phase 9 — Visual Mode, Tier 4: Plugin Fine-Tuning

**Adds**: progressive disclosure — a plugin's panel (isort, pep8-naming,
pylint, flake8-pytest-style, etc., ~130 fields across ~25 namespaces) only
renders once its Tier 2 category has at least one rule enabled. Build
incrementally by plugin, each as its own verified sub-step, not all at
once. `Options` schema extends to cover these fields in
`ruffOptionsToVisualOptions`/`visualOptionsToRuffOptions` — this is what
closes Visual's remaining gap with Code (Phase 8 already gives Code full
`RuffOptions` coverage via TOML + CLI's native flags/`--config` escape
hatch, so no CLI-side work is needed here; Phase 9 is purely about Visual
catching up, not about extending the Code facet).

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

**Status: done** (built out of order — Phases 8 and 9, CLI-flags mode and
Tier 4 plugin fine-tuning, are still unbuilt; the user explicitly chose to
jump ahead). `src/editor/lint-integration.ts` holds `toLintDiagnostics`
(pure, TDD'd — reuses `offsetFromRowColumn` from Phase 1, so it inherits
that phase's already-verified UTF-16/surrogate-pair correctness rather than
re-deriving it) and `lintExtensions`/`applyLintDiagnostics`. `linter(() =>
[])` is registered with a no-op source (`Check` stays the single explicit
trigger, matching the results-list behavior — no automatic per-keystroke
linting), plus `lintGutter()`; `applyLintDiagnostics(editor, diagnostics)`
pushes results in externally via `@codemirror/lint`'s `setDiagnostics` right
after `renderDiagnostics` in `main.ts`'s `showResults`, and is cleared
(empty array) in `clearOutput()` — so a syntax error (which replaces the
list with the red banner, never rendering it) also gets no squiggles,
consistent with the list. A zero-width diagnostic range is widened by one
character (else nothing renders); a diagnostic anchored at the very end of
the document is clamped rather than widened past `doc.length`. Verified via
`pnpm test` (124/124), `tsc -b`, `pnpm build`, and a real headless-Chromium
pass: `F401` on `import os` shows both a squiggly underline
(`.cm-lintRange-error`) and a gutter marker (`.cm-lint-marker-error`);
hovering the gutter marker shows the tooltip with the exact message +
code; introducing a syntax error clears the squiggle instead of layering
it under the red banner. **Known automation quirk, not a product bug**:
hovering directly over the inline underline itself didn't reliably surface
`@codemirror/lint`'s hover tooltip under synthetic Playwright/CDP mouse
events in headless mode, even though the events demonstrably reached the
editor DOM (confirmed via an injected listener) — the gutter marker's
hover, which is the same underlying feature, worked immediately. Not
investigated further since this is stock `@codemirror/lint` behavior, not
custom code.

---

## Phase 11 — Polished README + In-App Help

**Adds**: a proper `README.md` (GitHub repo link, badge/link to the live
site, current supported Ruff version, brief feature overview, screenshot),
plus a small in-app help notice on the page itself (what this tool is, link
back to the GitHub repo, current Ruff version in use).

**Critical files**: `README.md`, `src/ui/help-notice.ts` (or equivalent
small UI element).

**Verification**: README renders correctly on GitHub with working links;
the deployed page shows the help notice with a correct, live GitHub link
and the current Ruff version.

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
| 8 | Code facet (TOML base + CLI overrides, merged, full RuffOptions coverage) | Visual's Tier 4/fixable-unfixable gap, squiggles |
| 9 | Visual Tier 4 (plugins) | squiggles |
| 10 | Inline squiggles | (feature-complete per current spec) |
| 11 | README + in-app help notice | — |

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
4. **Exact CLI flag names** (Phase 8) — **resolved**: verified against real
   `ruff check --help` output, not assumed. Two of the originally-drafted
   flags (`--line-length`, `--extend-ignore`) turned out not to exist; see
   Phase 8's section for the full write-up and the resulting redesign.
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
