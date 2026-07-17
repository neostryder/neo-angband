/**
 * Object name descriptions, ported from reference/src/obj-desc.c (Angband
 * 4.2.6): object_desc and every helper it calls. Names are gated by the
 * player's real knowledge EXACTLY as upstream, by reading the per-object known
 * shadow synthesised in known-object.ts wherever upstream reads obj->known.
 *
 * Flavour text (the "Smoky" adjective, the scroll title) is supplied through
 * the KnownDesc deps (flavorText / hasFlavor), fed from the per-game
 * FlavorAssignment that flavor_init builds (obj/flavor.ts). When those deps are
 * absent the helpers fall back to the tval-only flavour test and omit the '#'
 * modstr - the pre-flavor_init behaviour - which still never leaks a real kind
 * name.
 *
 * Divergences from upstream, all forced by port model gaps (each ledgered
 * inline with a // DEFERRED: note):
 * - ODESC_CAPITAL: object_desc in 4.2.6 documents but does NOT apply this flag
 *   (it is a caller concern via my_strcap); accepted and ignored, as upstream.
 * - ODESC_ALTNUM: rather than packing the count into the high 16 bits of mode,
 *   the alternate number is passed as a separate `altnum` argument; the
 *   ODESC.ALTNUM bit still selects it over obj.number.
 * - Chest trap names (obj_desc_chest -> chest_trap_name, gap #49) are ported
 *   (obj/chest.ts's chestTrapName), gated by the same shadow.pval guard as
 *   upstream; since chests never copy pval to the known shadow (L355 below /
 *   known-object.ts), the "(<trap>)" segment only ever fires for an empty
 *   chest ("(empty)") under the current knowledge simplification (#24).
 * - ignore_item_ok / the "{ignore}" and gold "{ignore}" markers (obj-desc.c
 *   L537, L630): emitted when the caller supplies KnownDesc.ignoreItemOk (a
 *   thin wrapper over obj/ignore.ts ignore_item_ok); omitted for an omniscient
 *   or ignore-less describe.
 * - obj->kind->everseen / obj->ego->everseen "seen" mutations (L633-637): the
 *   bound registries are immutable, so these bits live in a per-game
 *   EverseenKnowledge (obj/knowledge.ts) and are set through the optional
 *   KnownDesc.markKindSeen / markEgoSeen deps hooks, mirroring the upstream
 *   `!spoil`-guarded mutation. A pure Set insert; no RNG, no name output.
 * - The is_unknown() placeholder path (obj->kind != obj->known->kind) is a
 *   game-list-layer concern in the port; object_desc always gets a real
 *   object, so that branch is skipped (module docs of object.ts).
 */

import { KF, OBJ_MOD, OF } from "../generated";
import { TV } from "../generated";
import type { Player } from "../player/player";
import type { GameObject } from "./object";
import {
  tvalCanHaveCharges,
  tvalCanHaveFlavor,
  tvalIsArmor,
  tvalIsBodyArmor,
  tvalIsBook,
  tvalIsChest,
  tvalIsLight,
  tvalIsMoney,
  tvalIsRod,
  tvalIsWeapon,
} from "./object";
import { chestTrapName } from "./chest";
import type { RuneEnv } from "./knowledge";
import { OBJ_NOTICE, objectHasStandardToH } from "./knowledge";
import type { KnownDesc } from "./known-object";
import {
  objectIsKnownArtifact,
  objectKnownShadow,
  objectRunesKnownUpstream,
} from "./known-object";
import type { ObjectKind } from "./types";
import { OBJ_MOD_MAX } from "./types";

/**
 * Modes for object_desc (obj-desc.h L25-46). ODESC_BASE is the empty mode.
 * ODESC_FULL = COMBAT | EXTRA.
 */
export const ODESC = {
  BASE: 0x00,
  COMBAT: 0x01,
  EXTRA: 0x02,
  FULL: 0x03,
  STORE: 0x04,
  PLURAL: 0x08,
  SINGULAR: 0x10,
  SPOIL: 0x20,
  PREFIX: 0x40,
  CAPITAL: 0x80,
  TERSE: 0x100,
  NOEGO: 0x200,
  ALTNUM: 0x400,
} as const;

/** Knowledge gates for the combat helper (upstream p->obj_k reads / !p). */
interface CombatGates {
  toA: boolean;
  toH: boolean;
  toD: boolean;
  ac: boolean;
  dice: boolean;
}

