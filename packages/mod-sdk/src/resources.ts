/**
 * What a mod may supply BESIDES records, code and tiles - and whether the
 * machine it landed on can actually use it.
 *
 * MOD_REACH's resource census counted seven categories a total conversion would
 * need (tiles, prefs, fonts, sounds, UI strings, help, art) and found ONE of
 * them reachable by a mod that is not compiled into the app. Tiles. The other
 * six had no manifest field and no discovery, so the answer to "can a mod ship a
 * sound pack" was no in the plainest sense: there was nowhere to write it down.
 *
 * ONE ARRAY WITH A `kind`, NOT SEVEN FIELDS. `soundPacks`, `fontPacks`,
 * `helpPacks` and their siblings would each need their own validator, their own
 * discovery pass, their own merge rule and their own conflict wording - four
 * chances per category to disagree with the other six, and the seventh category
 * would arrive to find no shared shape to join. A kind on a common entry means a
 * new category is a row in RESOURCE_KINDS below and a consumer at the far end,
 * and everything between the manifest and that consumer is already written.
 *
 * TILES ARE NOT A KIND HERE, and that is deliberate rather than an oversight.
 * `tilePacks` ships, mods declare it, and it carries three fields no other
 * category has (a grafID that indexes upstream's catalog, which renderer draws
 * the pack, and the Graphics-menu label). Folding it in would either widen this
 * entry with fields meaningless to every other kind or quietly break every tiles
 * mod in existence. It stays where it is; this file covers the six that had
 * nothing.
 *
 * ## The two questions, and why only one of them lives here
 *
 * "Is this declaration well-formed?" and "can this machine use these bytes?" are
 * different questions with different answers, and only the first has a single
 * answer everywhere. A path that escapes the mod folder is wrong on every
 * machine and can be caught by reading the manifest. Whether an `.ogg` decodes
 * depends on the browser, the platform codecs, and whether the file is what its
 * extension claims - and nothing but opening it will say. So:
 *
 *   - `resourceComplaint` is here: pure, synchronous, same verdict everywhere,
 *     and callable by the mod BUILDER as well as by the game.
 *   - the runtime probe is the host's (packages/web/src/mod-resources.ts),
 *     because only the host has an `Audio` element to ask.
 *
 * Keeping them apart is what stops the static check from growing an opinion it
 * cannot support - "this codec is unsupported" is not a fact about a manifest.
 *
 * ## What a failed check costs
 *
 * The RESOURCE, never the mod. This is ratified decision 18 read through to its
 * conclusion: the engine range labels data and gates code, because data cannot
 * misbehave and code can. A resource is data of the least dangerous sort - a
 * picture, a sample, a page of text - so taking a mod's records away because its
 * splash art is a JPEG this build cannot decode would be a punishment with no
 * offence behind it.
 *
 * But nor is it merely reported, and that is the difference from the record
 * check in validate.ts. A record with a doubtful field still composes and the
 * game still reads it; a font that will not decode cannot be installed as the
 * terminal's font whatever anyone decides. The fallback is what would have
 * happened anyway, so the honest report is "this one thing is not being used,
 * and here is why" - on the mod's own row, beside everything else about it.
 */

/**
 * The resource categories a mod can supply.
 *
 * Each one has a consumer wired in this build. That is a rule and not an
 * observation: a kind the game never reads is a manifest field that does
 * nothing, which is the exact failure `engine` spent months in before anything
 * evaluated it - authors fill it in and believe it.
 *
 * `locale` was deliberately absent when this file was written, because there was
 * no i18n layer for it to be supplied INTO and the field would have been a
 * promise. It arrived with that layer (MOD_REACH gap 14), and it is the seventh
 * and last of the categories the resource census counted.
 */
export type ResourceKind = "sound" | "font" | "prefs" | "help" | "art" | "locale";

