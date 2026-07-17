/**
 * Spoiler generators - the port's answer to upstream's wiz-spoil.c (the
 * `main-spoil` / wizard-mode "generate spoilers" surface). Four pure functions
 * that dump the game's static content as text: the basic-item table, the
 * artifact descriptions, the brief monster table and the full monster lore.
 *
 * DEV TOOLING, not gameplay: this mirrors wiz-spoil.c's OUTPUT so a human (or a
 * cross-check against upstream's spoiler files) can eyeball parity. It reuses
 * the port's real naming / valuing / object-info / lore code; it never
 * re-derives formatting the engine already owns.
 *
 * Determinism: spoilers are a static-data dump. Each generator boots one game
 * at a FIXED seed (startGame - the sanctioned headless context, same call
 * obj/object-info.test.ts uses) purely to obtain the bound registries and a
 * fully-known player shadow; the generated level is never read. Object
 * construction draws from a dedicated throwaway Rng at a fixed seed and the
 * "maximise" aspect (which consumes no entropy - see obj/make.ts / history.ts),
 * so the shared game RNG is never touched and the text is byte-stable. NO
 * wall-clock, NO Math.random.
 *
 * wiz-spoil.c line citations are given inline as `// wiz-spoil.c L###`.
 */

import {
  COLOR_TABLE,
  KF,
  OBJ_NOTICE,
  ODESC,
  OINFO,
  PARITY_BASELINE,
  RF,
  Rng,
  TV,
  cheatMonsterLore,
  copyArtifactData,
  knownDescOf,
  loreDescription,
  makeObjectInfoDeps,
  newMonsterLore,
  objectDesc,
  objectInfo,
  objectPower,
  objectPrep,
  objectValue,
  playerLearnAllRunes,
  startGame,
  tvalIsAmmo,
  tvalIsArmor,
  tvalIsMeleeWeapon,
  textblockToString,
} from "@neo-angband/core";
import type {
  Artifact,
  GamePack,
  GameObject,
  LoreDeps,
  MonsterRace,
  ObjectInfoExtras,
  ObjectKind,
  PowerObject,
  StartedGame,
} from "@neo-angband/core";

/**
 * The build id upstream stamps into every spoiler header (buildid, e.g.
 * "Angband 4.2.6"). The port has no compiled buildid string, so the parity
 * baseline stands in - honest about which upstream release this content tracks.
 */
const BUILDID = `Angband ${PARITY_BASELINE}`;

/** Fixed seed for the headless boot (registries + player shadow only). */
const SPOIL_SEED = 1;
/** Fixed seed for the throwaway object-prep Rng (maximise draws nothing). */
const SPOIL_PREP_SEED = 1;

/**
 * A booted headless context shared by a single generator call: the bound
 * registries plus a game whose player knows every rune and treats every flavour
 * as identified, so the knowledge shadow reveals full details deterministically
 * (mirrors the object-info test harness).
 */
interface SpoilCtx {
  game: StartedGame;
  reg: StartedGame["booted"]["registries"];
  extras: ObjectInfoExtras;
}

function boot(pack: GamePack): SpoilCtx {
  const game = startGame(pack, { seed: SPOIL_SEED, depth: 1 });
  const reg = game.booted.registries;
  /* Reveal everything: know every rune, treat every flavour as aware. This is
   * the OINFO_SPOIL / object_info_spoil precondition (wiz-spoil.c L454). */
  playerLearnAllRunes(game.state.actor.player, game.state.runeEnv);
  game.state.isAware = () => true;

  const races = reg.monsters.races;
  const extras: ObjectInfoExtras = {
    projections: reg.projections ?? [],
    constants: reg.constants,
    raceOrigin: (h) => {
      const race = races[h];
      if (!race) return null;
      return {
        name: race.name,
        unique: race.flags.has(RF.UNIQUE),
        comma: race.flags.has(RF.NAME_COMMA),
      };
    },
    /* TODO(B2): timedDesc / summonDesc are not wired, so a handful of activation
     * effect strings (EFINFO_CURE / EFINFO_TIMED / EFINFO_SUMM) render their
     * generic fallback rather than the timed-effect / summon name. Everything
     * else in the object-info dump is fully realised. */
  };
  return { game, reg, extras };
}

