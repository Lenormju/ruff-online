import { checkCode, SYNTAX_ERROR_CODE } from "./engine/workspace";

const codeInput = document.querySelector<HTMLTextAreaElement>("#code-input")!;
const runButton = document.querySelector<HTMLButtonElement>("#run-button")!;
const resultsList = document.querySelector<HTMLUListElement>("#results")!;
const errorBanner = document.querySelector<HTMLDivElement>("#error-banner")!;

function clearOutput() {
  resultsList.replaceChildren();
  errorBanner.style.display = "none";
  errorBanner.textContent = "";
}

function formatDiagnostic(diagnostic: Awaited<ReturnType<typeof checkCode>>[number]) {
  const { row, column } = diagnostic.start_location;
  const code = diagnostic.code ?? "?";
  return `${code} — ${diagnostic.message} (${row}:${column})`;
}

function showResults(diagnostics: Awaited<ReturnType<typeof checkCode>>) {
  const syntaxErrors = diagnostics.filter((d) => d.code === SYNTAX_ERROR_CODE);
  if (syntaxErrors.length > 0) {
    showError(syntaxErrors.map(formatDiagnostic).join("\n"));
    return;
  }

  if (diagnostics.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No issues found.";
    resultsList.append(item);
    return;
  }
  for (const diagnostic of diagnostics) {
    const item = document.createElement("li");
    item.textContent = formatDiagnostic(diagnostic);
    resultsList.append(item);
  }
}

function showError(error: unknown) {
  errorBanner.textContent = error instanceof Error ? error.message : String(error);
  errorBanner.style.display = "block";
}

async function run() {
  clearOutput();
  try {
    const diagnostics = await checkCode(codeInput.value);
    showResults(diagnostics);
  } catch (error) {
    showError(error);
  }
}

runButton.addEventListener("click", () => {
  void run();
});
