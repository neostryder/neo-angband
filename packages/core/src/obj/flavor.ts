/**
 * Flavour assignment, ported from reference/src/obj-util.c (Angband 4.2.6):
 * flavor_init and its helpers flavor_assign_fixed, flavor_assign_random and
 * flavor_reset_fixed, plus the scroll-title generation loop.
 *
 * The "colour / metal / type" of a flavoured object (rings, amulets, staves,
 * wands, rods, mushrooms, potions, scrolls) is picked randomly per game, from
 * a seed (seed_flavor) so it stays stable across a save/reload. Upstream this
 * mutates the shared object_kind template (kind->flavor) and the flavour
 * records (flavor->sval); the port keeps ObjRegistry immutable and reusable
 * across games (mirroring FlavorKnowledge), so flavorInit builds a separate
 * per-game FlavorAssignment map keyed by kind index instead of mutating the
 * bound records.
 *
 * The one gameplay-visible effect folded in here is the aware-marking of
 * non-flavoured ordinary kinds (L233-246): a kind with no flavour is known on
 * sight, which is why food, torches, weapons, etc. always read by their real
 * name. That is written into the per-game FlavorKnowledge.
 */

import { TV } from "../generated";
import { Rng } from "../rng";
import type { FlavorKnowledge } from "./knowledge";
import { buildProb, randnameMake, type NameProbs } from "./randname";
import type { Flavor, ObjectKind } from "./types";
import { tvalCanHaveFlavor } from "./object";

/** SV_UNKNOWN (obj-tval.h L27): a flavour not yet bound to a specific sval. */
const SV_UNKNOWN = 0;

/** MAX_TITLES (obj-util.h L23): the number of scroll titles generated. */
const MAX_TITLES = 50;

/** sizeof(scroll_adj[0]) (obj-util.c L56): title buffer width, incl. quotes. */
const SCROLL_ADJ_LEN = 18;

/** RANDNAME_SCROLL (randname.h L27): the scroll-title corpus section. */
const RANDNAME_SCROLL = 2;

/** The flavour resolved for one kind: its text (adjective / title) and glyph. */
export interface AssignedFlavor {
  fidx: number;
  /** flavor->text: the "Smoky" adjective, or a scroll's random title. */
  text: string;
  /** flavor->d_attr: the display colour name for the flavoured glyph. */
  attr: string;
  /** flavor->d_char: the display glyph. */
  char: string;
}

/**
 * The per-game outcome of flavor_init: which flavour each flavoured kind was
 * assigned. Reads exactly where upstream reads obj->kind->flavor.
 */
export class FlavorAssignment {
  private readonly byKind = new Map<number, AssignedFlavor>();

  /** Assign (or overwrite) a kind's flavour. */
  set(kidx: number, flavor: AssignedFlavor): void {
    this.byKind.set(kidx, flavor);
  }

  /** obj->kind->flavor != NULL: does this kind carry an assigned flavour? */
  hasFlavor(kind: ObjectKind): boolean {
    return this.byKind.has(kind.kidx);
  }

  /** obj->kind->flavor->text, or "" when the kind has no flavour. */
  text(kind: ObjectKind): string {
    return this.byKind.get(kind.kidx)?.text ?? "";
  }

  /** obj->kind->flavor->d_attr, or "" when the kind has no flavour. */
  attr(kind: ObjectKind): string {
    return this.byKind.get(kind.kidx)?.attr ?? "";
  }

  /** The full record for a kind, or undefined when unassigned. */
  get(kind: ObjectKind): AssignedFlavor | undefined {
    return this.byKind.get(kind.kidx);
  }

  /** A JSON-safe [kidx, fidx] snapshot, for diagnostics/tests (not the save). */
  snapshot(): Array<[number, number]> {
    return Array.from(this.byKind, ([kidx, f]) => [kidx, f.fidx]);
  }
}

/** Inputs to flavorInit. Kinds must be in kidx order, flavours in file order. */
export interface FlavorInitDeps {
  kinds: readonly ObjectKind[];
  flavors: readonly Flavor[];
  ordinaryKindCount: number;
  /** RANDNAME sections, keyed by section index (2 = scroll titles). */
  nameSections: ReadonlyMap<number, readonly string[]>;
  /** OPT(player, birth_randarts): scrub fixed flavours (except the One Ring). */
  birthRandarts?: boolean;
}

/** A flavour plus its working, per-init sval (a local copy, not the record). */
interface WorkFlavor {
  flavor: Flavor;
  sval: number;
}

/**
 * flavor_init (obj-util.c L154): assign a flavour to every flavoured kind and
 * mark the non-flavoured ordinary kinds aware. Deterministic in `seed` (the
 * upstream seed_flavor + Rand_quick trick), so a reload with the same seed
 * reproduces the same colours and titles.
 */
