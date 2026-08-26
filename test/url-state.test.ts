import { describe, expect, test } from "vitest";
import { EMPTY_VISUAL_OPTIONS } from "../src/config/options";
import { decodeState, encodeState, SOFT_CAP_CHARS, type AppState } from "../src/state/url-state";

describe("encodeState / decodeState", () => {
  test("round-trips version, mode, code, toml, cli, and visual exactly", async () => {
    const state: AppState = {
      version: "0.16.4",
      mode: "code",
      code: "import os\n\ndef f(x):\n    return x+1\n",
      toml: '[tool.ruff]\nline-length = 100\nlint.select = ["E", "F"]\n',
      cli: "ruff check --preview\n",
      visual: EMPTY_VISUAL_OPTIONS,
    };
    const encoded = await encodeState(state);
    const decoded = await decodeState(encoded);
    expect(decoded).toEqual(state);
  });

  test("round-trips a populated visual mode + fields", async () => {
    const state: AppState = {
      version: "0.16.4",
      mode: "visual",
      code: "x = 1\n",
      toml: "[tool.ruff]\n",
      cli: "ruff check\n",
      visual: { tier1: { lineLength: 100, targetVersion: "py311" }, tier3: { quoteStyle: "single" } },
    };
    expect(await decodeState(await encodeState(state))).toEqual(state);
  });

  test("round-trips unicode content", async () => {
    const state: AppState = {
      version: "0.16.4",
      mode: "code",
      code: "# héllo wörld 你好\n",
      toml: "[tool.ruff]\n",
      cli: "ruff check\n",
      visual: EMPTY_VISUAL_OPTIONS,
    };
    const encoded = await encodeState(state);
    expect(await decodeState(encoded)).toEqual(state);
  });

  test("produces a URL-fragment-safe string (no + / = padding)", async () => {
    const encoded = await encodeState({
      version: "0.16.4",
      mode: "code",
      code: "x = 1\n",
      toml: "[tool.ruff]\n",
      cli: "ruff check\n",
      visual: EMPTY_VISUAL_OPTIONS,
    });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("returns null for garbage input instead of throwing", async () => {
    expect(await decodeState("not-valid-base64url-or-deflate!!")).toBeNull();
  });

  test("returns null when decompressed JSON doesn't match the AppState shape", async () => {
    const encoded = await encodeState({
      version: "0.16.4",
      mode: "code",
      code: "x",
      toml: "",
      cli: "",
      visual: EMPTY_VISUAL_OPTIONS,
    });
    // Corrupting a valid encoding still exercises the "parses but wrong shape"
    // path via a hand-built payload missing required fields.
    const notAppState = await encodeArbitraryJson({ version: "0.16.4" });
    expect(await decodeState(notAppState)).toBeNull();
    // sanity: the valid one still decodes
    expect(await decodeState(encoded)).not.toBeNull();
  });

  test("returns null when mode is neither 'code' nor 'visual'", async () => {
    const bogus = await encodeArbitraryJson({
      version: "0.16.4",
      mode: "toml",
      code: "",
      toml: "",
      cli: "",
      visual: EMPTY_VISUAL_OPTIONS,
    });
    expect(await decodeState(bogus)).toBeNull();
  });

  test("returns null when cli is missing", async () => {
    const bogus = await encodeArbitraryJson({
      version: "0.16.4",
      mode: "code",
      code: "",
      toml: "",
      visual: EMPTY_VISUAL_OPTIONS,
    });
    expect(await decodeState(bogus)).toBeNull();
  });

  test("returns null when visual is missing", async () => {
    const bogus = await encodeArbitraryJson({ version: "0.16.4", mode: "code", code: "", toml: "", cli: "" });
    expect(await decodeState(bogus)).toBeNull();
  });

  test("flags encodings over the soft cap", async () => {
    // Genuinely random bytes (base64-encoded to stay JSON-safe) so deflate
    // has no redundancy to exploit and can't shrink it back under the cap.
    const randomBytes = new Uint8Array(6000);
    crypto.getRandomValues(randomBytes);
    const random = Buffer.from(randomBytes).toString("base64");
    const encoded = await encodeState({
      version: "0.16.4",
      mode: "code",
      code: random,
      toml: "",
      cli: "",
      visual: EMPTY_VISUAL_OPTIONS,
    });
    expect(encoded.length).toBeGreaterThan(SOFT_CAP_CHARS);
  });

  test("stays comfortably under the soft cap for a typical small snippet", async () => {
    const encoded = await encodeState({
      version: "0.16.4",
      mode: "code",
      code: "import os\n",
      toml: "[tool.ruff]\n",
      cli: "ruff check\n",
      visual: EMPTY_VISUAL_OPTIONS,
    });
    expect(encoded.length).toBeLessThan(SOFT_CAP_CHARS);
  });
});

async function encodeArbitraryJson(value: unknown): Promise<string> {
  // Mirrors encodeState's pipeline but skips the AppState type constraint,
  // to build a payload that decodes to valid JSON of the wrong shape.
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (const byte of compressed) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
