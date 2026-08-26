import { ruffOptionsToVisualOptions } from "../config/options";
import type { RulesIndex } from "../config/rules-data";
import type { RuffOptions } from "../config/toml-options";

/**
 * `null` if switching Code (the merged TOML+CLI `RuffOptions`) to Visual
 * mode would lose nothing; otherwise a human-readable message naming what
 * Visual mode can't yet represent, for a `confirm()`-style warning before
 * the (deliberately one-time, not live-synced) conversion discards it.
 * `rulesIndex` should be the current Ruff version's loaded rules — pass
 * `null` only if it genuinely hasn't loaded yet, which will (correctly)
 * flag any `lint` table as discarded.
 *
 * There is deliberately no Code-direction equivalent (a `visualToCodeWarning`
 * or a warning between TOML and CLI): TOML and CLI are complementary layers
 * of one merged value, not alternate views of the same one, so nothing is
 * ever discarded moving between them; and Visual's coverage is always a
 * subset of what Code can fully express (Code natively covers all of
 * `RuffOptions`, via TOML directly and via CLI's native flags + generic
 * `--config` escape hatch), so Visual→Code never loses anything either.
 */
export function optionsToVisualWarning(options: RuffOptions, rulesIndex: RulesIndex | null): string | null {
  const { extraKeys } = ruffOptionsToVisualOptions(options, rulesIndex);
  if (extraKeys.length === 0) return null;
  return `Switching to Visual mode will discard these settings, which it doesn't yet support:\n${extraKeys.join(", ")}`;
}
