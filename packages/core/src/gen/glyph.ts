/**
 * The room-template and vault GLYPH registry.
 *
 * WHY THIS IS A REGISTRY. `room_template.json` and `vault.json` have always
 * accepted a new record, so a mod could always ship a vault - but only one drawn
 * with the glyphs `build_room_template` and `build_vault` already knew, because
 * their decoders were closed `switch` statements (gen-room.c L1195, L1445,
 * L1523). A glyph the decoder does not know is silently a plain floor, so an
 * author got no error and no effect. This is the seam that makes a NEW glyph
 * mean something.
 *
 * TWO PASSES, because upstream decodes each template twice: once for terrain
 * (`terrain`) and once for the monsters, objects and inner-wall conversion that
 * must not run until the whole room's walls exist (`populate`). A handler may
 * implement either or both. The passes are separate for a reason a mod will hit
 * immediately: `countNeighbors(..., squareIsRoom, ...)` in the second pass is
 * only meaningful once the first has finished laying the room.
 *
 * ORDER AND RNG. Core's handlers are the case bodies lifted unchanged, in the
 * grid order upstream walks, so the draw sequence is identical - which is what
 * `glyph-vectors.json` exists to prove. A mod's handler draws from the same
 * `g.rng`, so it changes the stream from that grid onward. That is inherent in
 * adding behaviour to generation and is why a modded game is not seed-compatible
 * with an unmodded one.
 *
 * NOT IN HERE: the racial-monster mechanism. An alphabetic glyph in a vault
 * (other than `x`/`X`) is collected in first-appearance order and handed to
 * `get_vault_monsters` after both passes; that is a different mechanism from
 * a per-glyph handler, and `buildVault` still owns it.
 */

import type { Loc } from "../loc.js";
import type { Gen } from "./util.js";

/** Which decoder a handler belongs to. The two alphabets are separate. */
export type GlyphKind = "template" | "vault";

/** What a glyph handler is given. One object per decoded grid. */
export interface GlyphContext {
  /** The generation context: chunk, RNG, constants, dun bookkeeping. */
  readonly g: Gen;
  /** The grid this glyph landed on, AFTER the symmetry transform. */
  readonly grid: Loc;
  /** The glyph itself, so one handler can serve several characters. */
  readonly glyph: string;
  /** The template's or vault's FEW_ENTRANCES flag. */
  readonly fewEntrances: boolean;
  /**
   * Room templates only: the door position chosen for this room this build
   * (`randint1(doors)`), which the `1`-`6` glyphs compare themselves against.
   * Zero for a vault.
   */
  readonly rndDoors: number;
  /**
   * Room templates only: this build's coin flip for the optional walls, which
   * `x`, `(` and `)` consult. False for a vault.
   */
  readonly rndWalls: boolean;
  /**
   * Room templates only: the template's `tval`, which `[` places an object of.
   * Zero for a vault.
   */
  readonly tval: number;
}

/**
 * What one glyph does. Both passes are optional: `%` is terrain only, `8` in a
 * vault is populate only, `#` is both.
 */
export interface GlyphHandler {
  /**
   * First pass: terrain. The grid has already been set to FLOOR and will be
   * marked SQUARE_ROOM afterwards.
   *
   * Return `false` to leave the grid OUT of SQUARE_VAULT (upstream's `icky`
   * flag - only `%`, the outer wall, does this). Anything else, `undefined`
   * included, keeps it in. Ignored by the room-template decoder, which has no
   * such flag.
   */
  terrain?(ctx: GlyphContext): boolean | void;
  /**
   * Second pass: monsters, objects, and the inner-wall conversion that needs
   * the finished room around it.
   */
  populate?(ctx: GlyphContext): void;
}

/**
 * Glyph handlers, keyed by decoder and character. Two independent alphabets:
 * `#` means "solid granite, then maybe inner wall" in both, but `+` is a closed
 * door in a room template and a SECRET door in a vault, which is upstream's
 * behaviour and not a mistake to unify.
 */
export class GlyphRegistry {
  private readonly tables: { [K in GlyphKind]: Map<string, GlyphHandler> } = {
    template: new Map(),
    vault: new Map(),
  };

  /** Install (or replace) the handler for one glyph. */
  set(kind: GlyphKind, glyph: string, handler: GlyphHandler): void {
    if (glyph.length !== 1) {
      throw new Error(`gen: a glyph is exactly one character, got ${JSON.stringify(glyph)}`);
    }
    if (glyph === " ") {
      /* A space is "not part of this room" and is skipped before the decoder
       * is consulted, so a handler for it could never run. Refuse rather than
       * accept a registration that silently does nothing. */
      throw new Error("gen: ' ' is skipped by both decoders and cannot carry a handler");
    }
    this.tables[kind].set(glyph, handler);
  }

  /**
   * The handler installed for a glyph right now, or null. This is what a mod
   * calls to WRAP core - keep the returned handler, install its own, and call
   * through - instead of only replacing it.
   */
  handlerFor(kind: GlyphKind, glyph: string): GlyphHandler | null {
    return this.tables[kind].get(glyph) ?? null;
  }

  /** Whether anything decodes this glyph. */
  has(kind: GlyphKind, glyph: string): boolean {
    return this.tables[kind].has(glyph);
  }

  /** Every glyph this decoder knows, in registration order (core's first). */
  glyphs(kind: GlyphKind): readonly string[] {
    return [...this.tables[kind].keys()];
  }
}
