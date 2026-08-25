const RUFF_VERSION = "0.16.4";
const CDN_URL = `https://cdn.jsdelivr.net/npm/@astral-sh/ruff-wasm-web@${RUFF_VERSION}/ruff_wasm.js`;

export interface Diagnostic {
  code: string | null;
  message: string;
  start_location: { row: number; column: number };
  end_location: { row: number; column: number };
}

/**
 * `Workspace.check()` doesn't throw on a syntax error — it returns it as a
 * regular diagnostic with this code, mixed in with real lint diagnostics.
 */
export const SYNTAX_ERROR_CODE = "invalid-syntax";

interface RuffWasmModule {
  default: () => Promise<unknown>;
  Workspace: new (options: unknown, positionEncoding: number) => {
    check(contents: string): Diagnostic[];
  };
  PositionEncoding: { Utf16: number };
}

let workspacePromise: Promise<{ check(contents: string): Diagnostic[] }> | null = null;

async function loadWorkspace() {
  const mod = (await import(/* @vite-ignore */ CDN_URL)) as RuffWasmModule;
  await mod.default();
  return new mod.Workspace({}, mod.PositionEncoding.Utf16);
}

function getWorkspace() {
  if (!workspacePromise) {
    workspacePromise = loadWorkspace();
  }
  return workspacePromise;
}

export async function checkCode(code: string): Promise<Diagnostic[]> {
  const workspace = await getWorkspace();
  return workspace.check(code);
}
