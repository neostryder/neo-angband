import type { Effect } from "./effect.js";
import { effectMenuName, effectNext } from "./effect-info.js";
import type { EffectMenuNameDeps } from "./effect-info.js";

/** Renderer-neutral EF_SELECT menu rows (ui-effect.c L34-180). */
export interface EffectChoiceRow {
  /** 0-based sub-effect choice, or -2 for the explicit random row. */
  choice: number;
  label: string;
  random: boolean;
}

/**
 * Build the rows a host UI presents for a SELECT chain. This is data-only;
 * GlyphTerm and other renderers stay outside game/effects logic.
 */
export function effectChoiceRows(
  first: Effect | null,
  count: number,
  deps: EffectMenuNameDeps = {},
): EffectChoiceRow[] {
  const labels: string[] = [];
  let effect = first;
  for (let i = 0; effect && i < count; i++) {
    labels.push(effectMenuName(effect, deps));
    effect = effectNext(effect);
  }
  return [
    { choice: -2, label: "one of the following at random", random: true },
    ...labels.map((label, choice) => ({ choice, label, random: false })),
  ];
}
