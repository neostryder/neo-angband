/**
 * Per-level fact derivation - a faithful port of borg_near_monster_type
 * (reference/src/borg/borg-flow-kill.c:2687) plus the Morgoth / breeder / vault
 * level-fact bookkeeping that borg_update maintains
 * (reference/src/borg/borg-update.c:2201-2384, 1352-1373).
 *
 * These set the load-bearing world facts the danger, flow and think ladders
 * read: scaryGuyOnLevel, uniqueOnLevel, morgothOnLevel, breederLevel, and the
 * fight-time flags borg_fighting_unique / _summoner / _evil_unique and the
 * anti-summon summoner index (kills.summoner).
 *
 * FIDELITY NOTE. The C reads r_info[kill->r_idx] directly (name + RF_/RSF_
 * flags), which is always available. The frozen AgentView exposes a monster's
 * race name and RF_/RSF_ flags only while it is VISIBLE (MonsterView), so the
 * name-based "scary guy" table below applies to currently-perceived monsters -
 * exactly the fog-of-war the port preserves. Tracked-but-unseen monsters keep
 * their record (and expire on the 2000-turn clock) but do not re-trigger the
 * name table until seen again. Inject a real monster-race resolver (createBorg
 * resolveMonsterFacts) to widen flag-based facts to unseen monsters.
 */

import type { BorgContext } from "./context";
import { BI } from "./trait";
import { getFightState } from "./fight";
import { getDangerGlobals } from "./danger";
import { CLASS_MAGE, CLASS_PRIEST } from "./trait";

/** Case-insensitive prefix test (prefix_i in the C). */
function prefixI(name: string, pfx: string): boolean {
  return name.toLowerCase().startsWith(pfx.toLowerCase());
}

/** Case-insensitive substring test (my_stristr in the C). */
function stristr(name: string, needle: string): boolean {
  return name.toLowerCase().includes(needle.toLowerCase());
}

/** The RSF_S_* summon spell-flag names that mark a monster as a summoner. */
const SUMMON_FLAGS: readonly string[] = [
  "S_KIN",
  "S_HI_DEMON",
  "S_MONSTER",
  "S_MONSTERS",
  "S_ANIMAL",
  "S_SPIDER",
  "S_HOUND",
  "S_HYDRA",
  "S_AINU",
  "S_DEMON",
  "S_UNDEAD",
  "S_DRAGON",
  "S_HI_DRAGON",
  "S_HI_UNDEAD",
  "S_WRAITH",
  "S_UNIQUE",
];

/** A monster's spellFlags carry any summon flag (RSF_S_*). */
function isSummoner(spellFlags: readonly string[]): boolean {
  for (const f of spellFlags) if (SUMMON_FLAGS.includes(f)) return true;
  return false;
}

/**
 * borg_near_monster_type: scan tracked monsters within `dist` and set the
 * level's scary-guy / unique / summoner facts (borg-flow-kill.c:2687).
 *
 * Faithful ordering: scary-guy tests run before the distance filter (they are
 * "on level", not "near me"); unique / summoner tests run after it.
 */