/**
 * How several mods contributing the same kind are reconciled.
 *
 * Not a detail: it is the difference between two sound packs where the player
 * gets one, and two pref files where the player gets both. Getting it wrong in
 * either direction is silent - a lost contribution or a doubled one.
 *
 *   one   a single thing exists and the LAST enabled contributor wins, which is
 *         the same rule tiles, field patches and rule flags already follow (the
 *         mod manager's "loads last, wins conflicts" row means it).
 *   all   every contribution applies, in load order. Right for pref files
 *         because a `.prf` is a list of assignments and layering them is what
 *         upstream's own pref pipeline does.
 *   slot  keyed by the entry's `slot`; last wins WITHIN a slot and different
 *         slots coexist. Right for anything with named parts - one mod may
 *         replace the splash while another adds a help page.
 */
export type ResourceMerge = "one" | "all" | "slot";

/** What one resource category is, and what a file has to look like to be it. */
export interface ResourceKindSpec {
  /** How several contributions of this kind are reconciled. */
  readonly merge: ResourceMerge;
  /**
   * True when `path` names a DIRECTORY rather than a file. A directory cannot
   * be checked by extension and cannot be probed by opening it, so the static
   * check skips both and the host verifies a sample instead.
   */
  readonly directory: boolean;
  /**
   * Extensions this kind accepts, lowercase and dotted. Empty for a directory.
   *
   * A short closed list rather than "anything the platform might manage",
   * because the point of the list is to catch the author's mistake at build
   * time - a `.mp4` declared as `art` is a typo, not a format negotiation.
   */
  readonly extensions: readonly string[];
  /** Whether an entry of this kind must name a `slot`, must not, or may. */
  readonly slot: "required" | "forbidden";
  /** One line for a message, naming what this kind is in a player's terms. */
  readonly describe: string;
}

/**
 * The registry. Adding a category is a row here plus a consumer; there is
 * nothing else to remember, which is the whole reason the kinds share a shape.
 */
export const RESOURCE_KINDS: Readonly<Record<ResourceKind, ResourceKindSpec>> = {
  sound: {
    merge: "one",
    directory: true,
    extensions: [],
    slot: "forbidden",
    describe: "a sound pack",
  },
  font: {
    /* The terminal draws from a bitmap: a glyph is a row of bit masks, one
     * number per scanline (BitmapFontData). A `.woff2` is not a thing this
     * renderer can put on a canvas cell, so accepting one would be accepting a
     * file to then refuse it at every draw. JSON in the shape the terminal
     * already takes is the honest offer, and it is an offer the game could
     * already have accepted - GlyphTerm's `bitmapFont` option has been there
     * from the start with no caller anywhere. */
    merge: "one",
    directory: false,
    extensions: [".json"],
    slot: "forbidden",
    describe: "a terminal font",
  },
  prefs: {
    merge: "all",
    directory: false,
    extensions: [".prf"],
    slot: "forbidden",
    describe: "a pref file",
  },
  help: {
    merge: "slot",
    directory: false,
    extensions: [".txt"],
    slot: "required",
    describe: "a help page",
  },
  art: {
    /* TEXT ONLY, and that is not a placeholder for images: upstream's splash IS
     * text (lib/screens/news.txt), coloured with the `{colour}...{/}` markup the
     * port paints it from, and a mod redrawing the title screen in ASCII is
     * doing the most faithful possible thing.
     *
     * `.png` was in this list while it was being written, and taking it out was
     * the right call. Nothing paints a bitmap into the title screen - the
     * terminal is a glyph grid, and blitting an image across it is front-end
     * work, not resource work. Accepting a PNG here would have meant a mod that
     * validates, loads, verifies, and then silently does nothing: a manifest
     * field with no reader, which is the failure this whole seam exists to end.
     * When a painter exists, this is one entry. */
    merge: "slot",
    directory: false,
    extensions: [".txt"],
    slot: "required",
    describe: "a piece of art",
  },
  locale: {
    /* BY SLOT, and the slot is the BCP 47 language tag. Two mods may translate
     * into two different languages and both must survive - which "one" would
     * not allow - while two translations OF THE SAME language are a genuine
     * contest the player's load order should settle, which "all" would not.
     *
     * WHAT THIS FILE CAN AND CANNOT CARRY. It is JSON, so it carries DATA: a
     * tag, the language's own name, direction, and a message catalogue in ICU
     * shape - which is more than a string table, because ICU plurals resolve
     * through `Intl.PluralRules` and a Polish catalogue gets `few` and `many`
     * without core knowing what those are.
     *
     * What it cannot carry is a FUNCTION, and some languages need one: Angband
     * assembles an object's name from a pattern ("& Scroll~ titled #") by rules
     * that are English's, and a Japanese counter or a German case ending is not
     * reachable by substituting words. A translation that needs that ships a
     * `plugin.js` and calls core's `registerLocale` with its own `forms` - the
     * ordinary code path, with the ordinary consent, because it IS code. The
     * two halves compose: the JSON gives the messages and the plugin gives the
     * grammar. See packages/core/src/i18n/i18n.ts. */
    merge: "slot",
    directory: false,
    extensions: [".json"],
    slot: "required",
    describe: "a translation",
  },
};

