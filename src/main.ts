import { checkCode, formatCode, SYNTAX_ERROR_CODE } from "./engine/workspace";
import {
  formatVersionLabel,
  getLatestVersion,
  getVersions,
  supportsUtf16PositionEncoding,
  type VersionEntry,
} from "./engine/versions";
import { createPythonEditor } from "./editor/python-editor";
import { createTomlEditor } from "./editor/toml-editor";
import { createCliEditor } from "./editor/cli-editor";
import { replaceContent } from "./editor/common";
import { ruffOptionsToTomlText, tomlToOptions, type TomlOptionsResult } from "./config/toml-options";
import { cliFlagsToOptions, deepMergeOptions } from "./config/cli-flags";
import {
  EMPTY_VISUAL_OPTIONS,
  ruffOptionsToVisualOptions,
  visualOptionsToRuffOptions,
  type Mode,
} from "./config/options";
import { buildRulesIndex, loadRules, type RulesIndex } from "./config/rules-data";
import { optionsToVisualWarning } from "./ui/mode-switch";
import { createTier1Panel } from "./ui/tier1-panel";
import { createTier2Panel } from "./ui/tier2-panel";
import { createTier3Panel } from "./ui/tier3-panel";
import { formatDiagnostic, renderDiagnostics } from "./ui/diagnostics-panel";
import { applyLintDiagnostics } from "./editor/lint-integration";
import { renderDiff } from "./ui/diff-view";
import { createUrlSync, loadInitialState } from "./state/app-state";
import type { AppState } from "./state/url-state";

const editorContainer = document.querySelector<HTMLDivElement>("#editor-container")!;
const codeContainer = document.querySelector<HTMLDivElement>("#code-container")!;
const tomlContainer = document.querySelector<HTMLDivElement>("#toml-container")!;
const cliContainer = document.querySelector<HTMLDivElement>("#cli-container")!;
const visualContainer = document.querySelector<HTMLDivElement>("#visual-container")!;
const tier1Container = document.querySelector<HTMLDivElement>("#tier1-container")!;
const tier2Container = document.querySelector<HTMLDivElement>("#tier2-container")!;
const tier3Container = document.querySelector<HTMLDivElement>("#tier3-container")!;
const modeCodeRadio = document.querySelector<HTMLInputElement>("#mode-code")!;
const modeVisualRadio = document.querySelector<HTMLInputElement>("#mode-visual")!;
const fillFromVisualButton = document.querySelector<HTMLButtonElement>("#fill-from-visual-button")!;
const cliIgnoredNotice = document.querySelector<HTMLDivElement>("#cli-ignored-notice")!;
const checkButton = document.querySelector<HTMLButtonElement>("#check-button")!;
const formatButton = document.querySelector<HTMLButtonElement>("#format-button")!;
const applyButton = document.querySelector<HTMLButtonElement>("#apply-button")!;
const copyLinkButton = document.querySelector<HTMLButtonElement>("#copy-link-button")!;
const resetButton = document.querySelector<HTMLButtonElement>("#reset-button")!;
const dumpStateButton = document.querySelector<HTMLButtonElement>("#dump-state-button")!;
const debugOutput = document.querySelector<HTMLPreElement>("#debug-output")!;
const versionInput = document.querySelector<HTMLInputElement>("#version-input")!;
const versionDatalist = document.querySelector<HTMLDataListElement>("#version-datalist")!;
const configStatus = document.querySelector<HTMLDivElement>("#config-status")!;
const resultsList = document.querySelector<HTMLUListElement>("#results")!;
const errorBanner = document.querySelector<HTMLDivElement>("#error-banner")!;
const formatStatus = document.querySelector<HTMLDivElement>("#format-status")!;
const diffView = document.querySelector<HTMLDivElement>("#diff-view")!;
const collapseUnchangedToggle = document.querySelector<HTMLInputElement>("#collapse-unchanged-toggle")!;
const urlWarning = document.querySelector<HTMLDivElement>("#url-warning")!;
const positionEncodingWarning = document.querySelector<HTMLDivElement>("#position-encoding-warning")!;