/* ------------------------------------------------------------------ *
 * Small formatting helpers (printf-column analogues).
 * ------------------------------------------------------------------ */

/** Right-justify `s` in `n` columns (C "%Ns"). */
function padL(s: string, n: number): string {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

/** Left-justify `s` in `n` columns (C "%-Ns"). */
function padR(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

/** Clip then left-pad to exactly `n` columns (C "%-N.Ns"). */
function clipPadR(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : padR(s, n);
}

/** Clip to at most `n` columns, right-justified (C "%N.Ns"). */
function clipPadL(s: string, n: number): string {
  return s.length > n ? padL(s.slice(0, n), n) : padL(s, n);
}

/** spoiler_underline (wiz-spoil.c L71): the line, then a rule of `c` under it. */
function underline(str: string, c: string): string {
  return `${str}\n${c.repeat(str.length)}\n`;
}

/* ------------------------------------------------------------------ *
 * Group tables (transcribed verbatim from wiz-spoil.c).
 * ------------------------------------------------------------------ */

/** One row of a `grouper` table: a tval and an optional section title. */
interface Group {
  tval: number;
  /** Section title; null continues the previous section (a NULL name). */
  name: string | null;
}

/** group_item[] (wiz-spoil.c L84): basic items categorized by type. */
const GROUP_ITEM: readonly Group[] = [
  { tval: TV.SHOT, name: "Ammo" },
  { tval: TV.ARROW, name: null },
  { tval: TV.BOLT, name: null },
  { tval: TV.BOW, name: "Bows" },
  { tval: TV.SWORD, name: "Weapons" },
  { tval: TV.POLEARM, name: null },
  { tval: TV.HAFTED, name: null },
  { tval: TV.DIGGING, name: null },
  { tval: TV.SOFT_ARMOR, name: "Armour (Body)" },
  { tval: TV.HARD_ARMOR, name: null },
  { tval: TV.DRAG_ARMOR, name: null },
  { tval: TV.CLOAK, name: "Armour (Misc)" },
  { tval: TV.SHIELD, name: null },
  { tval: TV.HELM, name: null },
  { tval: TV.CROWN, name: null },
  { tval: TV.GLOVES, name: null },
  { tval: TV.BOOTS, name: null },
  { tval: TV.AMULET, name: "Amulets" },
  { tval: TV.RING, name: "Rings" },
  { tval: TV.SCROLL, name: "Scrolls" },
  { tval: TV.POTION, name: "Potions" },
  { tval: TV.FOOD, name: "Food" },
  { tval: TV.MUSHROOM, name: "Mushrooms" },
  { tval: TV.ROD, name: "Rods" },
  { tval: TV.WAND, name: "Wands" },
  { tval: TV.STAFF, name: "Staffs" },
  { tval: TV.MAGIC_BOOK, name: "Magic Books" },
  { tval: TV.PRAYER_BOOK, name: "Holy Books" },
  { tval: TV.NATURE_BOOK, name: "Nature Books" },
  { tval: TV.SHADOW_BOOK, name: "Shadow Books" },
  { tval: TV.OTHER_BOOK, name: "Mystery Books" },
  { tval: TV.CHEST, name: "Chests" },
  { tval: TV.LIGHT, name: "Lights and fuel" },
  { tval: TV.FLASK, name: null },
  { tval: 0, name: "" }, // sentinel (name is "" - truthy in C; tval 0 breaks)
];

/** group_artifact[] (wiz-spoil.c L351): artifacts categorized by type. */
const GROUP_ARTIFACT: readonly Group[] = [
  { tval: TV.SWORD, name: "Edged Weapons" },
  { tval: TV.POLEARM, name: "Polearms" },
  { tval: TV.HAFTED, name: "Hafted Weapons" },
  { tval: TV.BOW, name: "Bows" },
  { tval: TV.DIGGING, name: "Diggers" },
  { tval: TV.SOFT_ARMOR, name: "Body Armor" },
  { tval: TV.HARD_ARMOR, name: null },
  { tval: TV.DRAG_ARMOR, name: null },
  { tval: TV.CLOAK, name: "Cloaks" },
  { tval: TV.SHIELD, name: "Shields" },
  { tval: TV.HELM, name: "Helms/Crowns" },
  { tval: TV.CROWN, name: null },
  { tval: TV.GLOVES, name: "Gloves" },
  { tval: TV.BOOTS, name: "Boots" },
  { tval: TV.LIGHT, name: "Light Sources" },
  { tval: TV.AMULET, name: "Amulets" },
  { tval: TV.RING, name: "Rings" },
];

/* ================================================================== *
 * 1. spoil_obj_desc (wiz-spoil.c L205): the basic-item table.
 * ================================================================== */

/** The five measured columns of one object kind (kind_info, wiz-spoil.c L141). */
interface KindRow {
  desc: string;
  dam: string;
  wgt: string;
  lev: number;
  val: number;
}

/**
 * kind_info (wiz-spoil.c L141): forge a fake, bonus-cancelled item of `kind`
 * and read off its spoiled name, damage/AC, weight, level and cost.
 */
function kindInfo(ctx: SpoilCtx, rng: Rng, kind: ObjectKind): KindRow {
  const objs = ctx.reg.objects;
  /* Prepare a fake item (object_prep(kind, 0, MAXIMISE), L149). */
  const obj = objectPrep(rng, objs, ctx.reg.constants, kind, 0, "maximise");

  /* Cancel bonuses (L152-156). */
  for (let i = 0; i < obj.modifiers.length; i++) obj.modifiers[i] = 0;
  obj.toA = 0;
  obj.toH = 0;
  obj.toD = 0;

  const lev = kind.level; // L159
  const val = objectValue(objs, obj, 1, true); // object_value(obj, 1), L166

  /* Description, ODESC_BASE | ODESC_SPOIL (L170); omniscient (p == null). */
  const desc = objectDesc(
    obj,
    ODESC.BASE | ODESC.SPOIL,
    null,
    ctx.game.state.runeEnv,
    knownDescOf(ctx.game.state),
  );

  /* Weight "%3d.%d" (L177); the column pad handles the leading spaces. */
  const wgt = `${Math.trunc(obj.weight / 10)}.${obj.weight % 10}`;

  /* Damage / AC (L192-195). */
  let dam = "";
  if (tvalIsAmmo(obj.tval) || tvalIsMeleeWeapon(obj.tval)) {
    dam = `${obj.dd}d${obj.ds}`;
  } else if (tvalIsArmor(obj.tval)) {
    dam = `${obj.ac}`;
  }

  return { desc, dam, wgt, lev, val };
}

export function spoilObjDesc(pack: GamePack): string {
  const ctx = boot(pack);
  const objs = ctx.reg.objects;
  const rng = new Rng(SPOIL_PREP_SEED);
  let out = "";

  /* Header (L228-233). The header row's title column is "%-51s  " (title padded
   * to 51 then two spaces); each data row instead leads with two spaces then
   * the 51-wide name - both put the tail columns at the same offset. */
  out += `Spoiler File -- Basic Items (${BUILDID})\n\n\n`;
  const tail = (dam: string, wgt: string, lev: string, cost: string): string =>
    padL(dam, 7) + padL(wgt, 6) + padL(lev, 4) + padL(cost, 9);
  out += padR("Description", 51) + "  " + tail("Dam/AC", "Wgt", "Lev", "Cost") + "\n";
  out +=
    padR("----------------------------------------", 51) +
    "  " +
    tail("------", "---", "---", "----") +
    "\n";

  /* The grouper walk (L236-323): accumulate kinds until the next NAMED group,
   * then sort that section by cost, then level, and dump it. */
  let bucket: ObjectKind[] = [];
  const dumpBucket = (): void => {
    /* Bubble-sort by cost then level (L240-260); a stable sort preserves the
     * kidx insertion order for full ties, as the bubble sort does. */
    const rows = bucket.map((k) => ({ k, info: kindInfo(ctx, rng, k) }));
    rows.sort((a, b) => a.info.val - b.info.val || a.info.lev - b.info.lev);
    for (const { info } of rows) {
      out +=
        "  " +
        clipPadR(info.desc, 51) +
        padL(info.dam, 7) +
        padL(info.wgt, 6) +
        padL(String(info.lev), 4) +
        padL(String(info.val), 9) +
        "\n";
    }
    bucket = [];
  };

  for (const group of GROUP_ITEM) {
    if (group.name !== null) {
      dumpBucket();
      if (!group.tval) break; // sentinel (L304)
      out += `\n\n${group.name}\n\n`; // L307
    }
    /* Get legal item types (L311-322): matching tval, skipping instant-arts. */
    for (const kind of objs.kinds) {
      if (kind.tval !== group.tval) continue;
      if (kind.kindFlags.has(KF.INSTA_ART)) continue;
      bucket.push(kind);
    }
  }

  return out;
}

/* ================================================================== *
 * 2. spoil_artifact (wiz-spoil.c L381): full artifact descriptions.
 * ================================================================== */

/**
 * make_fake_artifact (obj-make.c L728): object_prep(kind, 0, MAXIMISE) then
 * copy_artifact_data, with obj->artifact set. Returns null when the artifact
 * has no base kind (make_fake_artifact would return false).
 */
function makeFakeArtifact(
  ctx: SpoilCtx,
  rng: Rng,
  art: Artifact,
): GameObject | null {
  const objs = ctx.reg.objects;
  const kind = objs.lookupKind(art.tval, art.sval);
  if (!kind) return null;
  /* Hide the flavour text: spoilers spoil the mechanics, not the atmosphere
   * (wiz-spoil.c L433-435 memcpy's the artifact and nulls artc.text). The base
   * item's description still shows, exactly as upstream's object_info does. */
  const artc: Artifact = { ...art, text: "" };
  const obj = objectPrep(rng, objs, ctx.reg.constants, kind, 0, "maximise");
  copyArtifactData(rng, objs, obj, artc);
  obj.artifact = artc;
  obj.number = 1;
  /* Mark assessed: with every rune learned (see boot), objectKnownShadow then
   * reveals the full mechanics the OINFO_SPOIL dump needs (object-info.c
   * gates modifiers/flags/brands/slays behind the ASSESSED notice). */
  obj.notice |= OBJ_NOTICE.ASSESSED;
  return obj;
}

export function spoilArtifact(pack: GamePack): string {
  const ctx = boot(pack);
  const objs = ctx.reg.objects;
  const rng = new Rng(SPOIL_PREP_SEED);
  let out = "";

  /* Header (L401-403). */
  out += underline(`Artifact Spoilers for ${BUILDID}`, "=");
  /* TODO(B2): seed_randart only matters under birth_randarts; this dev tool
   * dumps the standard set, so the seed is reported as 0 for format parity. */
  out += `\n Randart seed is 0\n`;

  for (const group of GROUP_ARTIFACT) {
    if (group.name !== null) {
      /* spoiler_blanklines(2); underline(name,'='); spoiler_blanklines(1). */
      out += `\n\n` + underline(group.name, "=") + `\n`;
    }

    /* a_info is 1-based; index 0 is the null placeholder (L415). */
    for (let j = 1; j < objs.artifacts.length; j++) {
      const art = objs.artifacts[j];
      if (!art || art.tval !== group.tval) continue;

      const obj = makeFakeArtifact(ctx, rng, art);
      if (!obj) continue; // L438-442

      /* Name: ODESC_PREFIX|ODESC_COMBAT|ODESC_EXTRA|ODESC_SPOIL (L447). */
      const name = objectDesc(
        obj,
        ODESC.PREFIX | ODESC.COMBAT | ODESC.EXTRA | ODESC.SPOIL,
        null,
        ctx.game.state.runeEnv,
        knownDescOf(ctx.game.state),
      );
      out += underline(name, "-"); // L451

      /* object_info_spoil(fh, obj, 80) (L454): the full mechanics dump. */
      const info = objectInfo(
        obj,
        OINFO.SPOIL,
        makeObjectInfoDeps(ctx.game.state, obj, ctx.extras),
      );
      out += textblockToString(info);

      /* object_power(obj, false, NULL) on the fake object (L462-465), the same
       * source upstream prints; GameObject satisfies PowerObject structurally. */
      const power = objectPower(objs, obj as unknown as PowerObject);
      const w = obj.weight;
      out +=
        `\nMin Level ${art.allocMin}, Max Level ${art.allocMax}, ` +
        `Generation chance ${art.allocProb}, Power ${power}, ` +
        `${Math.trunc(w / 10)}.${w % 10} lbs\n`;

      /* birth_randarts off -> art->text is not appended (L467). */
      out += `\n\n`; // spoiler_blanklines(2), L470
    }
  }

  return out;
}

/* ================================================================== *
 * Monster ordering (cmp_monsters, ui-knowledge.c L4351 -> cmp_level):
 * by level, then experience, then race index.
 * ================================================================== */

/**
 * The spoilable races: every named monster except the reserved `<player>`
 * template at index 0 (races[0], upstream's r_info[0]). Sorted by cmp_monsters
 * (ui-knowledge.c cmp_level -> cmp_mexp: level, then experience, then index).
 *
 * `excludeLast` reproduces spoil_mon_desc's `i < z_info->r_max - 1` bound
 * (wiz-spoil.c L535): the brief monster table drops the final race (Morgoth,
 * the deepest) from the SET before sorting. spoil_mon_info uses the full
 * `i < z_info->r_max` range (L672), so its caller leaves excludeLast false.
 */
function spoilableRaces(
  reg: SpoilCtx["reg"],
  excludeLast = false,
): MonsterRace[] {
  const races = reg.monsters.races;
  const end = excludeLast ? races.length - 1 : races.length;
  const who: MonsterRace[] = [];
  for (let i = 1; i < end; i++) {
    const race = races[i];
    if (race && race.name) who.push(race);
  }
  who.sort(
    (a, b) => a.level - b.level || a.mexp - b.mexp || a.ridx - b.ridx,
  );
  return who;
}

/** attr_to_text (z-color.c L208): the colour name for a display attr; the
 * out-of-range fallback is "Icky" (L213), not the color table's own name. */
function attrToText(attr: number): string {
  return COLOR_TABLE[attr]?.name ?? "Icky";
}

/** The [Q]/[U]/The name prefix used by both monster spoilers. */
function monsterName(race: MonsterRace, prefix: (p: string) => string): string {
  if (race.flags.has(RF.QUESTOR)) return prefix("[Q] ");
  if (race.flags.has(RF.UNIQUE)) return prefix("[U] ");
  return prefix("The ");
}

/** Speed as "+N" / "-N" relative to normal (110) (L569-572). */
function speedText(speed: number): string {
  return speed >= 110 ? `+${speed - 110}` : `-${110 - speed}`;
}

/* ================================================================== *
 * 3. spoil_mon_desc (wiz-spoil.c L494): the brief monster table.
 * ================================================================== */

export function spoilMonDesc(pack: GamePack): string {
  const ctx = boot(pack);
  let out = "";

  /* Header (L522-529). */
  out += `Monster Spoilers for ${BUILDID}\n`;
  out += `------------------------------------------\n\n`;
  const row = (
    name: string,
    lev: string,
    rar: string,
    spd: string,
    hp: string,
    ac: string,
    vis: string,
  ): string =>
    clipPadR(name, 40) +
    padL(lev, 4) +
    padL(rar, 4) +
    padL(spd, 6) +
    padL(hp, 8) +
    padL(ac, 4) +
    "  " +
    clipPadL(vis, 11) +
    "\n";
  out += row("Name", "Lev", "Rar", "Spd", "Hp", "Ac", "Visual Info");
  out += row("----", "---", "---", "---", "--", "--", "-----------");

  /* spoil_mon_desc scans i=1..r_max-2 (wiz-spoil.c L535): drop the last race. */
  for (const race of spoilableRaces(ctx.reg, true)) {
    const nam = monsterName(race, (p) => `${p}${race.name}`);
    /* The "Visual Info" column reuses the exp buffer: colour name + symbol. */
    const vis = `${attrToText(race.dAttr)} '${race.dChar}'`;
    out += row(
      nam,
      String(race.level),
      String(race.rarity),
      speedText(race.speed),
      String(race.avgHp),
      String(race.ac),
      vis,
    );
  }

  out += `\n`; // L613
  return out;
}

/* ================================================================== *
 * 4. spoil_mon_info (wiz-spoil.c L642): the full monster lore dump.
 * ================================================================== */

export function spoilMonInfo(pack: GamePack): string {
  const ctx = boot(pack);
  const player = ctx.game.state.actor.player;
  const projections = ctx.reg.projections ?? [];
  let out = "";

  /* Header (L662-663). */
  out += `Monster Spoilers for ${BUILDID}\n`;
  out += `------------------------------------------\n\n`;

  /* Lore deps: a fully-known character view. effectiveSpeed is off, so
   * playerSpeed is inert; playerLevel drives the exp reward and playerMaxDepth
   * only colours the depth line (text is unaffected).
   * TODO(B2): meleeHitPercent / monsterHitPercent are omitted (a core-level
   * DEFERRED - the combat layer does not feed lore), so every "chance to hit"
   * and per-blow "(NdM, X%)" renders X as 0%. Wire them when core supplies
   * hit_chance to the lore layer. */
  const loreDeps: LoreDeps = {
    playerLevel: player.lev,
    playerMaxDepth: player.maxDepth,
    playerSpeed: 110,
    effectiveSpeed: false,
    spells: ctx.reg.monsters.spells,
    breathProjection: (subtype) => projections[subtype],
  };

  for (const race of spoilableRaces(ctx.reg)) {
    /* Line 1: prefix, name, colour and symbol (L692-711). */
    const prefix = race.flags.has(RF.QUESTOR)
      ? "[Q] "
      : race.flags.has(RF.UNIQUE)
        ? "[U] "
        : "The ";
    out += `${prefix}${race.name}  (${attrToText(race.dAttr)} '${race.dChar}')\n`;

    /* Line 2: number, level, rarity, speed, HP, AC, exp (L713-726). */
    out +=
      `=== Num:${race.ridx}  Lev:${race.level}  Rar:${race.rarity}  ` +
      `Spd:${speedText(race.speed)}  Hp:${race.avgHp}  Ac:${race.ac}  ` +
      `Exp:${race.mexp}\n`;

    /* Full lore (lore_description(tb, race, lore, true), L729). The port's
     * loreDescription has no `spoilers` bool to suppress its own title line, so
     * it always emits a leading "The X ('c')\n"; we drop that first line since
     * the header block above already names the monster.
     * TODO(B2): give core's loreDescription an upstream-style spoiler flag and
     * remove this slice. */
    const lore = newMonsterLore(race);
    cheatMonsterLore(race, lore);
    const loreText = loreDescription(race, lore, loreDeps)
      .map((r) => r.text)
      .join("");
    const nl = loreText.indexOf("\n");
    out += (nl >= 0 ? loreText.slice(nl + 1) : loreText) + "\n";
  }

  return out;
}
