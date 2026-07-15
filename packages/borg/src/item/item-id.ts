/**
 * Identification - a faithful port of the decision parts of borg-item-id.c and
 * borg_test_stuff (borg-item-wear.c:84, the "use an ID means on the best
 * unidentified item" routine, kept here with the other id logic).
 *
 * The C borg_object_fully_id inscribes IDd items with a shorthand of their
 * powers (a pure UI side effect via keypresses with no gameplay consequence and
 * no inscribe verb on the frozen act facade), so it is intentionally not ported.
 * borg_item_note_needs_id is ported as a predicate over the knowledge seams.
 */

import type { BorgContext, ItemView, AgentCommand } from "./types";
import { BI } from "../trait/trait-index";
import { TV, SVAL } from "./svals";
import type { ItemDeps } from "./deps";
import {
  trait,
  danger,
  canRest,
  isAware,
  itemValue,
  needsIdent,
} from "./deps";
import { Spell, borgSpell, borgSpellLegal } from "./magic";
import { borgReadScroll } from "./item-use";

/**
 * borg_item_note_needs_id (id.c:145): the item still has unknown runes. Without
 * the ident/inscription fields on the frozen ItemView this reduces to the
 * needsIdent seam (default false). Documented deviation.
 */
export function borgItemNoteNeedsId(item: ItemView, d?: ItemDeps): boolean {
  return needsIdent(item, d);
}

/**
 * borg_test_stuff (wear.c:84): identify the highest-value item that needs it,
 * preferring artifacts/egos, using IDENTIFY_RUNE or a scroll of Identify Rune.
 * Returns the ID command, or null.
 */
export function borgTestStuff(
  ctx: BorgContext,
  d?: ItemDeps,
  playerHas?: (flag: string) => boolean,
): AgentCommand | null {
  const freeId = borgSpellLegal(ctx, Spell.IDENTIFY_RUNE);

  /* Don't ID when SP can't be recovered immediately (wear.c:92). */
  if (trait(ctx, BI.CURSP) < 50 && freeId && !canRest(d)) return null;

  /* No ID in danger (wear.c:97). */
  if (danger(d) > 1) return null;

  let best: ItemView | null = null;
  let bestV = -1;

  /* Equipment first (wear.c:100). */
  for (const item of ctx.view.equipment()) {
    if (!item || item.number <= 0) continue;
    if (!borgItemNoteNeedsId(item, d)) continue;
    let v = 0;
    if (item.artifact) v = itemValue(item, d) + 150000;
    if (item.ego) v = itemValue(item, d) + 100000;
    if (borgItemNoteNeedsId(item, d)) v = itemValue(item, d) + 20000;
    if (!v) continue;
    if (v <= bestV) continue;
    best = item;
    bestV = v;
  }

  /* Then the pack (wear.c:137). */
  const maxDepth = trait(ctx, BI.MAXDEPTH);
  for (const item of ctx.view.inventory()) {
    if (item.number <= 0) continue;
    if (!borgItemNoteNeedsId(item, d)) continue;
    let v = 0;
    if (item.artifact) v = itemValue(item, d) + 150000;
    if (borgItemNoteNeedsId(item, d)) v = itemValue(item, d) + 20000;
    else if (freeId) v = itemValue(item, d);

    /* Reward unaware items by type (wear.c:160). */
    if (!isAware(item, d)) {
      switch (item.tval) {
        case TV.RING:
        case TV.AMULET:
          v += maxDepth * 5000;
          break;
        case TV.ROD:
          v += maxDepth * 3000;
          break;
        case TV.WAND:
        case TV.STAFF:
          v += maxDepth * 2000;
          break;
        case TV.POTION:
        case TV.SCROLL:
          if (maxDepth < 5) break;
          v += maxDepth * 500;
          break;
        case TV.FOOD:
          v += maxDepth * 10;
          break;
      }
    }
    if (!v) continue;
    if (v <= bestV) continue;
    best = item;
    bestV = v;
  }

  if (best) {
    return borgSpell(ctx, Spell.IDENTIFY_RUNE) ||
      borgReadScroll(ctx, SVAL.scroll.identify!, d);
  }
  return null;
}
