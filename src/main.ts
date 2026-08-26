import { checkCode, formatCode, SYNTAX_ERROR_CODE } from "./engine/workspace";
import { getLatestVersion, getVersions, type VersionEntry } from "./engine/versions";
import { createPythonEditor, replaceContent } from "./editor/python-editor";
import { createTomlEditor } from "./editor/toml-editor";
import { tomlToOptions } from "./config/toml-options";
import { formatDiagnostic, renderDiagnostics } from "./ui/diagnostics-panel";
import { renderDiff } from "./ui/diff-view";

const editorContainer = document.querySelector<HTMLDivElement>("#editor-container")!;
const tomlContainer = document.querySelector<HTMLDivElement>("#toml-container")!;
const checkButton = document.querySelector<HTMLButtonElement>("#check-button")!;
const formatButton = document.querySelector<HTMLButtonElement>("#format-button")!;
const applyButton = document.querySelector<HTMLButtonElement>("#apply-button")!;
const versionSelect = document.querySelector<HTMLSelectElement>("#version-select")!;
const configStatus = document.querySelector<HTMLDivElement>("#config-status")!;
const resultsList = document.querySelector<HTMLUListElement>("#results")!;
const errorBanner = document.querySelector<HTMLDivElement>("#error-banner")!;
const diffView = document.querySelector<HTMLDivElement>("#diff-view")!;
const collapseUnchangedToggle = document.querySelector<HTMLInputElement>("#collapse-unchanged-toggle")!;

const editor = createPythonEditor(editorContainer, "import os");
// An empty [tool.ruff] table means Ruff's defaults — nothing is silently
// already in force until Check is clicked.
const tomlEditor = createTomlEditor(
  tomlContainer,
  ["[tool.ruff]", "# line-length = 88", '# lint.select = ["E", "F"]', ""].join("\n"),
);

let versions: VersionEntry[] = [];
let currentEntry: VersionEntry | null = null;
let pendingFormattedCode: string | null = null;
let diffBefore: string | null = null;
let diffAfter: string | null = null;
let diffEditorView: ReturnType<typeof renderDiff> | null = null;

async function initVersions() {
  versions = await getVersions();
  const latest = await getLatestVersion();

  versionSelect.replaceChildren(
    ...versions.map((entry) => {
      const option = document.createElement("option");
      option.value = entry.version;
      option.textContent = entry.version;
      return option;
    }),
  );
  versionSelect.value = latest.version;
  currentEntry = latest;
}

versionSelect.addEventListener("change", () => {
  currentEntry = versions.find((entry) => entry.version === versionSelect.value) ?? null;
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

  const result = tomlToOptions(tomlEditor.state.doc.toString());
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

  const result = tomlToOptions(tomlEditor.state.doc.toString());
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
