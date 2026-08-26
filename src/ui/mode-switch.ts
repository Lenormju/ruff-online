import { ruffOptionsToVisualOptions } from "../config/options";
import type { RuffOptions } from "../config/toml-options";

/**
 * `null` if switching from TOML to Visual mode would lose nothing; otherwise
 * a human-readable message naming what Visual mode can't yet represent, for
 * a `confirm()`-style warning before the (deliberately one-time, not live-
 * synced) conversion discards it.
 */
export function tomlToVisualWarning(options: RuffOptions): string | null {
  const { extraKeys } = ruffOptionsToVisualOptions(options);
  if (extraKeys.length === 0) return null;
  return `Switching to Visual mode will discard these settings, which it doesn't yet support:\n${extraKeys.join(", ")}`;
}
