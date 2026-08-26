# Backlog

Unprioritized. Assembled 2026-08-26 from three sources:

- a full read-through of the codebase against the goals and design rules in
  [PLAN.md](PLAN.md),
- the "Known gap, deferred" notes previously scattered through PLAN.md's phase
  sections,
- the feature backlog captured during the UX/UI overhaul design conversation.

Items are phrased as what a **user** experiences, not as internal defects,
except for the final section which is explicitly project-level.

IDs are stable and section-scoped so this list can be reordered freely without
renumbering. Tags:

- **[verified]** — reproduced directly (running the parser, reading the wiring,
  or measuring against the real Ruff schema), not inferred.
- **[rule]** — breaks one of PLAN.md's design rules.
- **[accepted]** — a known limitation we've decided to live with; the work is
  to *document* it, not fix it.

---

## Bugs

Things that are wrong, not merely missing.

- **BUG-1 — Editing code after a Format leaves a stale diff and a live Apply
  button; clicking it destroys your edits.** [verified] [rule]
  Neither editing nor Check clears the diff. Format, type twenty new lines,
  click Apply, and those lines are replaced by the formatted version of the
  *old* code. The only item here that can lose work.
- **BUG-2 — Commented-out CLI flags are actually applied.** [verified]
  The Overrides box ships with `# --select E,F` and
  `# --config "line-length=100"`. The tokenizer has no comment handling, so the
  default text parses as `{"line-length":100,"lint":{"select":["E","F"]}}`.
  Every `#` line anywhere in the box is live. (Previously noted in PLAN.md
  Phase 9, found while browser-verifying, never fixed.)
- **BUG-3 — Config in a mistyped table is silently ignored.** [verified] [rule]
  `[tool.rufff]` or `[tool.black]` runs with Ruff's defaults and says nothing.
  The parser already detects this and reports it as `hasRuffTable`; `main.ts`
  throws the value away and hardcodes `true`. Nothing consumes it.
- **BUG-4 — After Apply, the diagnostics list and squiggles are stale.**
  [verified] Apply clears the diff but not the results, so the list describes
  the pre-format code and squiggles can sit at the wrong positions.
- **BUG-5 — Switching Ruff version leaves the previous version's results on
  screen.** [verified] Results are presented as if they came from the newly
  selected version.
- **BUG-6 — Changing any config setting leaves the previous results on
  screen.** [verified] Nothing distinguishes "current" from "three edits ago".
- **BUG-7 — The Target version picker is out of date.** [verified]
  Offers `py37`–`py313`; Ruff's schema accepts `py314` and `py315`.

## Silent behaviour

Direct violations of the "no silent errors" rule.

- **SIL-1 — A broken or outdated share link silently becomes a blank default
  session.** [rule] Decoding failures return nothing and fall through to
  defaults, with no indication the link was bad.
- **SIL-2 — If the version list fails to load, the app is dead with no
  message.** [verified] [rule] The fetch is fired with no error handling; the
  picker stays empty and Check reports "No Ruff version selected yet" with no
  explanation.
- **SIL-3 — If a version's rule list fails to load, rule selection is
  permanently empty with no message.** [verified] [rule]
- **SIL-4 — Options that cannot apply in a browser are silently accepted.**
  [rule] `cache-dir`, `exclude`, `include`, `src`, `respect-gitignore` and
  friends are taken without comment and do nothing. Only the CLI box names its
  ignored flags; TOML has no equivalent and Visual has no notion of them.
- **SIL-5 — Rule codes that don't exist in the selected Ruff version silently
  do nothing.** [rule] `rules.json` is already loaded and could catch this.
- **SIL-6 — Preview-only rules selected without `preview = true` silently do
  nothing.** [rule] A real Ruff gotcha the tool is well placed to catch.
- **SIL-7 — A rule you toggled that doesn't exist in a newly-selected version
  is dropped without telling you.** [rule] (PLAN.md Phase 7 known gap.)

## Missing feedback

