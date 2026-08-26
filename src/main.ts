import { checkCode, formatCode, SYNTAX_ERROR_CODE } from "./engine/workspace";
import { getLatestVersion, getVersions, type VersionEntry } from "./engine/versions";
import { createPythonEditor } from "./editor/python-editor";
import { createTomlEditor } from "./editor/toml-editor";
import { replaceContent } from "./editor/common";
import { tomlToOptions, type TomlOptionsResult } from "./config/toml-options";
import {
  EMPTY_VISUAL_OPTIONS,
  ruffOptionsToVisualOptions,
  visualOptionsToRuffOptions,
  visualOptionsToTomlText,
  type Mode,
} from "./config/options";
import { buildRulesIndex, loadRules, type RulesIndex } from "./config/rules-data";
import { tomlToVisualWarning } from "./ui/mode-switch";
import { createTier1Panel } from "./ui/tier1-panel";
import { createTier2Panel } from "./ui/tier2-panel";
import { createTier3Panel } from "./ui/tier3-panel";
import { formatDiagnostic, renderDiagnostics } from "./ui/diagnostics-panel";
import { renderDiff } from "./ui/diff-view";
import { createUrlSync, loadInitialState } from "./state/app-state";
import type { AppState } from "./state/url-state";

const editorContainer = document.querySelector<HTMLDivElement>("#editor-container")!;
const tomlContainer = document.querySelector<HTMLDivElement>("#toml-container")!;
const visualContainer = document.querySelector<HTMLDivElement>("#visual-container")!;
const tier1Container = document.querySelector<HTMLDivElement>("#tier1-container")!;
const tier2Container = document.querySelector<HTMLDivElement>("#tier2-container")!;
const tier3Container = document.querySelector<HTMLDivElement>("#tier3-container")!;
const modeTomlRadio = document.querySelector<HTMLInputElement>("#mode-toml")!;
const modeVisualRadio = document.querySelector<HTMLInputElement>("#mode-visual")!;
const checkButton = document.querySelector<HTMLButtonElement>("#check-button")!;
const formatButton = document.querySelector<HTMLButtonElement>("#format-button")!;
const applyButton = document.querySelector<HTMLButtonElement>("#apply-button")!;
const copyLinkButton = document.querySelector<HTMLButtonElement>("#copy-link-button")!;
const versionSelect = document.querySelector<HTMLSelectElement>("#version-select")!;
const configStatus = document.querySelector<HTMLDivElement>("#config-status")!;
const resultsList = document.querySelector<HTMLUListElement>("#results")!;
const errorBanner = document.querySelector<HTMLDivElement>("#error-banner")!;
const formatStatus = document.querySelector<HTMLDivElement>("#format-status")!;
const diffView = document.querySelector<HTMLDivElement>("#diff-view")!;
const collapseUnchangedToggle = document.querySelector<HTMLInputElement>("#collapse-unchanged-toggle")!;
const urlWarning = document.querySelector<HTMLDivElement>("#url-warning")!;

const defaultCode = "import os";
// An empty [tool.ruff] table means Ruff's defaults — nothing is silently
// already in force until Check is clicked.
const defaultToml = ["[tool.ruff]", "# line-length = 88", '# lint.select = ["E", "F"]', ""].join("\n");

// Read once, at initial load only — never re-applied on a later `hashchange`
// while the user is editing (see PLAN.md Phase 5's hard UX rule).
const initialState = await loadInitialState(location.hash);

let versions: VersionEntry[] = [];
let currentEntry: VersionEntry | null = null;
let pendingFormattedCode: string | null = null;
let diffBefore: string | null = null;
let diffAfter: string | null = null;
let diffEditorView: ReturnType<typeof renderDiff> | null = null;

// Tier 2 (rule selection) is version-dependent — unlike Tier 1/3's static
// field maps, it needs that version's `rules.json` loaded before it can
// convert to/from RuffOptions at all. `null` until the first version's
// rules finish loading (see `loadRulesIndexFor` below).
let currentRulesIndex: RulesIndex | null = null;

// Which config mode is active — TOML and Visual are never live-synced, only
// converted into each other on an explicit mode switch (see mode radios
// below), so both an editor's TOML text and the Visual panels' field values
// always exist regardless of which one is currently in force.
let mode: Mode = initialState?.mode ?? "visual";

// Reassigned once `urlSync` exists below; editors are created first since
// `getCurrentAppState` reads from them, and both directions need each other.
let notifyUrlSync: () => void = () => {};