/** Format a signed integer as C's %+d ("+0", "+3", "-2"). */
function plus(n: number): string {
  return n < 0 ? String(n) : `+${n}`;
}

/** is_a_vowel (z-util.c): whether a character is an English vowel. */
function isAVowel(c: string): boolean {
  return "aeiouAEIOU".includes(c);
}

/* ------------------------------------------------------------------ *
 * object_to_hit / _to_dam / _to_ac (obj-util.c L296-347): the object's
 * combat bonus including any of its curses. Read the shadow + curse registry.
 * ------------------------------------------------------------------ */

function objectToHit(o: GameObject, env: RuneEnv): number {
  let result = o.toH;
  if (o.curses) {
    for (let i = 1; i < env.curses.length; i++) {
      if (o.curses[i]?.power) result += env.curses[i]?.obj.toH ?? 0;
    }
  }
  return result;
}

function objectToDam(o: GameObject, env: RuneEnv): number {
  let result = o.toD;
  if (o.curses) {
    for (let i = 1; i < env.curses.length; i++) {
      if (o.curses[i]?.power) result += env.curses[i]?.obj.toD ?? 0;
    }
  }
  return result;
}

function objectToAc(o: GameObject, env: RuneEnv): number {
  let result = o.toA;
  if (o.curses) {
    for (let i = 1; i < env.curses.length; i++) {
      if (o.curses[i]?.power) result += env.curses[i]?.obj.toA ?? 0;
    }
  }
  return result;
}

/**
 * number_charging (obj-util.c L1020), evaluated purely: randcalc(time, 0,
 * AVERAGE) = base + trunc(dice*(sides+1)/2).
 */
function numberCharging(obj: GameObject): number {
  const t = obj.time;
  const chargeTime = t.base + Math.trunc((t.dice * (t.sides + 1)) / 2);
  if (chargeTime <= 0) return 0;
  if (obj.timeout <= 0) return 0;
  let num = Math.trunc((obj.timeout + chargeTime - 1) / chargeTime);
  if (num > obj.number) num = obj.number;
  return num;
}

/**
 * Whether a kind carries an assigned flavour (upstream obj->kind->flavor).
 * Uses the deps' per-game assignment when wired (flavor_init), else falls back
 * to the tval-only test - the two agree because every flavoured tval's kinds
 * are assigned a flavour.
 */
function descHasFlavor(kind: ObjectKind, deps: KnownDesc): boolean {
  return deps.hasFlavor?.(kind) ?? tvalCanHaveFlavor(kind.tval);
}

/**
 * obj_desc_get_modstr (obj-desc.c L66): the string that replaces '#' in the
 * base name. Books use kind->name; flavoured kinds use the flavour text (the
 * "Smoky" adjective or scroll title) from the per-game assignment.
 */
function objDescGetModstr(kind: ObjectKind, deps: KnownDesc): string {
  if (tvalCanHaveFlavor(kind.tval)) {
    return deps.flavorText?.(kind) ?? "";
  }
  if (tvalIsBook(kind.tval)) return kind.name;
  return "";
}

/**
 * obj_desc_get_basename (obj-desc.c L82): the object's basic name format. When
 * show_flavor is set the flavoured forms carry a '#' (filled by the flavour
 * modstr): "& # Ring~", the scroll "& Scroll~ titled #", etc. `knownArtifact`
 * is object_is_known_artifact(obj), computed once by the caller.
 */
