import type { RuffOptions } from "../config/toml-options";

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

interface RuffWorkspace {
  check(contents: string): Diagnostic[];
}

interface RuffWasmModule {
  default: () => Promise<unknown>;
  Workspace: new (options: RuffOptions, positionEncoding: number) => RuffWorkspace;
  PositionEncoding: { Utf16: number };
}

/**
 * Keyed by version. The multi-MB wasm module is the expensive part, so it is
 * cached independently of the (cheap) `Workspace` instances built from it.
 */
const moduleCache = new Map<string, Promise<RuffWasmModule>>();

/**
 * Keyed by version + serialized options: applying a new config must build a new
 * `Workspace`, but re-applying a previously used one should be instant.
 * Instances are never `free()`d — a `Workspace` is just resolved settings, and
 * freeing one that an in-flight `check()` still holds would be a use-after-free.
 */
const workspaceCache = new Map<string, Promise<RuffWorkspace>>();

async function loadModule(wasmUrl: string): Promise<RuffWasmModule> {
  const mod = (await import(/* @vite-ignore */ wasmUrl)) as RuffWasmModule;
  await mod.default();
  return mod;
}

function getModule(version: string, wasmUrl: string): Promise<RuffWasmModule> {
  let modulePromise = moduleCache.get(version);
  if (!modulePromise) {
    modulePromise = loadModule(wasmUrl);
    moduleCache.set(version, modulePromise);
  }
  return modulePromise;
}

/**
 * Builds (or returns the cached) `Workspace` for a version/options pair.
 *
 * Rejects if Ruff refuses the options — it validates them itself at
 * construction time, throwing on unknown or ill-typed fields.
 */
export function getWorkspace(
  version: string,
  wasmUrl: string,
  options: RuffOptions,
): Promise<RuffWorkspace> {
  const key = `${version}\n${JSON.stringify(options)}`;
  let workspacePromise = workspaceCache.get(key);
  if (!workspacePromise) {
    workspacePromise = getModule(version, wasmUrl).then(
      (mod) => new mod.Workspace(options, mod.PositionEncoding.Utf16),
    );
    // A rejected promise must not be cached, or a transient CDN failure would
    // be sticky for the rest of the session.
    workspacePromise.catch(() => workspaceCache.delete(key));
    workspaceCache.set(key, workspacePromise);
  }
  return workspacePromise;
}

export async function checkCode(
  code: string,
  version: string,
  wasmUrl: string,
  options: RuffOptions,
): Promise<Diagnostic[]> {
  const workspace = await getWorkspace(version, wasmUrl, options);
  return workspace.check(code);
}
