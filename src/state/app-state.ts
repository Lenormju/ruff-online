import { decodeState, encodeState, SOFT_CAP_CHARS, type AppState } from "./url-state";

/**
 * Decodes whatever was in `location.hash` at initial page load. Takes the
 * raw hash string (with or without its leading `#`) rather than reading
 * `location` itself, so this stays unit-testable and the one-time,
 * load-only nature of the read is enforced by the caller only ever calling
 * it once — never from a `hashchange` listener.
 */
export async function loadInitialState(hash: string): Promise<AppState | null> {
  const encoded = hash.startsWith("#") ? hash.slice(1) : hash;
  if (encoded.length === 0) return null;
  return decodeState(encoded);
}

export interface UrlSync {
  /** Call after any state-affecting change (an edit, a version switch). Debounced. */
  notifyChange(): void;
}

/**
 * Debounces state changes into a single `encodeState` + callback per burst,
 * so a page full of keystrokes doesn't spam `history.replaceState`. The
 * caller owns actually writing to `location.hash` (and to any UI warning
 * for `exceedsSoftCap`) — this only decides when and with what payload.
 */
export function createUrlSync(
  getState: () => AppState,
  onEncoded: (hash: string, exceedsSoftCap: boolean) => void,
  delayMs = 500,
): UrlSync {
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    notifyChange() {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        void (async () => {
          const hash = await encodeState(getState());
          onEncoded(hash, hash.length > SOFT_CAP_CHARS);
        })();
      }, delayMs);
    },
  };
}
