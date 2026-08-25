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

const workspaceCache = new Map<
  string,
  Promise<{ check(contents: string): Diagnostic[]; format?(contents: string): string }>
>();

async function loadWorkspace(wasmUrl: string) {
  const mod = (await import(/* @vite-ignore */ wasmUrl)) as RuffWasmModule;
  await mod.default();
  return new mod.Workspace({}, mod.PositionEncoding.Utf16);
}

function getWorkspace(version: string, wasmUrl: string) {
  let workspacePromise = workspaceCache.get(version);
  if (!workspacePromise) {
    workspacePromise = loadWorkspace(wasmUrl);
    workspaceCache.set(version, workspacePromise);
  }
  return workspacePromise;
}

export async function checkCode(
  code: string,
  version: string,
  wasmUrl: string,
): Promise<Diagnostic[]> {
  const workspace = await getWorkspace(version, wasmUrl);
  return workspace.check(code);
}
