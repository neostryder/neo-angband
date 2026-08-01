/**
 * Sections: the named parts of a mod, resolved and put in order.
 *
 * A mod used to be one atom in the load order, which made three ordinary
 * requests inexpressible - scoping a compatibility claim to part of a mod,
 * placing part of a mod higher or lower than the rest of it, and switching part
 * of a mod off. PackSection names the part; this module decides which parts are
 * ON and where each one composes.
 *
 * TWO STEPS, DELIBERATELY SEPARATE.
 *
 *  1. resolveSectionState - which sections are on, from the player's choices,
 *     the author's defaults, and any `patches` claim that makes a section
 *     conditional on another mod. Pure, and it never reads a file.
 *  2. expandSections - turn the ordered pack list into a LONGER ordered list in
 *     which each enabled section is its own entry, positioned by its band.
 *
 * The second step is why composePacks did not have to change at all. It already
 * folds a list of contributions in order and keys everything by `manifest.id`,
 * so several entries sharing one manifest compose exactly as one entry with the
 * combined contributions would - except that they can now sit at different
 * points in the sequence. Sections are therefore a pre-pass, not a new
 * composition model, and every rule composePacks enforces (a patch target must
 * exist, a pack may only modify what it depends on) applies to a section's
 * contributions unchanged.
 */

import type { FileContribution, PackContent } from "./compose.js";
import { ComposeError } from "./compose.js";
import type { PackManifest, PackSection, SectionBand } from "./manifest.js";
import { SECTION_BANDS } from "./manifest.js";
import { satisfies, SemverError } from "./semver.js";

/** Where a section sorts: earlier band index composes first. */
function bandIndex(band: SectionBand | undefined): number {
  const at = SECTION_BANDS.indexOf(band ?? "normal");
  /* An unvalidated manifest could carry anything; treat a stranger as normal
   * rather than throwing, because validateManifest is the place that refuses. */
  return at === -1 ? SECTION_BANDS.indexOf("normal") : at;
}

/** The flag name a section exposes to its mod's hooks.ts (its `flag`, else its id). */
export function sectionFlag(section: PackSection): string {
  return section.flag ?? section.id;
}

/**
 * Which sections are ON, for every pack in `manifests`.
 *
 * Resolution per section, strongest input first:
 *
 *  - a `patches` claim naming an ABSENT (or out-of-range) pack forces it OFF.
 *    That is the point of the claim: the section is a compatibility patch for
 *    that mod, so it must not apply when the mod it patches is not there. This
 *    outranks the player's choice because an "on" the player set while the other
 *    mod was installed should not silently start patching nothing.
 *  - the player's explicit choice.
 *  - the author's `default`.
 *  - on, when the author said nothing. A section is a way to switch a part OFF;
 *    a mod that declares one and says nothing else has not opted its content out.
 *
 * `enabledPackIds` is the set of packs actually being loaded, and `versions` maps
 * a pack id to its version so a claim's `range` can be checked. Both come from
 * the same resolved list the caller is about to compose.
 */
export function resolveSectionState(
  manifests: readonly PackManifest[],
  choices: Readonly<Record<string, Readonly<Record<string, boolean>>>>,
  enabledPackIds: ReadonlySet<string>,
): Map<string, Map<string, boolean>> {
  const versions = new Map(manifests.map((m) => [m.id, m.version]));
  const out = new Map<string, Map<string, boolean>>();

  for (const m of manifests) {
    const table = new Map<string, boolean>();
    out.set(m.id, table);
    if (!m.sections) continue;

    /* Section ids a `patches` claim makes conditional, mapped to whether the
     * pack they patch is present and in range. A section may be named by more
     * than one claim (a patch for either of two mods), so any satisfied claim
     * is enough. */
    const conditional = new Map<string, boolean>();
    for (const c of m.compat ?? []) {
      if (c.claim !== "patches") continue;
      const present =
        enabledPackIds.has(c.with) && inRange(versions.get(c.with), c.range);
      for (const sid of c.scope ?? []) {
        conditional.set(sid, (conditional.get(sid) ?? false) || present);
      }
    }

    for (const s of m.sections) {
      if (conditional.has(s.id) && !conditional.get(s.id)) {
        table.set(s.id, false);
        continue;
      }
      table.set(s.id, choices[m.id]?.[s.id] ?? s.default ?? true);
    }
  }
  return out;
}

