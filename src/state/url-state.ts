import type { Mode, VisualOptions } from "../config/options";

/**
 * `toml`, `cli`, and `visual` are all always present regardless of the
 * active `mode`. `toml`/`cli` are Code's own two complementary text boxes
 * (base config + override flags, merged at Check/Format time, never synced
 * with each other) and both persist independently of whether `mode` is
 * currently `"code"` or `"visual"`; `visual`'s snapshot is only updated by
 * an explicit Code→Visual switch or the "Fill from Visual" button.
 */
export interface AppState {
  version: string;
  mode: Mode;
  code: string;
  toml: string;
  cli: string;
  visual: VisualOptions;
}

/** Soft cap on the shareable URL's fragment length; warn, don't block — no backend fallback. */
export const SOFT_CAP_CHARS = 6000;

/**
 * Serializes app state to JSON, compresses it (`CompressionStream`, native
 * in evergreen browsers and Node 20+ — no dependency needed), and
 * base64url-encodes the result for use directly in `location.hash` with no
 * further escaping.
 *
 * If deflate's compression ratio ever stops being enough, `lz-string`
 * (~4KB) is a documented option — deliberately not added now.
 */
export async function encodeState(state: AppState): Promise<string> {
  const json = JSON.stringify(state);
  const compressed = await transform(new TextEncoder().encode(json), new CompressionStream("deflate-raw"));
  return bytesToBase64Url(compressed);
}

/** Never throws — returns `null` for anything that isn't a validly-encoded `AppState`. */
export async function decodeState(encoded: string): Promise<AppState | null> {
  try {
    const compressed = base64UrlToBytes(encoded);
    const json = new TextDecoder().decode(await transform(compressed, new DecompressionStream("deflate-raw")));
    const parsed: unknown = JSON.parse(json);
    return isAppState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isAppState(value: unknown): value is AppState {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.version === "string" &&
    (record.mode === "code" || record.mode === "visual") &&
    typeof record.code === "string" &&
    typeof record.toml === "string" &&
    typeof record.cli === "string" &&
    typeof record.visual === "object" &&
    record.visual !== null
  );
}

async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  // `bytes` is always backed by a plain (never shared) ArrayBuffer here, but
  // `Uint8Array`'s type parameter defaults to the wider `ArrayBufferLike`.
  const piped = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(encoded: string): Uint8Array {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