function objDescGetBasename(
  obj: GameObject,
  aware: boolean,
  terse: boolean,
  knownArtifact: boolean,
  mode: number,
  deps: KnownDesc,
): string {
  const flavored = descHasFlavor(obj.kind, deps);

  /* show_flavor (L84-88): flavoured, not terse, not a store listing, and -
   * once aware - only when the show_flavors option is on (default true).
   * Also requires the flavour TEXT to be available: upstream obj->kind->flavor
   * always carries text, but the port's tval-only fallback (no flavor_init
   * wired) has none, and emitting "& # X" with an empty modstr would leave a
   * stray space. Gating on the text keeps the plain base form in that case. */
  const hasFlavorText = (deps.flavorText?.(obj.kind) ?? "").length > 0;
  let showFlavor = !terse && flavored && hasFlavorText;
  if (mode & ODESC.STORE) showFlavor = false;
  if (aware && deps.showFlavors && !deps.showFlavors()) showFlavor = false;

  /* Artifacts are special (L91-94). */
  if (obj.artifact && (aware || knownArtifact || terse || !flavored)) {
    return obj.kind.name;
  }

  switch (obj.tval) {
    case TV.FLASK:
    case TV.CHEST:
    case TV.SHOT:
    case TV.BOLT:
    case TV.ARROW:
    case TV.BOW:
    case TV.HAFTED:
    case TV.POLEARM:
    case TV.SWORD:
    case TV.DIGGING:
    case TV.BOOTS:
    case TV.GLOVES:
    case TV.CLOAK:
    case TV.CROWN:
    case TV.HELM:
    case TV.SHIELD:
    case TV.SOFT_ARMOR:
    case TV.HARD_ARMOR:
    case TV.DRAG_ARMOR:
    case TV.LIGHT:
    case TV.FOOD:
      return obj.kind.name;

    case TV.AMULET:
      return showFlavor ? "& # Amulet~" : "& Amulet~";
    case TV.RING:
      return showFlavor ? "& # Ring~" : "& Ring~";
    case TV.STAFF:
      return showFlavor ? "& # Sta|ff|ves|" : "& Sta|ff|ves|";
    case TV.WAND:
      return showFlavor ? "& # Wand~" : "& Wand~";
    case TV.ROD:
      return showFlavor ? "& # Rod~" : "& Rod~";
    case TV.POTION:
      return showFlavor ? "& # Potion~" : "& Potion~";
    case TV.SCROLL:
      return showFlavor ? "& Scroll~ titled #" : "& Scroll~";
    case TV.MUSHROOM:
      return showFlavor ? "& # Mushroom~" : "& Mushroom~";

    case TV.MAGIC_BOOK:
      return terse ? "& Book~ #" : "& Book~ of Magic Spells #";
    case TV.PRAYER_BOOK:
      return terse ? "& Book~ #" : "& Holy Book~ of Prayers #";
    case TV.NATURE_BOOK:
      return terse ? "& Book~ #" : "& Book~ of Nature Magics #";
    case TV.SHADOW_BOOK:
      return terse ? "& Tome~ #" : "& Necromantic Tome~ #";
    case TV.OTHER_BOOK:
      return terse ? "& Book~ #" : "& Book of Mysteries~ #";
  }

  return "(nothing)";
}

/**
 * obj_desc_name_prefix (obj-desc.c L184): the number/uniqueness prefix
 * (a / an / the / no more / N).
 */
function objDescNamePrefix(
  basename: string,
  modstr: string,
  terse: boolean,
  number: number,
  knownArtifact: boolean,
): string {
  if (number === 0) return "no more ";
  if (number > 1) return `${number} `;
  if (knownArtifact) return "the ";
  if (basename[0] === "&") {
    let an = false;
    let k = 1;
    while (basename[k] === " ") k++;
    const lookahead = basename[k] ?? "";
    if (lookahead === "#") {
      if (modstr && isAVowel(modstr[0] ?? "")) an = true;
    } else if (isAVowel(lookahead)) {
      an = true;
    }
    if (!terse) return an ? "an " : "a ";
  }
  return "";
}

/**
 * obj_desc_name_format (obj-desc.c L231): the "&"/"~"/"|x|y|"/"#" grammar. Pass
 * modstr = null to suppress '#' substitution (matches the upstream NULL modstr
 * in the recursive call).
 */
export function objDescNameFormat(
  fmt: string,
  modstr: string | null,
  pluralise: boolean,
): string {
  let out = "";
  let i = 0;
  while (i < fmt.length) {
    const c = fmt[i] as string;
    if (c === "&") {
      /* Skip the '&' and any surrounding spaces. */
      while (i < fmt.length && (fmt[i] === " " || fmt[i] === "&")) i++;
      continue;
    } else if (c === "~") {
      /* Pluralizer (regular English plurals). */
      if (!pluralise) {
        i++;
        continue;
      }
      const prev = i > 0 ? fmt[i - 1] : "";
      if (prev === "s" || prev === "h" || prev === "x") out += "es";
      else out += "s";
    } else if (c === "|") {
      /* Special plurals, e.g. kni|fe|ves| */
      const singularStart = i + 1;
      const firstBar = fmt.indexOf("|", singularStart);
      if (firstBar < 0) return out;
      const pluralStart = firstBar + 1;
      const endmark = fmt.indexOf("|", pluralStart);
      if (endmark < 0) return out;
      if (!pluralise) out += fmt.slice(singularStart, firstBar);
      else out += fmt.slice(pluralStart, endmark);
      i = endmark; // loop's i++ then advances past the closing '|'
    } else if (c === "#" && modstr !== null) {
      /* Add modstr, pluralised if relevant. */
      out += objDescNameFormat(modstr, null, pluralise);
    } else {
      out += c;
    }
    i++;
  }
  return out;
}