/** Every kind, in a fixed order, for messages and for tests that sweep them. */
export const RESOURCE_KIND_NAMES: readonly ResourceKind[] = Object.keys(
  RESOURCE_KINDS,
) as ResourceKind[];

/**
 * The art slots the game paints, and therefore the only ones a mod can fill.
 *
 * A CLOSED list, unlike help's, and the asymmetry is the point. A help page is
 * a row in a menu, so a slot nobody knows is simply a new page and the player
 * can read it. A piece of art is painted by a specific screen at a specific
 * size; art for a slot no screen paints is bytes that will never be drawn, and
 * telling the author so at build time is better than their discovering it by
 * staring at an unchanged title screen.
 */
export const ART_SLOTS: readonly string[] = ["splash"];

/** One resource a mod's manifest declares. */
export interface PackResource {
  /** Which category this is; see RESOURCE_KINDS. */
  kind: ResourceKind;
  /**
   * The file (or, for a `sound` pack, the directory) INSIDE THE MOD FOLDER.
   *
   * Mod-relative for the same reason `tilePacks[].path` is: a mod cannot know
   * where a host serves it from, and two of the three sources serve it from
   * nowhere a path could name - a folder the player picked has no URL until its
   * bytes are wrapped in a `blob:`, and a mod installed from a repository lives
   * in IndexedDB. The host composes this with the mod's own asset resolver.
   */
  path: string;
  /**
   * Which named part this fills, for the kinds that have parts: an ART_SLOTS
   * entry, or a help page's id (an id core already uses replaces that page; any
   * other adds one).
   */
  slot?: string;
  /**
   * The label a player sees where this resource is chosen or listed. Optional;
   * the host falls back to the mod's own name, which is the useful default
   * because "whose sound pack is this" is the question being asked.
   */
  name?: string;
}

/**
 * What is wrong with this declaration, or null if nothing is - the STATIC half
 * of the check, and the half whose answer is the same on every machine.
 *
 * Returns prose rather than a code because every caller wants the sentence: the
 * manifest validator throws it, the builder prints it, and the game puts it on
 * the mod's row. A code would mean three places spelling out the same wording.
 *
 * `id` is only used to name the mod in the message, so a caller with nothing
 * better can pass the path.
 */