const defaultCode = "import os";
// An empty [tool.ruff] table means Ruff's defaults — nothing is silently
// already in force until Check is clicked.
const defaultToml = ["[tool.ruff]", "# line-length = 88", '# lint.select = ["E", "F"]', ""].join("\n");
// CLI flags are overrides layered on top of the TOML base above (CLI wins on
// conflicts) — an empty/commented CLI box means "no overrides", not "no config".
const defaultCli = ["ruff check", "# --select E,F", '# --config "line-length=100"', ""].join("\n");

// Read once, at initial load only — never re-applied on a later `hashchange`
// while the user is editing (see PLAN.md Phase 5's hard UX rule).
const initialState = await loadInitialState(location.hash);

let versions: VersionEntry[] = [];
let currentEntry: VersionEntry | null = null;
const labelToEntry = new Map<string, VersionEntry>();
let pendingFormattedCode: string | null = null;
let diffBefore: string | null = null;
let diffAfter: string | null = null;
let diffEditorView: ReturnType<typeof renderDiff> | null = null;

// Tier 2 (rule selection) is version-dependent — unlike Tier 1/3's static
// field maps, it needs that version's `rules.json` loaded before it can
// convert to/from RuffOptions at all. `null` until the first version's
// rules finish loading (see `loadRulesIndexFor` below).
let currentRulesIndex: RulesIndex | null = null;

// Which facet is active — Code (TOML base + CLI overrides, merged) or
// Visual. Unlike a TOML/CLI split, there's no separate "which syntax"
// sub-state: both of Code's boxes are always shown together and never
// synced with each other.
let mode: Mode = initialState?.mode ?? "visual";

// Reassigned once `urlSync` exists below; editors are created first since
// `getCurrentAppState` reads from them, and both directions need each other.
let notifyUrlSync: () => void = () => {};

const editor = createPythonEditor(editorContainer, initialState?.code ?? defaultCode, () => notifyUrlSync());
const tomlEditor = createTomlEditor(tomlContainer, initialState?.toml ?? defaultToml, () => notifyUrlSync());
const cliEditor = createCliEditor(cliContainer, initialState?.cli ?? defaultCli, () => {
  updateCliIgnoredNotice();
  notifyUrlSync();
});
const tier1Panel = createTier1Panel(tier1Container, initialState?.visual.tier1 ?? EMPTY_VISUAL_OPTIONS.tier1, () => notifyUrlSync());
const tier3Panel = createTier3Panel(tier3Container, initialState?.visual.tier3 ?? EMPTY_VISUAL_OPTIONS.tier3, () => notifyUrlSync());
const tier2Panel = createTier2Panel(tier2Container, initialState?.visual.tier2 ?? EMPTY_VISUAL_OPTIONS.tier2, () => notifyUrlSync());

/** Live-updates `#cli-ignored-notice` from the CLI box's current text — independent of Check/Format. */
function updateCliIgnoredNotice() {
  const result = cliFlagsToOptions(cliEditor.state.doc.toString());
  if (result.ok && result.ignoredFlags.length > 0) {
    cliIgnoredNotice.textContent = `Ignored (no effect in this browser tool): ${result.ignoredFlags.join(", ")}`;
    cliIgnoredNotice.style.display = "block";
  } else {
    cliIgnoredNotice.style.display = "none";
  }
}
updateCliIgnoredNotice();

function applyModeUI() {
  modeCodeRadio.checked = mode === "code";
  modeVisualRadio.checked = mode === "visual";
  codeContainer.style.display = mode === "code" ? "block" : "none";
  visualContainer.style.display = mode === "visual" ? "block" : "none";
}
applyModeUI();

function currentVisualOptions() {
  return { tier1: tier1Panel.get(), tier3: tier3Panel.get(), tier2: tier2Panel.get() };
}

/**
 * The options the active mode currently represents — feeds Check/Format.
 * In Code mode, TOML (base) and CLI (overrides) are parsed independently and
 * merged, CLI winning on conflicts — they're complementary layers of one
 * value, never converted into each other.
 */
