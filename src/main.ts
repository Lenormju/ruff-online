import { checkCode, SYNTAX_ERROR_CODE } from "./engine/workspace";
import { createPythonEditor } from "./editor/python-editor";
import { formatDiagnostic, renderDiagnostics } from "./ui/diagnostics-panel";

const editorContainer = document.querySelector<HTMLDivElement>("#editor-container")!;
const runButton = document.querySelector<HTMLButtonElement>("#run-button")!;
const resultsList = document.querySelector<HTMLUListElement>("#results")!;
const errorBanner = document.querySelector<HTMLDivElement>("#error-banner")!;

const editor = createPythonEditor(editorContainer, "import os");

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
  try {
    const diagnostics = await checkCode(editor.state.doc.toString());
    showResults(diagnostics);
  } catch (error) {
    showError(error);
  }
}

runButton.addEventListener("click", () => {
  void run();
});