/**
 * obj_desc_name (obj-desc.c L299): the full base name with prefix and the
 * artifact/ego/"of <kind>" suffix. Reads the shadow's ego (shadow.ego) for the
 * normal ego gate and the real obj.ego in store mode, exactly as upstream.
 */
function objDescName(
  obj: GameObject,
  shadow: GameObject,
  prefix: boolean,
  mode: number,
  terse: boolean,
  number: number,
  aware: boolean,
  knownArtifact: boolean,
  deps: KnownDesc,
): string {
  const store = (mode & ODESC.STORE) !== 0;
  /* Pluralise unless forced singular, an artifact, or a lone non-PLURAL item. */
  const plural =
    !(mode & ODESC.SINGULAR) &&
    !obj.artifact &&
    (number !== 1 || (mode & ODESC.PLURAL) !== 0);
  const basename = objDescGetBasename(obj, aware, terse, knownArtifact, mode, deps);
  const modstr = objDescGetModstr(obj.kind, deps);

  let out = "";
  if (prefix) {
    out += objDescNamePrefix(basename, modstr, terse, number, knownArtifact);
  }
  out += objDescNameFormat(basename, modstr, plural);

  /* Append extra names (L328-339). */
  if (knownArtifact && obj.artifact) {
    out += ` ${obj.artifact.name}`;
  } else if (
    (shadow.ego && !(mode & ODESC.NOEGO)) ||
    (obj.ego && store)
  ) {
    out += ` ${obj.ego?.name ?? ""}`;
  } else if (
    aware &&
    !obj.artifact &&
    (descHasFlavor(obj.kind, deps) || obj.tval === TV.SCROLL)
  ) {
    if (terse) out += ` '${obj.kind.name}'`;
    else out += ` of ${obj.kind.name}`;
  }

  return out;
}

/** obj_desc_show_armor (obj-desc.c L347). */
function objDescShowArmor(shadow: GameObject, gates: CombatGates): boolean {
  return gates.ac && (shadow.ac !== 0 || tvalIsArmor(shadow.tval));
}

/**
 * obj_desc_chest (obj-desc.c L356): the "(<trap>)" suffix. Reads obj (not the
 * shadow) for chest_trap_name, exactly as upstream; the guard is the shadow's
 * pval (obj->known->pval), which chests never populate under the current
 * knowledge simplification (#24), so this only ever fires for pval 0.
 */
function objDescChest(obj: GameObject, shadow: GameObject): string {
  if (!tvalIsChest(obj.tval)) return "";
  if (obj.pval && !shadow.pval) return "";
  return ` (${chestTrapName(obj)})`;
}

/**
 * obj_desc_combat (obj-desc.c L374): damage dice, to-hit/to-dam, armour class,
 * missile multiplier. Reads the SHADOW (upstream calls it with obj->known); the
 * knowledge gates (`p->obj_k` reads / `!p`) come in as CombatGates.
 */
function objDescCombat(
  shadow: GameObject,
  mode: number,
  gates: CombatGates,
  env: RuneEnv,
): string {
  const spoil = (mode & ODESC.SPOIL) !== 0;
  let out = "";

  /* Damage dice if known (L381-384). */
  if (shadow.kind.kindFlags.has(KF.SHOW_DICE) && gates.dice) {
    out += ` (${shadow.dd}d${shadow.ds})`;
  }

  /* Shooting power as a multiplier (L387-390). */
  if (shadow.kind.kindFlags.has(KF.SHOW_MULT)) {
    out += ` (x${shadow.pval + (shadow.modifiers[OBJ_MOD.MIGHT] ?? 0)})`;
  }

  /* No more if the object hasn't been assessed (L393). */
  const assessed = (shadow.notice & OBJ_NOTICE.ASSESSED) !== 0;
  if (!(assessed || spoil)) return out;

  const toH = objectToHit(shadow, env);
  const toD = objectToDam(shadow, env);
  const toA = objectToAc(shadow, env);

  /* Weapon bonuses (L400-417). */
  if (
    gates.toH &&
    gates.toD &&
    (tvalIsWeapon(shadow.tval) ||
      toD !== 0 ||
      (toH !== 0 && !tvalIsBodyArmor(shadow.tval)) ||
      ((!objectHasStandardToH(env, shadow) || shadow.toH !== toH) &&
        !shadow.artifact &&
        !shadow.ego))
  ) {
    out += ` (${plus(toH)},${plus(toD)})`;
  } else if (shadow.toH < 0 && objectHasStandardToH(env, shadow)) {
    out += ` (${plus(shadow.toH)})`;
  } else if (toD !== 0 && gates.toD) {
    out += ` (${plus(toD)})`;
  } else if (toH !== 0 && gates.toH) {
    out += ` (${plus(toH)})`;
  }

  /* Armour bonuses (L420-427). */
  if (gates.toA) {
    if (objDescShowArmor(shadow, gates)) out += ` [${shadow.ac},${plus(toA)}]`;
    else if (toA !== 0) out += ` [${plus(toA)}]`;
  } else if (objDescShowArmor(shadow, gates)) {
    out += ` [${shadow.ac}]`;
  }

  return out;
}