export function borgNearMonsterType(ctx: BorgContext, dist: number): void {
  const w = ctx.world;
  const t = w.self.trait;
  const fight = getFightState(w);
  const danger = getDangerGlobals(w);

  /* reset the borg flags (borg-flow-kill.c:2696) */
  fight.fightingSummoner = false;
  fight.fightingUnique = 0;
  fight.fightingEvilUnique = false;
  w.kills.summoner = 0;

  /* Index the visible monsters by game m_idx for name/flag lookup. */
  const byId = new Map<
    number,
    { race: string; raceFlags: string[]; spellFlags: string[] }
  >();
  for (const m of ctx.view.monsters()) {
    if (!m.visible) continue;
    byId.set(m.id, {
      race: m.race,
      raceFlags: m.raceFlags,
      spellFlags: m.spellFlags,
    });
  }

  const clevel = t[BI.CLEVEL] ?? 0;
  const cls = t[BI.CLASS] ?? 0;
  const cdepth = t[BI.CDEPTH] ?? 0;
  const px = w.self.c.x;
  const py = w.self.c.y;

  let breederCount = 0;
  let morgoth = false;

  for (const [i, kill] of w.kills.entries()) {
    const info = byId.get(kill.mIdx);
    if (!info) continue; /* unseen this tick: name/flags unavailable (fog-of-war) */
    const name = info.race;
    const rflags = info.raceFlags;
    const has = (f: string): boolean => rflags.includes(f);

    /* Count breeders (borg-flow-kill.c:2716). */
    if (has("MULTIPLY")) breederCount += 1;

    /*** Scary Guys (before the distance filter) ***/
    if (clevel <= 5 && prefixI(name, "squint")) w.facts.scaryGuyOnLevel = true;
    if (
      clevel <= 6 &&
      (cls === CLASS_MAGE || cls === CLASS_PRIEST) &&
      prefixI(name, "squint")
    )
      w.facts.scaryGuyOnLevel = true;
    if (
      clevel <= 5 &&
      (prefixI(name, "Grip") ||
        prefixI(name, "Fang") ||
        prefixI(name, "small kobold"))
    )
      w.facts.scaryGuyOnLevel = true;
    if (
      clevel <= 8 &&
      (prefixI(name, "soldier") ||
        prefixI(name, "cutpurse") ||
        prefixI(name, "acolyte") ||
        prefixI(name, "apprentice") ||
        prefixI(name, "kobold") ||
        prefixI(name, "jackal") ||
        prefixI(name, "shrieker") ||
        prefixI(name, "Farmer Maggot") ||
        prefixI(name, "filthy street urchin") ||
        prefixI(name, "battle-scarred veteran") ||
        prefixI(name, "mean-looking mercenary"))
    )
      w.facts.scaryGuyOnLevel = true;
    if (
      clevel <= 15 &&
      (prefixI(name, "Bullroarer") ||
        ((prefixI(name, "giant white mouse") ||
          prefixI(name, "white worm mass") ||
          prefixI(name, "green worm mass")) &&
          breederCount >= clevel))
    )
      w.facts.scaryGuyOnLevel = true;
    if (
      clevel <= 20 &&
      (prefixI(name, "cave spider") ||
        prefixI(name, "red naga") ||
        prefixI(name, "giant red frog") ||
        prefixI(name, "radiation eye") ||
        (prefixI(name, "yellow worm mass") && breederCount >= clevel))
    )
      w.facts.scaryGuyOnLevel = true;
    if (
      clevel < 45 &&
      (prefixI(name, "gravity") ||
        prefixI(name, "inertia") ||
        prefixI(name, "ancient dragon") ||
        prefixI(name, "Beorn") ||
        prefixI(name, "dread"))
    )
      w.facts.scaryGuyOnLevel = true;
    /* Nether breath is bad (borg-flow-kill.c:2784). */
    if (
      !(t[BI.SRNTHR] ?? 0) &&
      (prefixI(name, "Oss") ||
        prefixI(name, "dracolich") ||
        prefixI(name, "dracolisk"))
    )
      w.facts.scaryGuyOnLevel = true;
    /* Blindness is really bad. */
    if (
      !(t[BI.SRBLIND] ?? 0) &&
      ((prefixI(name, "light hound") && !(t[BI.SRLITE] ?? 0)) ||
        (prefixI(name, "dark hound") && !(t[BI.SRDARK] ?? 0)))
    )
      w.facts.scaryGuyOnLevel = true;
    /* Chaos and Confusion are really bad. */
    if (!(t[BI.SRKAOS] ?? 0) && !(t[BI.SRCONF] ?? 0) && stristr(name, "chaos"))
      w.facts.scaryGuyOnLevel = true;
    if (
      !(t[BI.SRCONF] ?? 0) &&
      (prefixI(name, "pukelman") || prefixI(name, "night mare"))
    )
      w.facts.scaryGuyOnLevel = true;
    /* Poison is really bad. */
    if (!(t[BI.RPOIS] ?? 0) && prefixI(name, "drolem"))
      w.facts.scaryGuyOnLevel = true;

    /* Distance filter (borg-flow-kill.c:2812). */
    const ax = Math.abs(kill.pos.x - px);
    const ay = Math.abs(kill.pos.y - py);
    const d = Math.max(ax, ay);
    if (d > dist && cdepth) continue;

    /*** Uniques ***/
    if (has("UNIQUE")) {
      w.facts.uniqueOnLevel = kill.rIdx;
      if (has("QUESTOR")) fight.fightingUnique += 10;
      fight.fightingUnique += 1;
      if (has("EVIL")) fight.fightingEvilUnique = true;
      if (prefixI(name, "Morgoth")) morgoth = true;
    }

    /*** Summoners ***/
    if (isSummoner(info.spellFlags)) {
      fight.fightingSummoner = true;
      if (d < 8) w.kills.summoner = i;
    }
  }

  /* Morgoth level fact (borg-update.c:2201). */
  w.facts.morgothOnLevel = morgoth;

  /* Mirror the unique-engaged flag into the danger globals so borg_danger's
   * fighting-unique branch reads it (borg-danger.c uses borg_fighting_unique). */
  danger.fightingUnique = fight.fightingUnique > 0;
}