/** Whether `version` satisfies `range`; an unparseable range does not restrict. */
function inRange(version: string | undefined, range: string | undefined): boolean {
  if (version === undefined) return false;
  if (range === undefined) return true;
  try {
    return satisfies(version, range);
  } catch (e) {
    /* A malformed range in a claim about someone ELSE's mod must not stop the
     * game. The claim is advisory; treat it as unrestricted and let the conflict
     * report carry the complaint. */
    if (e instanceof SemverError) return true;
    throw e;
  }
}

/** One pack's contributions at one point in the composed sequence. */
export interface SectionUnit {
  /** The pack these contributions came from. */
  packId: string;
  /** The section, or null for the pack's own unsectioned contributions. */
  sectionId: string | null;
  /** The band that positioned it. */
  band: SectionBand;
  /**
   * Set when the band had to yield to a hard requirement: this unit patches
   * records another pack owns, and it asked to compose before that pack. Names
   * the pack it was held back for. See the deferral pass in expandSections.
   */
  heldFor?: string;
  /** What composes here. */
  content: PackContent;
}

/** The pack that owns a ref ("core:kobold" -> "core"). */
function ownerOf(ref: string): string {
  const at = ref.indexOf(":");
  return at === -1 ? "" : ref.slice(0, at);
}

/**
 * Every pack whose records this contribution set touches: the owners of every
 * ref it patches, replaces, field-patches or removes.
 *
 * These are the HARD requirements on a unit's position - a record has to exist
 * before it can be patched, and it exists once its owner's own contributions
 * have composed.
 */
function targetOwners(content: PackContent): Set<string> {
  const owners = new Set<string>();
  for (const contrib of Object.values(content.files)) {
    for (const kind of ["patches", "replaces", "fieldPatches"] as const) {
      for (const ref of Object.keys(contrib[kind] ?? {})) owners.add(ownerOf(ref));
    }
    for (const ref of contrib.removes ?? []) owners.add(ownerOf(ref));
  }
  return owners;
}

/**
 * Split an ordered pack list into band-ordered units, dropping every section
 * that is off.
 *
 * THE SORT KEY is (band, the pack's load position, the section's declaration
 * order). So:
 *
 *  - every `last` section in the whole set composes after every `normal` one,
 *    whatever else is installed. That is the property a numeric offset could not
 *    have: "+1" means a different neighbour each time the list changes, while a
 *    band is absolute.
 *  - within a band the player's load order still decides, so bands refine the
 *    order rather than replacing it.
 *  - a pack's own unsectioned contributions come before its normal-band
 *    sections, which is why the base unit sorts at declaration index -1.
 *
 * A band lets an author jump the queue with THEIR OWN contributions and reach
 * nothing else, which is the authority line the compatibility model draws. The
 * conflict report names a section that won on its band, so it is never silent.
 */
export function expandSections(
  packs: readonly PackContent[],
  isOn: (packId: string, sectionId: string) => boolean,
): SectionUnit[] {
  const keyed: { key: [number, number, number]; unit: SectionUnit }[] = [];

  packs.forEach((pack, loadAt) => {
    const pid = pack.manifest.id;
    const declared = new Map((pack.manifest.sections ?? []).map((s) => [s.id, s]));

    const base: Record<string, FileContribution> = {};
    /* sectionId -> file -> that section's contribution to that file. */
    const bySection = new Map<string, Record<string, FileContribution>>();

    for (const [file, contrib] of Object.entries(pack.files)) {
      const { sections, ...rest } = contrib;
      if (Object.keys(rest).length > 0) base[file] = rest;
      for (const [sid, sub] of Object.entries(sections ?? {})) {
        if (!declared.has(sid)) {
          /* Silently composing it would attribute the contribution to the pack
           * and make the typo invisible; silently dropping it would make the
           * content vanish with no error. Refuse, and name both ids. */
          throw new ComposeError(
            `${pid}/${file}: contributes to section "${sid}", which the manifest does not declare`,
          );
        }
        if (!isOn(pid, sid)) continue;
        const table = bySection.get(sid) ?? {};
        table[file] = sub;
        bySection.set(sid, table);
      }
    }

    /* The base unit exists even when empty: a plugin-only pack still has to hold
     * its place in the sequence for the report to describe positions honestly. */
    keyed.push({
      key: [bandIndex("normal"), loadAt, -1],
      unit: {
        packId: pid,
        sectionId: null,
        band: "normal",
        content: { manifest: pack.manifest, files: base },
      },
    });

    (pack.manifest.sections ?? []).forEach((s, declAt) => {
      const files = bySection.get(s.id);
      if (!files) return; // off, or contributes no content
      const band = s.priority ?? "normal";
      keyed.push({
        key: [bandIndex(band), loadAt, declAt],
        unit: {
          packId: pid,
          sectionId: s.id,
          band,
          content: { manifest: pack.manifest, files },
        },
      });
    });
  });

  /* A total order on the triple, so the result is a pure function of the input
   * list - the same discipline resolveLoadOrder keeps, and for the same reason:
   * this order reaches the savefile's mod-set fingerprint. */
  keyed.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2]);
  return deferToOwners(keyed.map((k) => k.unit));
}