- **FDB-1 — No loading state while Ruff downloads.** The first Check on a
  version fetches multiple megabytes of WebAssembly. The button doesn't
  disable, nothing indicates progress, and the app simply appears frozen.
  Repeated clicks are possible and unacknowledged.
- **FDB-2 — Nothing ever states which config produced the results on screen,
  or whether they are current.**
- **FDB-3 — A clipboard failure on "Copy link" appears in the red Ruff error
  banner** — the tool blames Ruff for a browser permission problem. [rule]
- **FDB-4 — "No Ruff version selected yet" also appears in the Ruff error
  banner**, for the same reason. [rule]
- **FDB-5 — All six message surfaces are stacked in one column, far from their
  causes.** [rule] Version warnings sit near the top, config errors below the
  config, the URL-length warning nowhere near "Copy link".
- **FDB-7 — Config problems are reported as a banner, not anchored to the line
  that caused them.** TOML parse errors already carry a line and column, and
  are flattened into prose. Unknown option keys, nonexistent rule codes
  (SIL-5), preview-only rules (SIL-6) and deprecated options could all be shown
  inline in the config editor, the way lint diagnostics are shown inline in the
  Python editor.
- **FDB-6 — Hovering an inline squiggle to see its message has never actually
  been confirmed to work.** PLAN.md Phase 10 recorded that this couldn't be
  reproduced under browser automation and dismissed it as a tooling quirk on
  the strength of the gutter marker working. That means the primary hover path
  is unverified, not verified-good.

## Discovery and learning

- **DIS-1 — 969 rules in a scroll box with no search or filter.** Finding
  `B006` requires knowing it lives under "flake8-bugbear" and scrolling to it.
  The largest single usability gap in the app, and the only one where the
  current design has no answer at all rather than a weak one.
- **DIS-2 — No links to Ruff's documentation anywhere** — not from rules, not
  from options, not from linters. Stated goal: this tool should help people
  learn Ruff.
- **DIS-3 — Rule explanations are `title` tooltips**: slow to appear,
  truncated, and invisible on touch devices.
- **DIS-4 — There is no rule rationale or example to show.** `rules.json`
  carries only `{code, name, linter, summary, fixable, preview, enabled}`.
  Ruff's "What it does / Why is this bad? / Example" prose lives only in the
  docs. `@codemirror/lint` can already render rich tooltips
  (`Diagnostic.renderMessage`), so the blocker is sourcing the content, not
  displaying it.
- **DIS-5 — No way to see which rules are firing, or which would fire if
  enabled.** The latter needs a second full run with everything enabled,
  diffed against the active selection.
- **DIS-6 — No way to see a rule in action** without writing triggering code
  yourself. ("Inject this bad example into my input.")
- **DIS-7 — No presets** (Ruff defaults, strict, flake8-equivalent, …).
- **DIS-8 — No rule version history** — "added in version x.y.z", as displayed
  metadata and as a filter.

## Option coverage

- **COV-1 — Roughly 50-60 Ruff options cannot be reached in Visual at all.**
  Measured against the real `ruff.schema.json`. Includes `fixable`/`unfixable`,
  `dummy-variable-rgx`, `task-tags`, `allowed-confusables`, `builtins`,
  `external`, `logger-objects`, `typing-modules`, `explicit-preview-rules`,
  `per-file-target-version`. Contradicts PLAN.md's previous claim that only
  Tier 4 plus `fixable`/`unfixable` were outstanding.
- **COV-2 — The option list is identical for every Ruff version**, unlike the
  rule list, which is generated per version. A field the selected version
  doesn't recognise surfaces as a raw Ruff exception rather than a per-field
  "not available in this version". (PLAN.md Phase 6 known gap.)
- **COV-3 — The option schema snapshot has already drifted.** Today's schema
  contains `pydoclint` and `typing-extensions`, which the Phase 9 transcription
  predates. Nothing detects this.

## Model and vocabulary

- **MOD-1 — Remove the Code↔Visual conversion and its "this will discard
  settings" dialog.** They are two independent input methods; there is nothing
  to convert and nothing to lose.