export function flavorInit(
  seed: number,
  awareness: FlavorKnowledge,
  deps: FlavorInitDeps,
): FlavorAssignment {
  const assignment = new FlavorAssignment();

  /* Rand_quick = true; Rand_value = seed_flavor (L158-162). */
  const rng = new Rng(seed, { quick: true });

  /* Working copies of the flavour svals so the bound records stay immutable.
   * Fixed flavours start with their real sval; random ones start UNKNOWN. */
  const work: WorkFlavor[] = deps.flavors.map((flavor) => ({
    flavor,
    sval: flavor.sval,
  }));

  /* flavor_reset_fixed (L121): for randarts, scrub every fixed sval except the
   * One Ring ("Plain Gold"), so standard fixed flavours are not predictable. */
  if (deps.birthRandarts) {
    for (const w of work) {
      if (w.flavor.tval === TV.RING && w.flavor.text.includes("Plain Gold")) {
        continue;
      }
      w.sval = SV_UNKNOWN;
    }
  }

  const assign = (kidx: number, w: WorkFlavor, text: string): void => {
    assignment.set(kidx, {
      fidx: w.flavor.fidx,
      text,
      attr: w.flavor.dAttr,
      char: w.flavor.dChar,
    });
  };

  /* flavor_assign_fixed (L58): bind each flavour that names a specific sval to
   * every kind of that tval/sval. */
  for (const w of work) {
    if (w.sval === SV_UNKNOWN) continue;
    for (const kind of deps.kinds) {
      if (kind.tval === w.flavor.tval && kind.sval === w.sval) {
        assign(kind.kidx, w, w.flavor.text);
      }
    }
  }

  /* flavor_assign_random (L76): give each still-unflavoured kind of `tval` a
   * random one of that tval's still-unassigned flavours. Iterating kinds in
   * kidx order and flavours in file order reproduces the upstream draw order.
   * `titleFor` supplies the scroll title (flavour text) when relevant. */
  const assignRandom = (
    tval: number,
    titleFor?: (sval: number) => string,
  ): void => {
    let flavorCount = 0;
    for (const w of work) {
      if (w.flavor.tval === tval && w.sval === SV_UNKNOWN) flavorCount++;
    }
    for (const kind of deps.kinds) {
      if (kind.tval !== tval || assignment.hasFlavor(kind)) continue;
      if (flavorCount === 0) {
        throw new Error(`flavor_init: not enough flavors for tval ${tval}`);
      }
      let choice = rng.randint0(flavorCount);
      for (const w of work) {
        if (w.flavor.tval !== tval || w.sval !== SV_UNKNOWN) continue;
        if (choice === 0) {
          w.sval = kind.sval;
          const text = titleFor ? titleFor(kind.sval) : w.flavor.text;
          assign(kind.kidx, w, text);
          flavorCount--;
          break;
        }
        choice--;
      }
    }
  };

  assignRandom(TV.RING);
  assignRandom(TV.AMULET);
  assignRandom(TV.STAFF);
  assignRandom(TV.WAND);
  assignRandom(TV.ROD);
  assignRandom(TV.MUSHROOM);
  assignRandom(TV.POTION);

  /* Scroll titles (L193-227): generate MAX_TITLES unique random titles, then
   * assign scroll flavours with scroll_adj[sval] as their text. A pack that
   * ships no names corpus (nameSections empty) has no words to build from, so
   * titles are skipped and unaware scrolls fall back to the plain base form -
   * randnameMake could never satisfy its min-length/vowel test on an empty
   * corpus, so it must not be called. */
  const scrollWords = deps.nameSections.get(RANDNAME_SCROLL) ?? [];
  const scrollAdj: string[] = [];
  if (scrollWords.length > 0) {
    const scrollProbs: NameProbs = buildProb(scrollWords);
    const cap = SCROLL_ADJ_LEN - 3; // titlelen must stay below this
    for (let i = 0; i < MAX_TITLES; i++) {
      const words: string[] = [];
      let titlelen = 0;
      let word = randnameMake(rng, 2, 8, scrollProbs);
      while (titlelen + word.length < cap) {
        words.push(word);
        titlelen += word.length + 1;
        /* The final word (drawn when the loop exits) is discarded, but the draw
         * still happens - faithful to the upstream buffer bookkeeping. */
        word = randnameMake(rng, 2, 8, scrollProbs);
      }
      const title = `"${words.join(" ")}"`;
      if (scrollAdj.includes(title)) {
        i--; // collision: have another go (L223-225)
        continue;
      }
      scrollAdj[i] = title;
    }
  }
  assignRandom(TV.SCROLL, (sval) => scrollAdj[sval] ?? "");

  /* Rand_quick = false (L230). The port's Rng is per-instance, so nothing to
   * restore - the game stream is untouched by this local quick RNG. */

  /* Aware-marking (L232-246): a non-flavoured ordinary kind is known on sight.
   * Empty kinds (no name) and INSTA_ART dummies (kidx >= ordinary_kind_max)
   * are skipped. */
  for (const kind of deps.kinds) {
    if (!kind.name) continue;
    if (!assignment.hasFlavor(kind) && kind.kidx < deps.ordinaryKindCount) {
      awareness.setAware(kind);
    }
  }

  return assignment;
}
