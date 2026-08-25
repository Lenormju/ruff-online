import { checkCode, getWorkspace, SYNTAX_ERROR_CODE } from "./engine/workspace";
import { getLatestVersion, getVersions, type VersionEntry } from "./engine/versions";
import { createPythonEditor } from "./editor/python-editor";
import { createTomlEditor } from "./editor/toml-editor";
import { tomlToOptions, type RuffOptions } from "./config/toml-options";
import { formatDiagnostic, renderDiagnostics } from "./ui/diagnostics-panel";

const editorContainer = document.querySelector<HTMLDivElement>("#editor-container")!;
const tomlContainer = document.querySelector<HTMLDivElement>("#toml-container")!;
const runButton = document.querySelector<HTMLButtonElement>("#run-button")!;
const applyConfigButton = document.querySelector<HTMLButtonElement>("#apply-config-button")!;
const versionSelect = document.querySelector<HTMLSelectElement>("#version-select")!;
const configStatus = document.querySelector<HTMLDivElement>("#config-status")!;
const resultsList = document.querySelector<HTMLUListElement>("#results")!;
const errorBanner = document.querySelector<HTMLDivElement>("#error-banner")!;

const editor = createPythonEditor(editorContainer, "import os");
// An empty [tool.ruff] table means Ruff's defaults, so what's shown on load
// matches `activeOptions = {}` below — nothing is silently already applied.
const tomlEditor = createTomlEditor(
  tomlContainer,
  ["[tool.ruff]", "# line-length = 88", '# lint.select = ["E", "F"]', ""].join("\n"),
);

let versions: VersionEntry[] = [];
let currentEntry: VersionEntry | null = null;

/**
 * The config actually in force. Only ever replaced by a successful Apply — a
 * malformed TOML edit must leave the previous config untouched.
 */
let activeOptions: RuffOptions = {};

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
  configStatus.textContent = `TOML parse error — config unchanged.\n${message}`;
  configStatus.classList.add("parse-error");
  configStatus.style.display = "block";
}

function showConfigApplied(message: string) {
  configStatus.textContent = message;
  configStatus.classList.remove("parse-error");
  configStatus.style.display = "block";
}

async function applyConfig() {
  clearConfigStatus();
  const result = tomlToOptions(tomlEditor.state.doc.toString());
  if (!result.ok) {
    showConfigParseError(result.message);
    return;
  }

  if (!currentEntry) {
    showConfigParseError("No Ruff version selected yet.");
    return;
  }

  // Build the Workspace now rather than at the next Run, so that options Ruff
  // itself rejects (unknown/ill-typed fields) surface immediately — and, since
  // that's a Ruff failure rather than a TOML one, in the red banner.
  clearOutput();
  try {
    await getWorkspace(currentEntry.version, currentEntry.wasmUrl, result.options);
  } catch (error) {
    showError(error);
    return;
  }

  activeOptions = result.options;
  showConfigApplied(
    result.hasRuffTable
      ? "Config applied. It will be used on the next Run."
      : "No [tool.ruff] table found — Ruff's default config will be used on the next Run.",
  );
}

async function run() {
  clearOutput();
  if (!currentEntry) {
    showError("No Ruff version selected yet.");
    return;
  }
  try {
    const diagnostics = await checkCode(
      editor.state.doc.toString(),
      currentEntry.version,
      currentEntry.wasmUrl,
      activeOptions,
    );
    showResults(diagnostics);
  } catch (error) {
    showError(error);
  }
}

runButton.addEventListener("click", () => {
  void run();
});

applyConfigButton.addEventListener("click", () => {
  void applyConfig();
});