function currentOptionsResult(): TomlOptionsResult {
  if (mode === "visual") {
    return { ok: true, options: visualOptionsToRuffOptions(currentVisualOptions(), currentRulesIndex), hasRuffTable: true };
  }
  const tomlResult = tomlToOptions(tomlEditor.state.doc.toString());
  if (!tomlResult.ok) return tomlResult;
  const cliResult = cliFlagsToOptions(cliEditor.state.doc.toString());
  if (!cliResult.ok) return cliResult;
  return { ok: true, options: deepMergeOptions(tomlResult.options, cliResult.options), hasRuffTable: true };
}

function getCurrentAppState(): AppState {
  return {
    version: currentEntry?.version ?? "",
    mode,
    code: editor.state.doc.toString(),
    toml: tomlEditor.state.doc.toString(),
    cli: cliEditor.state.doc.toString(),
    visual: currentVisualOptions(),
  };
}

function handleUrlEncoded(hash: string, exceedsSoftCap: boolean) {
  history.replaceState(null, "", "#" + hash);
  urlWarning.style.display = exceedsSoftCap ? "block" : "none";
}

const urlSync = createUrlSync(getCurrentAppState, handleUrlEncoded);
notifyUrlSync = () => urlSync.notifyChange();

/** Every native control that affects `AppState` beyond an editor's/panel's own
 * constructor-time `onChange` must go through this — the deliberate fix for
 * Phase 5's flagged gap where a raw `addEventListener` could silently forget
 * the trailing `notifyUrlSync()` call. Handlers may be async (e.g. `switchMode`,
 * which may need to wait for a version's `rules.json` to load); `notifyUrlSync`
 * only fires once the handler's own work — and thus the state it reads — is settled. */
function wireStateControl(target: EventTarget, event: string, handler: () => void | Promise<void>) {
  target.addEventListener(event, () => {
    void (async () => {
      await handler();
      notifyUrlSync();
    })();
  });
}

wireStateControl(modeCodeRadio, "change", () => switchMode("code"));
wireStateControl(modeVisualRadio, "change", () => switchMode("visual"));
wireStateControl(fillFromVisualButton, "click", () => fillCodeFromVisual());

/** Loads (and caches) a version's rules index, applying it to Tier 2 only if that version is still the active one by the time it resolves. */
async function loadRulesIndexFor(entry: VersionEntry): Promise<RulesIndex> {
  const rules = await loadRules(entry.rulesPath);
  const index = buildRulesIndex(rules);
  if (currentEntry?.version === entry.version) {
    currentRulesIndex = index;
    tier2Panel.setRulesIndex(index);
  }
  return index;
}

async function switchMode(target: Mode) {
  if (target === mode) return;

  if (target === "visual") {
    const tomlResult = tomlToOptions(tomlEditor.state.doc.toString());
    if (!tomlResult.ok) {
      applyModeUI(); // revert the radio to the still-active mode
      showConfigParseError(tomlResult.message);
      return;
    }
    const cliResult = cliFlagsToOptions(cliEditor.state.doc.toString());
    if (!cliResult.ok) {
      applyModeUI();
      showConfigParseError(cliResult.message);
      return;
    }
    if (!currentEntry) {
      applyModeUI();
      showError("No Ruff version selected yet.");
      return;
    }
    const merged = deepMergeOptions(tomlResult.options, cliResult.options);
    const rulesIndex = currentRulesIndex ?? (await loadRulesIndexFor(currentEntry));
    const warning = optionsToVisualWarning(merged, rulesIndex);
    if (warning !== null && !confirm(`${warning}\n\nContinue?`)) {
      applyModeUI();
      return;
    }
    clearOutput();
    clearConfigStatus();
    clearDiff();
    const { visual } = ruffOptionsToVisualOptions(merged, rulesIndex);
    tier1Panel.set(visual.tier1);
    tier3Panel.set(visual.tier3);
    tier2Panel.set(visual.tier2);
  } else {
    // Visual -> Code is a pure visibility change: whatever is already in the
    // TOML/CLI boxes stays exactly as-is. Populating them from Visual is a
    // separate, explicit action (see `fillCodeFromVisual`), not an automatic
    // side effect of switching modes.
    clearOutput();
    clearConfigStatus();
    clearDiff();
  }

  mode = target;
  applyModeUI();
}