/** obj_desc_light (obj-desc.c L435). */
function objDescLight(obj: GameObject): string {
  if (tvalIsLight(obj.tval) && !obj.flags.has(OF.NO_FUEL)) {
    return ` (${obj.timeout} turns)`;
  }
  return "";
}

/**
 * obj_desc_mods (obj-desc.c L449): the distinct numerical modifiers, e.g.
 * " <+2, +1>". Reads the SHADOW (upstream calls it with obj->known).
 */
function objDescMods(shadow: GameObject): string {
  const mods: number[] = [];
  for (let i = 0; i < OBJ_MOD_MAX; i++) {
    const v = shadow.modifiers[i] ?? 0;
    if (v === 0) continue;
    if (mods.length === 0) {
      mods.push(v);
      continue;
    }
    let dup = false;
    for (const m of mods) {
      if (m === v) {
        dup = true;
        break;
      }
    }
    if (!dup) mods.push(v);
  }
  if (mods.length === 0) return "";
  let out = " <";
  for (let j = 0; j < mods.length; j++) {
    if (j) out += ", ";
    out += plus(mods[j] as number);
  }
  out += ">";
  return out;
}

/** obj_desc_charges (obj-desc.c L491). */
function objDescCharges(
  obj: GameObject,
  mode: number,
  deps: KnownDesc,
): string {
  const aware = deps.isAware(obj.kind) || (mode & ODESC.STORE) !== 0;
  if (aware && tvalCanHaveCharges(obj.tval)) {
    return ` (${obj.pval} charge${obj.pval === 1 ? "" : "s"})`;
  } else if (obj.timeout > 0) {
    if (tvalIsRod(obj.tval) && obj.number > 1) {
      return ` (${numberCharging(obj)} charging)`;
    } else if (tvalIsRod(obj.tval) || obj.activation || obj.effect) {
      return " (charging)";
    }
  }
  return "";
}

/**
 * obj_desc_inscrip (obj-desc.c L514): player inscription plus game markers
 * (empty / tried / cursed / ignore / ??). The "ignore" marker is emitted when
 * KnownDesc.ignoreItemOk is supplied (obj-desc.c L536-538).
 */
function objDescInscrip(
  obj: GameObject,
  shadow: GameObject,
  p: Player,
  env: RuneEnv,
  deps: KnownDesc,
): string {
  const u: string[] = [];

  if (obj.note) u.push(obj.note);

  if (!deps.isAware(obj.kind)) {
    if (tvalCanHaveCharges(obj.tval) && obj.pval === 0) u.push("empty");
    if (deps.isTried(obj.kind)) u.push("tried");
  }

  if (shadow.curses) u.push("cursed");

  /* Note ignore (obj-desc.c L536-538): ignore_item_ok(p, obj). */
  if (p && deps.ignoreItemOk?.(obj)) u.push("ignore");

  if (
    !objectRunesKnownUpstream(obj, shadow, p, env) &&
    (shadow.notice & OBJ_NOTICE.ASSESSED)
  ) {
    u.push("??");
  }

  if (u.length === 0) return "";
  let out = "";
  for (let i = 0; i < u.length; i++) {
    if (i === 0) out += " {";
    out += u[i];
    if (i < u.length - 1) out += ", ";
  }
  out += "}";
  return out;
}

/**
 * obj_desc_aware (obj-desc.c L565): the in-store "{unseen}" / "{??}" /
 * "{cursed}" markers.
 */
