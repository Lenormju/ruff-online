import { describe, expect, test, vi } from "vitest";
import { EMPTY_VISUAL_OPTIONS } from "../src/config/options";
import { createUrlSync, loadInitialState } from "../src/state/app-state";
import { encodeState, type AppState } from "../src/state/url-state";

function baseState(overrides: Partial<AppState> = {}): AppState {
  return { version: "0.16.4", mode: "toml", code: "import os\n", toml: "[tool.ruff]\n", visual: EMPTY_VISUAL_OPTIONS, ...overrides };
}

describe("loadInitialState", () => {
  test("returns null for an empty hash (no state in the URL)", async () => {
    expect(await loadInitialState("")).toBeNull();
  });

  test("returns null for a bare '#' with nothing after it", async () => {
    expect(await loadInitialState("#")).toBeNull();
  });

  test("decodes a state encoded with or without the leading '#'", async () => {
    const state = baseState();
    const encoded = await encodeState(state);
    expect(await loadInitialState("#" + encoded)).toEqual(state);
    expect(await loadInitialState(encoded)).toEqual(state);
  });

  test("returns null for garbage instead of throwing", async () => {
    expect(await loadInitialState("#not-a-real-encoding")).toBeNull();
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("createUrlSync", () => {
  // Real timers throughout: `encodeState` does real stream I/O internally,
  // which doesn't play well with fake timers (they never resolve).

  test("debounces rapid notifyChange calls into a single write", async () => {
    const state = baseState({ code: "x = 1\n" });
    const onEncoded = vi.fn();
    const sync = createUrlSync(() => state, onEncoded, 60);

    sync.notifyChange();
    await sleep(25);
    sync.notifyChange();
    await sleep(25);
    sync.notifyChange();
    expect(onEncoded).not.toHaveBeenCalled();

    await sleep(100);
    expect(onEncoded).toHaveBeenCalledTimes(1);
    const [hash, exceedsSoftCap] = onEncoded.mock.calls[0]!;
    const { decodeState } = await import("../src/state/url-state");
    expect(await decodeState(hash)).toEqual(state);
    expect(exceedsSoftCap).toBe(false);
  });

  test("reflects the latest state at fire time, not the state when first scheduled", async () => {
    let current = baseState({ code: "a", toml: "" });
    const onEncoded = vi.fn();
    const sync = createUrlSync(() => current, onEncoded, 40);

    sync.notifyChange();
    current = baseState({ code: "b", toml: "" });
    await sleep(100);

    expect(onEncoded).toHaveBeenCalledTimes(1);
    const [hash] = onEncoded.mock.calls[0]!;
    const { decodeState } = await import("../src/state/url-state");
    expect(await decodeState(hash)).toEqual(current);
  });

  test("flags encodings over the soft cap via the same check as encodeState", async () => {
    const randomBytes = new Uint8Array(6000);
    crypto.getRandomValues(randomBytes);
    const state = baseState({ code: Buffer.from(randomBytes).toString("base64"), toml: "" });
    const onEncoded = vi.fn();
    const sync = createUrlSync(() => state, onEncoded, 40);

    sync.notifyChange();
    await sleep(100);

    expect(onEncoded).toHaveBeenCalledTimes(1);
    const [, exceedsSoftCap] = onEncoded.mock.calls[0]!;
    expect(exceedsSoftCap).toBe(true);
  });

  test("flush() encodes and calls back immediately, without waiting for the debounce delay", async () => {
    const state = baseState({ code: "x = 1\n", toml: "" });
    const onEncoded = vi.fn();
    const sync = createUrlSync(() => state, onEncoded, 10_000);

    await sync.flush();

    expect(onEncoded).toHaveBeenCalledTimes(1);
    const [hash] = onEncoded.mock.calls[0]!;
    const { decodeState } = await import("../src/state/url-state");
    expect(await decodeState(hash)).toEqual(state);
  });

  test("flush() cancels a pending debounced call, so it doesn't also fire later", async () => {
    const state = baseState({ code: "x = 1\n", toml: "" });
    const onEncoded = vi.fn();
    const sync = createUrlSync(() => state, onEncoded, 50);

    sync.notifyChange();
    await sync.flush();
    await sleep(100);

    expect(onEncoded).toHaveBeenCalledTimes(1);
  });

  test("flush() reflects the latest state, not a stale pending one", async () => {
    let current = baseState({ code: "a", toml: "" });
    const onEncoded = vi.fn();
    const sync = createUrlSync(() => current, onEncoded, 10_000);

    sync.notifyChange();
    current = baseState({ code: "b", toml: "" });
    await sync.flush();

    const [hash] = onEncoded.mock.calls[0]!;
    const { decodeState } = await import("../src/state/url-state");
    expect(await decodeState(hash)).toEqual(current);
  });
});