/**
 * Hold back any unit the band placed before a pack whose records it patches.
 *
 * A BAND IS A PREFERENCE AND A PATCH TARGET IS A FACT. `priority: "first"` on a
 * section that patches `core:kobold` is a coherent wish - "let everyone else
 * override my value" - and an impossible position, because the record does not
 * exist until core has composed. Left alone it does not merely mis-order: it
 * throws `fieldPatch target core:kobold does not exist` and takes the whole game
 * down over one manifest field.
 *
 * So the band yields, which is the same rule LOOT settled on for its groups -
 * soft metadata is dropped where it contradicts hard metadata, rather than
 * turning into an error neither author can fix. The unit composes at the
 * earliest legal point instead, and carries `heldFor` so the conflict report can
 * say the band did not take effect and why.
 *
 * A unit is satisfied once the BASE unit of every pack it targets has been
 * emitted; base units are all `normal` band, so they keep their load order
 * relative to one another and this pass always terminates. Units that are still
 * unsatisfied at the end are emitted in order and left to composePacks, whose
 * error names the ref - a target that never appears is a broken pack, not a
 * band that needs repairing.
 */
function deferToOwners(units: readonly SectionUnit[]): SectionUnit[] {
  const out: SectionUnit[] = [];
  const emitted = new Set<string>();
  /* Units waiting on a pack, in their band order, with what they are waiting for. */
  let waiting: { unit: SectionUnit; needs: Set<string> }[] = [];

  const unmet = (unit: SectionUnit): Set<string> => {
    const needs = new Set<string>();
    for (const owner of targetOwners(unit.content)) {
      /* Its own base unit counts: a section may patch a record its own pack
       * declares outside any section. */
      if (!emitted.has(owner)) needs.add(owner);
    }
    return needs;
  };

  /* Emit everything the just-emitted base unit unblocked, keeping band order. */
  const flush = (): void => {
    for (;;) {
      const ready = waiting.filter((w) => unmet(w.unit).size === 0);
      if (ready.length === 0) return;
      waiting = waiting.filter((w) => unmet(w.unit).size > 0);
      for (const w of ready) {
        /* The pack it was FIRST held for, not whatever is unmet now - that is
         * the one the author's band actually collided with. */
        const held = [...w.needs][0];
        out.push(held === undefined ? w.unit : { ...w.unit, heldFor: held });
      }
    }
  };

  for (const unit of units) {
    const needs = unmet(unit);
    /* A base unit always composes where it is: it creates records rather than
     * depending on them, and holding one back would deadlock its own dependents. */
    if (unit.sectionId !== null && needs.size > 0) {
      waiting.push({ unit, needs });
      continue;
    }
    out.push(unit);
    if (unit.sectionId === null) emitted.add(unit.packId);
    flush();
  }

  /* Whatever is still waiting targets a pack that never contributed a base unit.
   * composePacks names the missing ref, which is the useful error. */
  out.push(...waiting.map((w) => w.unit));
  return out;
}

/** The composable pack list for an ordered set of packs and a section state. */
export function expandedPackContents(
  packs: readonly PackContent[],
  isOn: (packId: string, sectionId: string) => boolean,
): PackContent[] {
  return expandSections(packs, isOn).map((u) => u.content);
}