/** Explicit "Fill from Visual" action: populates the TOML box with Visual's full state and
 * resets the CLI box to empty, so the merge stays unambiguous. Never lossy (Visual's coverage
 * is always a subset of what TOML can express) and never warns — the click itself is consent. */
async function fillCodeFromVisual() {
  clearOutput();
  clearConfigStatus();
  clearDiff();
  const merged = visualOptionsToRuffOptions(currentVisualOptions(), currentRulesIndex);
  replaceContent(tomlEditor, ruffOptionsToTomlText(merged));
  replaceContent(cliEditor, defaultCli);
  updateCliIgnoredNotice();
}

/** Shown for Ruff versions predating @astral-sh/ruff-wasm-web's `PositionEncoding` export (0.13.2). */
function updatePositionEncodingWarning() {
  positionEncodingWarning.style.display =
    currentEntry && !supportsUtf16PositionEncoding(currentEntry.version) ? "block" : "none";
}

async function initVersions() {
  versions = await getVersions();
  const latest = await getLatestVersion();
  const preferred = initialState ? versions.find((entry) => entry.version === initialState.version) : undefined;
  const initial = preferred ?? latest;

  labelToEntry.clear();
  versionDatalist.replaceChildren(
    ...versions.map((entry) => {
      const label = formatVersionLabel(entry, entry.version === latest.version);
      labelToEntry.set(label, entry);
      const option = document.createElement("option");
      option.value = label;
      return option;
    }),
  );
  versionInput.value = formatVersionLabel(initial, initial.version === latest.version);
  currentEntry = initial;
  updatePositionEncodingWarning();
  void loadRulesIndexFor(initial);
}

wireStateControl(versionInput, "change", () => {
  currentEntry = labelToEntry.get(versionInput.value) ?? null;
  updatePositionEncodingWarning();
  if (currentEntry) void loadRulesIndexFor(currentEntry);
});

void initVersions();

function clearOutput() {
  resultsList.replaceChildren();
  errorBanner.style.display = "none";
  errorBanner.textContent = "";
  applyLintDiagnostics(editor, []);
}

function clearConfigStatus() {
  configStatus.style.display = "none";
  configStatus.textContent = "";
  configStatus.classList.remove("parse-error");
}

function clearDiff() {
  diffEditorView?.destroy();
  diffEditorView = null;
  diffView.replaceChildren();
  diffBefore = null;
  diffAfter = null;
  pendingFormattedCode = null;
  applyButton.style.display = "none";
  formatStatus.style.display = "none";
}

/** Re-renders the diff preview from the last Format result — e.g. when the
 * collapse-unchanged toggle changes — without re-running Format. */
function showDiff() {
  if (diffBefore === null || diffAfter === null) return;
  diffEditorView?.destroy();
  diffEditorView = renderDiff(diffView, diffBefore, diffAfter, collapseUnchangedToggle.checked);
}

function showResults(diagnostics: Awaited<ReturnType<typeof checkCode>>) {
  const syntaxErrors = diagnostics.filter((d) => d.code === SYNTAX_ERROR_CODE);
  if (syntaxErrors.length > 0) {
    showError(syntaxErrors.map(formatDiagnostic).join("\n"));
    return;
  }

  renderDiagnostics(resultsList, diagnostics, editor);
  applyLintDiagnostics(editor, diagnostics);
}

function showError(error: unknown) {
  errorBanner.textContent = error instanceof Error ? error.message : String(error);
  errorBanner.style.display = "block";
}

/** The config-only, non-Ruff failure kind: TOML/CLI text that never reached Ruff. */
function showConfigParseError(message: string) {
  configStatus.textContent = `Config parse error — not run.\n${message}`;
  configStatus.classList.add("parse-error");
  configStatus.style.display = "block";
}