export function resourceComplaint(value: unknown, id: string): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return `manifest ${id}: each resources entry must be an object`;
  }
  const r = value as Record<string, unknown>;

  const kind = r["kind"];
  if (typeof kind !== "string" || !(kind in RESOURCE_KINDS)) {
    return (
      `manifest ${id}: resources kind must be one of ` +
      `${RESOURCE_KIND_NAMES.join(", ")}, got ${JSON.stringify(kind)}`
    );
  }
  const spec = RESOURCE_KINDS[kind as ResourceKind];

  const path = r["path"];
  if (typeof path !== "string" || path.trim() === "") {
    return `manifest ${id}: resources ${kind} needs a path inside the mod folder`;
  }
  const pathFault = pathComplaint(path, id, kind);
  if (pathFault !== null) return pathFault;

  if (!spec.directory) {
    const ext = extensionOf(path);
    if (!spec.extensions.includes(ext)) {
      return (
        `manifest ${id}: resources ${kind} "${path}" must be one of ` +
        `${spec.extensions.join(", ")}, not ${ext === "" ? "an extensionless file" : ext}`
      );
    }
    /* A TOP-LEVEL `.json` IS A RECORD CONTRIBUTION, not a resource, and the two
     * rules are decided in different files by different code: sortPackFiles
     * sorts a pack's files by path shape alone and has never heard of this
     * array. A font declared as `font.json` would be handed to the record
     * composer, which would look for a content file by that name, find none,
     * and say nothing - so the mod would appear to load and have no font. The
     * collision is real, it is silent, and one subdirectory removes it. */
    if (ext === ".json" && !path.includes("/")) {
      return (
        `manifest ${id}: resources ${kind} "${path}" must sit in a subdirectory - ` +
        `a top-level .json is read as a record contribution, not as a resource`
      );
    }
  }

  const slot = r["slot"];
  if (spec.slot === "required") {
    if (typeof slot !== "string" || slot.trim() === "") {
      return `manifest ${id}: resources ${kind} "${path}" must name a slot`;
    }
    if (kind === "art" && !ART_SLOTS.includes(slot)) {
      return (
        `manifest ${id}: resources art slot ${JSON.stringify(slot)} is not one this ` +
        `game paints - the slots are ${ART_SLOTS.join(", ")}`
      );
    }
  } else if (slot !== undefined) {
    /* REFUSED rather than ignored. A slot on a kind that has no slots is an
     * author believing something about how their resource will be used, and
     * dropping the key silently is how that belief survives to ship. */
    return (
      `manifest ${id}: resources ${kind} "${path}" takes no slot ` +
      `(${spec.describe} has no named parts)`
    );
  }

  if (r["name"] !== undefined && typeof r["name"] !== "string") {
    return `manifest ${id}: resources ${kind} "${path}" name must be a string`;
  }
  return null;
}

/** The lowercase dotted extension of a path, or "" when it has none. */
export function extensionOf(path: string): string {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  return dot > slash ? path.slice(dot).toLowerCase() : "";
}

/**
 * A path that leaves the mod folder, or is not mod-relative at all.
 *
 * The same three refusals `tilePacks` makes, for the same reason and in the same
 * order: a site-or-scheme-absolute path is a mod claiming to know where it is
 * served from, a backslash is a Windows path that will not survive a URL, and a
 * `..` segment is a mod reaching for its neighbour's files or the host's.
 */
function pathComplaint(path: string, id: string, kind: string): string | null {
  if (/^([a-z][a-z0-9+.-]*:)?\//iu.test(path) || path.startsWith("\\")) {
    return (
      `manifest ${id}: resources ${kind} path "${path}" must be relative to the ` +
      `mod folder, not a site or absolute path`
    );
  }
  if (path.split(/[/\\]/u).includes("..")) {
    return `manifest ${id}: resources ${kind} path "${path}" must stay inside the mod folder`;
  }
  return null;
}

/** One mod's declaration of one resource, with the mod it came from. */
export interface ContributedResource {
  readonly modId: string;
  readonly resource: PackResource;
}

/**
 * Reconcile every enabled mod's resources into the set the game will use, by
 * each kind's own merge rule (see ResourceMerge).
 *
 * `contributions` must arrive in LOAD ORDER, because two of the three rules are
 * about which contribution is last. Pure, so the arbitration is testable without
 * a mods folder, a browser, or any bytes at all - which matters, since a losing
 * contribution is invisible by construction and only a test can see it.
 *
 * The losers come back too, in `shadowed`. They are what the conflict report is
 * for: two mods contesting a sound pack used to be the sort of thing a player
 * discovers by noticing that the mod they installed does nothing.
 */
