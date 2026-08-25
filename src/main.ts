import { checkCode, SYNTAX_ERROR_CODE } from "./engine/workspace";
import { getLatestVersion, getVersions, type VersionEntry } from "./engine/versions";
import { createPythonEditor } from "./editor/python-editor";
import { formatDiagnostic, renderDiagnostics } from "./ui/diagnostics-panel";

const editorContainer = document.querySelector<HTMLDivElement>("#editor-container")!;
const runButton = document.querySelector<HTMLButtonElement>("#run-button")!;
const versionSelect = document.querySelector<HTMLSelectElement>("#version-select")!;
const resultsList = document.querySelector<HTMLUListElement>("#results")!;
const errorBanner = document.querySelector<HTMLDivElement>("#error-banner")!;

const editor = createPythonEditor(editorContainer, "import os");

let versions: VersionEntry[] = [];
let currentEntry: VersionEntry | null = null;

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
    );
    showResults(diagnostics);
  } catch (error) {
    showError(error);
  }
}

runButton.addEventListener("click", () => {
  void run();
});