function objDescAware(
  obj: GameObject,
  shadow: GameObject,
  p: Player,
  env: RuneEnv,
  deps: KnownDesc,
): string {
  if (!deps.isAware(obj.kind)) return " {unseen}";
  if (!objectRunesKnownUpstream(obj, shadow, p, env)) return " {??}";
  if (shadow.curses) return " {cursed}";
  return "";
}

/**
 * object_desc (obj-desc.c L607): describe `obj` under `mode`, gated by the
 * player `p`'s knowledge (p may be null for an omniscient observer). `env`
 * supplies the rune/curse registries the shadow synthesis and combat readers
 * need; `deps` supplies flavour awareness. `altnum` is the ODESC_ALTNUM count
 * (used only when the ODESC.ALTNUM bit is set), passed separately rather than
 * packed into mode's high bits.
 *
 * @returns the object's description string.
 */
export function objectDesc(
  obj: GameObject | null,
  mode: number,
  p: Player | null,
  env: RuneEnv,
  deps: KnownDesc,
  altnum?: number,
): string {
  const prefix = (mode & ODESC.PREFIX) !== 0;
  const spoil = (mode & ODESC.SPOIL) !== 0;
  const terse = (mode & ODESC.TERSE) !== 0;

  /* Simple description for a null item (L616-618). */
  if (!obj) return "(nothing)";

  /* is_unknown() placeholder path (L621-625): DEFERRED to the game-list layer;
   * object_desc always gets a real object here. */

  /* Cash gets a straightforward description (L627-630), with a trailing
   * " {ignore}" when ignore_item_ok(p, obj). */
  if (tvalIsMoney(obj.tval)) {
    const ignore = p && deps.ignoreItemOk?.(obj) ? " {ignore}" : "";
    return `${obj.pval} gold pieces worth of ${obj.kind.name}${ignore}`;
  }

  /* Build the known shadow. An omniscient observer (p == null) or a spoiled
   * description treats the object as fully known: the real object serves as
   * its own shadow, so every knowledge read resolves to the true value. */
  const omniscient = p === null || spoil;
  const shadow = omniscient ? obj : objectKnownShadow(obj, p, env, deps);

  /* L633-637: "Egos and kinds whose name we know are seen." Mark the per-game
   * everseen flags via the deps hooks, guarded by the upstream `!spoil` (here
   * `!omniscient`, which also covers the null-player case where there is no
   * store to mark). Pure Set inserts - no RNG, no effect on the name output. */
  if (!omniscient) {
    if (shadow.ego) deps.markEgoSeen?.(shadow.ego);
    if (deps.isAware(obj.kind)) deps.markKindSeen?.(obj.kind);
  }

  const assessed = (obj.notice & OBJ_NOTICE.ASSESSED) !== 0;
  const gates: CombatGates = omniscient
    ? { toA: true, toH: true, toD: true, ac: true, dice: true }
    : {
        toA: !!p.objKnown.toA,
        toH: !!p.objKnown.toH,
        toD: !!p.objKnown.toD,
        /* DEFERRED: p->obj_k->ac and dd/ds runes absent; approximated by the
         * ASSESSED bit (when upstream learns them in practice). */
        ac: assessed,
        dice: assessed,
      };

  const aware = deps.isAware(obj.kind) || (mode & ODESC.STORE) !== 0 || spoil;
  const knownArtifact = objectIsKnownArtifact(shadow);
  const number =
    (mode & ODESC.ALTNUM) && altnum !== undefined ? altnum : obj.number;

  /* Construct the name (L642). */
  let out = objDescName(
    obj,
    shadow,
    prefix,
    mode,
    terse,
    number,
    aware,
    knownArtifact,
    deps,
  );

  /* Combat properties (L645-652). */
  if (mode & ODESC.COMBAT) {
    if (tvalIsChest(obj.tval)) out += objDescChest(obj, shadow);
    else if (tvalIsLight(obj.tval)) out += objDescLight(obj);

    out += objDescCombat(shadow, mode, gates, env);
  }

  /* Modifiers, charges, flavour details, inscriptions (L655-664). */
  if (mode & ODESC.EXTRA) {
    out += objDescMods(shadow);
    out += objDescCharges(obj, mode, deps);
    if (mode & ODESC.STORE) out += objDescAware(obj, shadow, p as Player, env, deps);
    else out += objDescInscrip(obj, shadow, p as Player, env, deps);
  }

  return out;
}