export function chooseResources(contributions: readonly ContributedResource[]): {
  chosen: ContributedResource[];
  shadowed: ContributedResource[];
} {
  const chosen: ContributedResource[] = [];
  const shadowed: ContributedResource[] = [];
  /* Position of the current winner for each arbitrated key, so a later winner
   * REPLACES it in place rather than being appended. Holding position keeps a
   * list the player sees (help pages, in menu order) from reshuffling when they
   * reorder mods; only which contribution fills the row changes, which is the
   * rule tiles settled on for exactly the same reason. */
  const at = new Map<string, number>();
  for (const contribution of contributions) {
    const spec = RESOURCE_KINDS[contribution.resource.kind];
    if (spec.merge === "all") {
      chosen.push(contribution);
      continue;
    }
    const key =
      spec.merge === "slot"
        ? `${contribution.resource.kind}\u0000${contribution.resource.slot ?? ""}`
        : contribution.resource.kind;
    const seen = at.get(key);
    if (seen === undefined) {
      at.set(key, chosen.length);
      chosen.push(contribution);
    } else {
      const loser = chosen[seen];
      if (loser !== undefined) shadowed.push(loser);
      chosen[seen] = contribution;
    }
  }
  return { chosen, shadowed };
}

/** Everything of one kind in the chosen set, in order. */
export function resourcesOfKind(
  chosen: readonly ContributedResource[],
  kind: ResourceKind,
): ContributedResource[] {
  return chosen.filter((c) => c.resource.kind === kind);
}

/**
 * What is wrong with a locale file's CONTENTS, or null when nothing is.
 *
 * Separate from `resourceComplaint`, which judges the declaration: this one
 * opens the file. It lives here rather than in the host because the mod BUILDER
 * has to be able to run it too - a translator should learn that their tag is
 * missing at build time, not from a player's bug report - and because the shape
 * it checks is the shape core's `registerLocale` takes, so there is one
 * description of a locale file and not two.
 *
 * NOT a check that the translation is any GOOD, and not a check that every id
 * is covered. A half-finished translation is the normal state of every
 * translation that has ever existed, and the fallback chain is built so that a
 * missing id shows English rather than a blank - so refusing a partial
 * catalogue would refuse the working case.
 */
export function localeFileComplaint(value: unknown, path: string): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return `locale "${path}" is not a JSON object`;
  }
  const b = value as Record<string, unknown>;
  const tag = b["tag"];
  if (typeof tag !== "string" || !/^[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8})*$/u.test(tag)) {
    return (
      `locale "${path}" needs a "tag" that is a language tag ` +
      `(BCP 47: "de", "pt-BR", "zh-Hans"), got ${JSON.stringify(tag)}`
    );
  }
  if (b["name"] !== undefined && typeof b["name"] !== "string") {
    return `locale "${path}" name must be a string - the language's name in that language`;
  }
  if (b["rtl"] !== undefined && typeof b["rtl"] !== "boolean") {
    return `locale "${path}" rtl must be true or false`;
  }
  const messages = b["messages"];
  if (messages === undefined) return null;
  if (typeof messages !== "object" || messages === null || Array.isArray(messages)) {
    return `locale "${path}" messages must be an object of id -> pattern`;
  }
  for (const [id, pattern] of Object.entries(messages)) {
    if (typeof pattern !== "string") {
      return `locale "${path}" message ${JSON.stringify(id)} must be a string`;
    }
  }
  return null;
}

/**
 * The language tag a locale file declares, or null when it declares none.
 *
 * The declaration's `slot` and the FILE's `tag` are two statements of the same
 * fact, and they can disagree - which is worth catching, because the slot is
 * what arbitrates between two mods and the tag is what the game switches to. A
 * file saying `de` behind a slot saying `fr` would be listed as French and read
 * as German.
 */
export function localeFileTag(value: unknown): string | null {
  const tag = (value as { tag?: unknown } | null)?.tag;
  return typeof tag === "string" ? tag : null;
}
