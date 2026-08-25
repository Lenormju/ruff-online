import { checkCode, SYNTAX_ERROR_CODE } from "./engine/workspace";
import { getLatestVersion, getVersions, type VersionEntry } from "./engine/versions";
import { createPythonEditor } from "./editor/python-editor";
import { createTomlEditor } from "./editor/toml-editor";
import { tomlToOptions } from "./config/toml-options";
import { formatDiagnostic, renderDiagnostics } from "./ui/diagnostics-panel";

const editorContainer = document.querySelector<HTMLDivElement>("#editor-container")!;
const tomlContainer = document.querySelector<HTMLDivElement>("#toml-container")!;
const runButton = document.querySelector<HTMLButtonElement>("#run-button")!;
const versionSelect = document.querySelector<HTMLSelectElement>("#version-select")!;
const configStatus = document.querySelector<HTMLDivElement>("#config-status")!;
const resultsList = document.querySelector<HTMLUListElement>("#results")!;
const errorBanner = document.querySelector<HTMLDivElement>("#error-banner")!;

const editor = createPythonEditor(editorContainer, "import os");
// An empty [tool.ruff] table means Ruff's defaults — nothing is silently
// already in force until Run is clicked.
const tomlEditor = createTomlEditor(
  tomlContainer,
  ["[tool.ruff]", "# line-length = 88", '# lint.select = ["E", "F"]', ""].join("\n"),
);

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
  configStatus.textContent = `TOML parse error — not run.\n${message}`;
  configStatus.classList.add("parse-error");
  configStatus.style.display = "block";
}

async function run() {
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

runButton.addEventListener("click", () => {
  void run();
});