const editor = createPythonEditor(editorContainer, initialState?.code ?? defaultCode, () => notifyUrlSync());
const tomlEditor = createTomlEditor(tomlContainer, initialState?.toml ?? defaultToml, () => notifyUrlSync());
const tier1Panel = createTier1Panel(tier1Container, initialState?.visual.tier1 ?? EMPTY_VISUAL_OPTIONS.tier1, () => notifyUrlSync());
const tier3Panel = createTier3Panel(tier3Container, initialState?.visual.tier3 ?? EMPTY_VISUAL_OPTIONS.tier3, () => notifyUrlSync());
const tier2Panel = createTier2Panel(tier2Container, initialState?.visual.tier2 ?? EMPTY_VISUAL_OPTIONS.tier2, () => notifyUrlSync());

function applyModeUI() {
  modeTomlRadio.checked = mode === "toml";
  modeVisualRadio.checked = mode === "visual";
  tomlContainer.style.display = mode === "toml" ? "block" : "none";
  visualContainer.style.display = mode === "visual" ? "block" : "none";
}
applyModeUI();

function currentVisualOptions() {
  return { tier1: tier1Panel.get(), tier3: tier3Panel.get(), tier2: tier2Panel.get() };
}

/** The options the active mode currently represents — feeds Check/Format. */
function currentOptionsResult(): TomlOptionsResult {
  if (mode === "toml") return tomlToOptions(tomlEditor.state.doc.toString());
  return { ok: true, options: visualOptionsToRuffOptions(currentVisualOptions(), currentRulesIndex), hasRuffTable: true };
}

function getCurrentAppState(): AppState {
  return {
    version: currentEntry?.version ?? "",
    mode,
    code: editor.state.doc.toString(),
    toml: tomlEditor.state.doc.toString(),
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

wireStateControl(modeTomlRadio, "change", () => switchMode("toml"));
wireStateControl(modeVisualRadio, "change", () => switchMode("visual"));

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

  if (mode === "toml" && target === "visual") {
    const result = tomlToOptions(tomlEditor.state.doc.toString());
    if (!result.ok) {
      applyModeUI(); // revert the radio to the still-active mode
      showConfigParseError(result.message);
      return;
    }
    if (!currentEntry) {
      applyModeUI();
      showError("No Ruff version selected yet.");
      return;
    }
    const rulesIndex = currentRulesIndex ?? (await loadRulesIndexFor(currentEntry));
    const warning = tomlToVisualWarning(result.options, rulesIndex);
    if (warning !== null && !confirm(`${warning}\n\nContinue?`)) {
      applyModeUI();
      return;
    }
    clearOutput();
    clearConfigStatus();
    clearDiff();
    const { visual } = ruffOptionsToVisualOptions(result.options, rulesIndex);
    tier1Panel.set(visual.tier1);
    tier3Panel.set(visual.tier3);
    tier2Panel.set(visual.tier2);
  } else {
    // Visual -> TOML is never lossy: Tier 1+2+3 together can't hold anything TOML can't express.
    clearOutput();
    clearConfigStatus();
    clearDiff();
    replaceContent(tomlEditor, visualOptionsToTomlText(currentVisualOptions(), currentRulesIndex));
  }

  mode = target;
  applyModeUI();
}

async function initVersions() {
  versions = await getVersions();
  const latest = await getLatestVersion();
  const preferred = initialState ? versions.find((entry) => entry.version === initialState.version) : undefined;
  const initial = preferred ?? latest;

  versionSelect.replaceChildren(
    ...versions.map((entry) => {
      const option = document.createElement("option");
      option.value = entry.version;
      option.textContent = entry.version;
      return option;
    }),
  );
  versionSelect.value = initial.version;
  currentEntry = initial;
  void loadRulesIndexFor(initial);
}

wireStateControl(versionSelect, "change", () => {
  currentEntry = versions.find((entry) => entry.version === versionSelect.value) ?? null;
  if (currentEntry) void loadRulesIndexFor(currentEntry);
});

void initVersions();

function clearOutput() {
  resultsList.replaceChildren();
  errorBanner.style.display = "none";
  errorBanner.textContent = "";
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
}

function showError(error: unknown) {
  errorBanner.textContent = error instanceof Error ? error.message : String(error);
  errorBanner.style.display = "block";
}

/** The config-only, non-Ruff failure kind: TOML that never reached Ruff. */
function showConfigParseError(message: string) {
  configStatus.textContent = `TOML parse error — not run.\n${message}`;
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