async function check() {
  clearOutput();
  clearConfigStatus();

  const result = currentOptionsResult();
  if (!result.ok) {
    // Config never reached Ruff — do not run, and leave everything else as
    // just cleared above.
    showConfigParseError(result.message);
    return;
  }

  if (!currentEntry) {
    showError("No Ruff version selected yet.");
    return;
  }

  try {
    // `checkCode` builds/gets the `Workspace` for these options first, so a
    // Ruff-rejected option (unknown/ill-typed field) surfaces here in the
    // red banner, same as any other Ruff failure.
    const diagnostics = await checkCode(
      editor.state.doc.toString(),
      currentEntry.version,
      currentEntry.wasmUrl,
      result.options,
    );
    showResults(diagnostics);
  } catch (error) {
    showError(error);
  }
}

async function format() {
  clearOutput();
  clearConfigStatus();
  clearDiff();

  const result = currentOptionsResult();
  if (!result.ok) {
    showConfigParseError(result.message);
    return;
  }

  if (!currentEntry) {
    showError("No Ruff version selected yet.");
    return;
  }

  const currentCode = editor.state.doc.toString();
  try {
    const formatted = await formatCode(
      currentCode,
      currentEntry.version,
      currentEntry.wasmUrl,
      result.options,
    );
    diffBefore = currentCode;
    diffAfter = formatted;
    showDiff();
    if (formatted !== currentCode) {
      pendingFormattedCode = formatted;
      applyButton.style.display = "inline";
    } else {
      // Formatting was a no-op — the input was already clean.
      formatStatus.textContent = "✓ Format OK";
      formatStatus.style.display = "block";
    }
  } catch (error) {
    // Ruff's formatter throws on code it can't parse — same red-banner path
    // as any other Ruff failure, not a broken/empty diff.
    showError(error);
  }
}

checkButton.addEventListener("click", () => {
  void check();
});

formatButton.addEventListener("click", () => {
  void format();
});

applyButton.addEventListener("click", () => {
  if (pendingFormattedCode === null) return;
  replaceContent(editor, pendingFormattedCode);
  clearDiff();
});

collapseUnchangedToggle.addEventListener("change", () => {
  showDiff();
});

copyLinkButton.addEventListener("click", () => {
  void copyLink();
});

resetButton.addEventListener("click", () => {
  void resetAll();
});

dumpStateButton.addEventListener("click", () => {
  debugOutput.textContent = JSON.stringify(getCurrentAppState(), null, 2);
  debugOutput.style.display = "block";
});

/** Wipes every edit and reverts to the same defaults a hash-less page load would show — code,
 * TOML/CLI, Visual selections, mode, and the selected version all go back to their initial
 * values, and the URL is re-synced to match. Confirms first since this discards unsaved work. */
async function resetAll() {
  if (!confirm("Reset everything to defaults? This can't be undone.")) return;

  clearOutput();
  clearConfigStatus();
  clearDiff();
  debugOutput.style.display = "none";
  debugOutput.textContent = "";

  replaceContent(editor, defaultCode);
  replaceContent(tomlEditor, defaultToml);
  replaceContent(cliEditor, defaultCli);
  updateCliIgnoredNotice();

  tier1Panel.set(EMPTY_VISUAL_OPTIONS.tier1);
  tier3Panel.set(EMPTY_VISUAL_OPTIONS.tier3);
  tier2Panel.set(EMPTY_VISUAL_OPTIONS.tier2);

  mode = "visual";
  applyModeUI();

  const latest = await getLatestVersion();
  currentEntry = latest;
  versionInput.value = formatVersionLabel(latest, true);
  updatePositionEncodingWarning();
  void loadRulesIndexFor(latest);

  await urlSync.flush();
}

async function copyLink() {
  // Flush rather than rely on the debounced sync, so the copied link never
  // lags behind an edit made just before the click.
  await urlSync.flush();
  try {
    await navigator.clipboard.writeText(location.href);
  } catch (error) {
    showError(error);
    return;
  }
  const originalLabel = copyLinkButton.textContent;
  copyLinkButton.textContent = "Copied!";
  setTimeout(() => {
    copyLinkButton.textContent = originalLabel;
  }, 1500);
}