- **MOD-2 — "Fill from Visual" becomes an explicit export-as-TOML action** and
  moves out of the Visual section.
- **MOD-3 — Invented vocabulary is visible in the UI**: "Plugin fine-tuning",
  "General", "Rule selection", "Base config", "Overrides". Ruff's own terms are
  Top-level / `lint` / `format` / `lint.<linter>`.
- **MOD-4 — Internal `Tier1`…`Tier4` naming** throughout filenames, types, CSS
  ids and tests. To follow the user-facing rename, as a separate pass.
- **MOD-5 — A "Dump URL state to JSON" debug button is shipped in the public
  UI.**

## Presentation

- **PRE-1 — Nothing is responsive.** [verified] Zero `@media` rules in the
  entire app. The version picker is hard-coded to 23rem and will overflow a
  phone; editors have fixed pixel heights. Never tested on mobile at all.
- **PRE-2 — No dark mode.** [verified] No `prefers-color-scheme` anywhere.
- **PRE-3 — Empty "Results" and "Format diff" sections are always visible**,
  as headings with nothing beneath them, before anything has been run.
- **PRE-4 — Native `confirm()` dialogs** for Reset and the lossy switch.
- **PRE-5 — No visual hierarchy** — default browser form controls throughout.
  Flagged as deferred in PLAN.md since Phase 6 and never picked up.

## Sharing

- **SHR-1 — No schema version in the link payload**, so the post-stabilization
  freeze isn't enforceable and old links can't be migrated rather than silently
  falling back to defaults. Pairs with SIL-1.
- **SHR-2 — No way to put two configs, or two Ruff versions, in one link.**
  The originating use case for the whole project.
- **SHR-3 — No share-lock**, so a reader can alter what you sent them without
  realising the result is no longer yours.
- **SHR-4 — Every shared link gets the same generic preview card.** [accepted]
  `location.hash` is never sent to a server, so a link-unfurling crawler can
  only ever see the static page. Work item is to document this, not fix it.
- **SHR-5 — Links are several KB and cannot be shortened** without a backend.
  [accepted] Same treatment.

## Flow and interaction

- **FLW-1 — Check and Format are separate, mutually-clearing actions**, rather
  than both running with either hideable.
- **FLW-2 — Nothing runs on page load.** A shared link shows code with no
  results until the reader finds and clicks a button.
- **FLW-3 — No auto-run mode.** Every change requires an explicit click.
- **FLW-4 — No undo beyond the editor's own Ctrl-Z**, and no back/forward
  history. Note that adding history-based undo means CodeMirror's own undo
  stack has to be tied into global state rather than running independently.
- **FLW-5 — A plain reload loses everything** unless the URL happens to be
  current. No local persistence.

## Ruff versions

- **VER-1 — Nothing older than 0.13.2 is available.** The code supports back to
  0.11.1; the list is only ever appended to by the daily ingestion workflow and
  is never backfilled. Anything before 0.11.1 would need real work: the
  diagnostic field was named `location` rather than `start_location`, there is
  no `invalid-syntax` code to detect syntax errors by, and the options schema
  across that span is unverified. (PLAN.md Phase 2.)
- **VER-2 — A Ruff version that fails the ingestion smoke test is absent
  forever, with nothing in the app explaining the hole.**

## Project-level

Not user-facing. Listed because they were found during the same pass and are
genuine shortcomings, not because they belong in the same priority queue.

- **PRJ-1 — No tests run in CI.** `pnpm test` appears in no workflow. All 327
  tests are local-only, and a failing suite deploys to production.
- **PRJ-2 — No DOM or behaviour test suite exists at all.** Every test covers
  pure functions; nothing covers wiring, so a dropped call site or a broken
  flow passes `pnpm test` and `tsc -b` cleanly. PLAN.md locks in "no browser
  UI/visual-regression suite" as a decision — now explicitly revisitable.
- **PRJ-3 — `spike/rule-reconciliation.mjs` is still in the repo** as
  historical reference, superseded by `src/config/rule-reconciliation.ts`.
