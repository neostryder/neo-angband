/**
 * The "display current knowledge" sub-browsers (ui-knowledge.c do_cmd_knowledge_*,
 * reached from the '~' master menu). Upstream draws these with an interactive
 * two-pane group/member navigator (display_knowledge, ui-knowledge.c L1050-1240);
 * the web platform substitutes the same flat, grouped, letter-selectable list the
 * rest of this shell uses for browsers (see showMonsterKnowledge / screens.ts
 * monsterKnowledgeMenu). Membership, sort order, grouping, the "N unknown" style
 * counts, and the identification gating are all reproduced exactly - only the
 * navigation widget differs (a UI mechanic the web necessitates).
 *
 * This module is presentation only: it reads already-ported core knowledge state
 * (rune knowledge, feature/trap registries, artifact-created tracking) and never
 * mutates the game. The pure list builders (grouped rows) are exported for unit
 * tests; the interactive `show*` orchestrators drive them through selectFromMenu.
 *
 * C oracle: reference/src/ui-knowledge.c. Attribution: neostryder / RPGM Tools.
 */

import {
  buildRuneList,
  playerKnowsRune,
  runeDesc,
  shapeLoreLines,
  colorToCss,
  colorCharToAttr,
  historyIsArtifactKnown,
  artifactIsKnown as coreArtifactIsKnown,
  makeFakeArtifact,
  makeObjectInfoDeps,
  objectInfo,
  objectDesc,
  knownDescOf,
  blankObjKnowledge,
  playerLearnAllRunes,
  textblockToString,
  OINFO,
  ODESC,
  OBJ_NOTICE,
  KF,
  TF,
  TRF,
  TV,
} from "@neo-angband/core";
import type {
  Rune,
  Player,
  Artifact,
  ObjectBase,
  ObjectKind,
  EgoItem,
  Feature,
  FeatureRegistry,
  TrapKind,
  ArtifactState,
  ArtifactKnownEnv,
  EverseenKnowledge,
  Shape,
  ShapeLoreEnv,
  GameState,
  ObjRegistry,
  Constants,
  RuneEnv,
  ObjectInfoExtras,
} from "@neo-angband/core";
import type { GlyphTerm } from "./term";
import { selectFromMenu, showTextScreen, type MenuItem, type ScreenLine } from "./overlay";

const FG = "#c8c8d4";
const TITLE_COLOR = "#e8e8f0";

/**
 * strcmp: ordinal (byte-order) comparison matching upstream's C library
 * strcmp, so the within-group name ordering is identical to the oracle.
 * (Same helper the monster/object knowledge lists in screens.ts use.)
 */
function strcmp(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * object_text_order[] (ui-knowledge.c L1465-1502): the fixed tval -> display
 * group table shared by the object, artifact and ego browsers. `name === null`
 * means the tval folds into the preceding named group (e.g. TV_BOLT / TV_SHOT
 * join TV_ARROW's "Ammunition"). This is gap 13.1's object-side grouping;
 * porting it verbatim (rather than deriving a different grouping) is the point.
 *
 * Note: ui_knowledge.txt itself defines the MONSTER browser categories
 * (its records are `monster-category:` lines), not object categories - the
 * object grouping is this hardcoded C table. The monster-category grouping is
 * tracked separately (14.16) and not compiled here.
 */
const OBJECT_TEXT_ORDER: ReadonlyArray<{ tval: number; name: string | null }> = [
  { tval: TV["RING"], name: "Ring" },
  { tval: TV["AMULET"], name: "Amulet" },
  { tval: TV["POTION"], name: "Potion" },
  { tval: TV["SCROLL"], name: "Scroll" },
  { tval: TV["WAND"], name: "Wand" },
  { tval: TV["STAFF"], name: "Staff" },
  { tval: TV["ROD"], name: "Rod" },
  { tval: TV["FOOD"], name: "Food" },
  { tval: TV["MUSHROOM"], name: "Mushroom" },
  { tval: TV["PRAYER_BOOK"], name: "Priest Book" },
  { tval: TV["MAGIC_BOOK"], name: "Magic Book" },
  { tval: TV["NATURE_BOOK"], name: "Nature Book" },
  { tval: TV["SHADOW_BOOK"], name: "Shadow Book" },
  { tval: TV["OTHER_BOOK"], name: "Mystery Book" },
  { tval: TV["LIGHT"], name: "Light" },
  { tval: TV["FLASK"], name: "Flask" },
  { tval: TV["SWORD"], name: "Sword" },
  { tval: TV["POLEARM"], name: "Polearm" },
  { tval: TV["HAFTED"], name: "Hafted Weapon" },
  { tval: TV["BOW"], name: "Bow" },
  { tval: TV["ARROW"], name: "Ammunition" },
  { tval: TV["BOLT"], name: null },
  { tval: TV["SHOT"], name: null },
  { tval: TV["SHIELD"], name: "Shield" },
  { tval: TV["CROWN"], name: "Crown" },
  { tval: TV["HELM"], name: "Helm" },
  { tval: TV["GLOVES"], name: "Gloves" },
  { tval: TV["BOOTS"], name: "Boots" },
  { tval: TV["CLOAK"], name: "Cloak" },
  { tval: TV["DRAG_ARMOR"], name: "Dragon Scale Mail" },
  { tval: TV["HARD_ARMOR"], name: "Hard Armor" },
  { tval: TV["SOFT_ARMOR"], name: "Soft Armor" },
  { tval: TV["DIGGING"], name: "Digger" },
  { tval: TV["GOLD"], name: "Money" },
];

/**
 * obj_group_order[] (ui-knowledge.c L3720-3734): map each tval to the index in
 * OBJECT_TEXT_ORDER of its display group. Groups whose base has no svals are
 * skipped (kb_info[tval].num_svals == 0), and a null-name entry inherits the
 * preceding named group's id. Returns tval -> gid (or -1 for "not grouped").
 */
export function buildObjGroupOrder(bases: readonly (ObjectBase | undefined)[]): number[] {
  const maxTval = OBJECT_TEXT_ORDER.reduce((m, e) => Math.max(m, e.tval), 0);
  const order = new Array<number>(maxTval + 1).fill(-1);
  let gid = -1;
  for (let i = 0; i < OBJECT_TEXT_ORDER.length; i++) {
    const entry = OBJECT_TEXT_ORDER[i]!;
    if ((bases[entry.tval]?.numSvals ?? 0) === 0) continue;
    if (entry.name) gid = i;
    order[entry.tval] = gid;
  }
  return order;
}

/** kind_name(gid) (ui-knowledge.c L1675): the display name of group `gid`. */
export function objGroupName(gid: number): string {
  return OBJECT_TEXT_ORDER[gid]?.name ?? "";
}

// ---------------------------------------------------------------------------
// Generic grouped browser
// ---------------------------------------------------------------------------

/** One selectable member of a knowledge group, with a recall payload. */
export interface KnowledgeRow<T> {
  label: string;
  color: string;
  member: T;
}

/** A named group of knowledge rows, rendered as a header + its members. */
export interface KnowledgeGroup<T> {
  name: string;
  rows: KnowledgeRow<T>[];
}

/**
 * Flatten grouped rows into a selectFromMenu list: each non-empty group emits a
 * disabled header row (dim, unselectable - selectFromMenu skips disabled rows
 * for the cursor) followed by its member rows. The parallel `members` array maps
 * a menu index back to its member (null for header rows) so the caller opens the
 * right recall on selection.
 */
export function groupsToMenu<T>(
  groups: readonly KnowledgeGroup<T>[],
): { items: MenuItem[]; members: (T | null)[] } {
  const items: MenuItem[] = [];
  const members: (T | null)[] = [];
  for (const group of groups) {
    if (group.rows.length === 0) continue;
    items.push({ label: group.name, color: "#8a8a94", disabled: true });
    members.push(null);
    for (const row of group.rows) {
      items.push({ label: `  ${row.label}`, color: row.color });
      members.push(row.member);
    }
  }
  return { items, members };
}

/**
 * Drive a grouped knowledge browser: render the flattened list, and when a
 * member is picked open its recall (a full-screen text viewer), then return to
 * the list - exactly like the upstream member pane's 'r'ecall / Enter. ESC on
 * the list closes the browser. `emptyMessage` mirrors upstream returning
 * immediately when the collected set is empty.
 */
export async function runGroupedBrowser<T>(
  term: GlyphTerm,
  title: string,
  groups: readonly KnowledgeGroup<T>[],
  recall: (member: T) => Promise<void>,
): Promise<void> {
  const { items, members } = groupsToMenu(groups);
  if (items.length === 0) return;
  for (;;) {
    const idx = await selectFromMenu(term, title, items);
    if (idx === null) return;
    const member = members[idx];
    if (member == null) continue; // a header row; ignore
    await recall(member);
  }
}

// ---------------------------------------------------------------------------
// Rune knowledge (14.10) - do_cmd_knowledge_runes, ui-knowledge.c L2291
// ---------------------------------------------------------------------------

/** rune_group_text[] (ui-knowledge.c L2178-2188), indexed by RuneVariety. */
const RUNE_GROUP_TEXT = ["Combat", "Modifiers", "Resists", "Brands", "Slays", "Curses", "Other"];

/** The variety -> group index used by rune_var (ui-knowledge.c L2211-2214). */
function runeGroupIndex(variety: Rune["variety"]): number {
  switch (variety) {
    case "combat":
      return 0;
    case "mod":
      return 1;
    case "resist":
      return 2;
    case "brand":
      return 3;
    case "slay":
      return 4;
    case "curse":
      return 5;
    case "flag":
      return 6;
  }
}

/**
 * do_cmd_knowledge_runes (ui-knowledge.c L2291-2319): collect every rune the
 * player knows (player_knows_rune, L2309), group by variety (rune_var), and
 * title the screen "runes (N unknown)" where N = max_runes - known. Members keep
 * their init_rune order within each group (rune_var_f has no member comparator).
 */
export function runeKnowledgeGroups(
  allRunes: readonly Rune[],
  player: Player,
): { title: string; groups: KnowledgeGroup<Rune>[]; unknown: number } {
  const groups: KnowledgeGroup<Rune>[] = RUNE_GROUP_TEXT.map((name) => ({ name, rows: [] }));
  let known = 0;
  for (const rune of allRunes) {
    if (!playerKnowsRune(player, rune)) continue;
    known++;
    const gid = runeGroupIndex(rune.variety);
    groups[gid]!.rows.push({ label: rune.name, color: FG, member: rune });
  }
  const unknown = allRunes.length - known;
  return { title: `runes (${unknown} unknown)`, groups, unknown };
}

/**
 * rune_lore (ui-knowledge.c L2216-2230): the recall for one rune - its
 * capitalized name (my_strcap) on the first line, then rune_desc(oid) on the
 * next. rune_desc is now ported in core (obj/knowledge.ts), computed per
 * variety, so the description matches the oracle exactly.
 */
function runeRecallLines(
  rune: Rune,
  runeEnv: Parameters<typeof buildRuneList>[0],
): ScreenLine[] {
  const cap = rune.name.charAt(0).toUpperCase() + rune.name.slice(1);
  const desc = runeDesc(runeEnv, rune);
  const lines: ScreenLine[] = [{ text: cap, color: "#8ab8ff" }];
  if (desc) {
    lines.push({ text: "", color: FG });
    lines.push({ text: desc, color: FG });
  }
  return lines;
}

export async function showRuneKnowledge(
  term: GlyphTerm,
  runeEnv: Parameters<typeof buildRuneList>[0],
  player: Player,
): Promise<void> {
  const { title, groups } = runeKnowledgeGroups(buildRuneList(runeEnv), player);
  await runGroupedBrowser(term, title, groups, async (rune) => {
    const cap = rune.name.charAt(0).toUpperCase() + rune.name.slice(1);
    await showTextScreen(term, cap, runeRecallLines(rune, runeEnv));
  });
}

// ---------------------------------------------------------------------------
// Feature knowledge (14.13) - do_cmd_knowledge_features, ui-knowledge.c L2460
// ---------------------------------------------------------------------------

/** feature_group_text[] (ui-knowledge.c L2329-2340), indexed by feat_order. */
const FEATURE_GROUP_TEXT = [
  "Floors",
  "Doors",
  "Stairs",
  "Walls",
  "Streamers",
  "Obstructions",
  "Stores",
  "Other",
];

/**
 * feat_order (ui-knowledge.c L178-192): the group index of a feature, chosen by
 * the first matching terrain flag in this exact priority order. SHOP and STAIR
 * are checked before the WALL/ROCK families they also carry, and PASSABLE last.
 */
export function featOrder(reg: FeatureRegistry, feat: Feature): number {
  const has = (tf: number): boolean => reg.featHas(feat.fidx, tf);
  if (has(TF["SHOP"])) return 6;
  if (has(TF["STAIR"])) return 2;
  if (has(TF["DOOR_ANY"])) return 1;
  if (has(TF["MAGMA"]) || has(TF["QUARTZ"])) return 4;
  if (has(TF["WALL"])) return 3;
  if (has(TF["ROCK"])) return 5;
  if (has(TF["PASSABLE"])) return 0;
  return 7;
}

/**
 * do_cmd_knowledge_features (ui-knowledge.c L2460-2486): every feature with a
 * name that is not a mimic (L2474-2477), grouped by feat_order, sorted within a
 * group by name (f_cmp_fkind, L2368-2385). The name is shown in the feature's
 * display colour so the terrain's symbol colour is conveyed in the flat list.
 */
export function featureKnowledgeGroups(reg: FeatureRegistry): KnowledgeGroup<Feature>[] {
  const groups: KnowledgeGroup<Feature>[] = FEATURE_GROUP_TEXT.map((name) => ({ name, rows: [] }));
  for (const feat of reg.allFeatures()) {
    if (!feat.name || feat.mimic) continue; // L2476: skip nameless + mimics
    const gid = featOrder(reg, feat);
    groups[gid]!.rows.push({
      label: feat.name,
      color: colorToCss(colorCharToAttr(feat.dAttr)),
      member: feat,
    });
  }
  for (const g of groups) g.rows.sort((a, b) => strcmp(a.member.name, b.member.name));
  return groups;
}

export async function showFeatureKnowledge(term: GlyphTerm, reg: FeatureRegistry): Promise<void> {
  await runGroupedBrowser(term, "features", featureKnowledgeGroups(reg), async (feat) => {
    const cap = feat.name.charAt(0).toUpperCase() + feat.name.slice(1);
    const lines: ScreenLine[] = [{ text: cap, color: "#8ab8ff" }];
    if (feat.desc) {
      lines.push({ text: "", color: FG });
      lines.push({ text: feat.desc, color: FG });
    }
    await showTextScreen(term, cap, lines);
  });
}

// ---------------------------------------------------------------------------
// Trap knowledge (14.13) - do_cmd_knowledge_traps, ui-knowledge.c L2641
// ---------------------------------------------------------------------------

/** trap_group_text[] (ui-knowledge.c L2496-2503), indexed by trap_order. */
const TRAP_GROUP_TEXT = ["Runes", "Locks", "Traps", "Other"];

/**
 * trap_order (ui-knowledge.c L2530-2542): GLYPH -> 0, LOCK -> 1, TRAP -> 2,
 * everything else -> 3.
 */
export function trapOrder(trap: TrapKind): number {
  if (trap.flags.has(TRF["GLYPH"])) return 0;
  if (trap.flags.has(TRF["LOCK"])) return 1;
  if (trap.flags.has(TRF["TRAP"])) return 2;
  return 3;
}

/**
 * do_cmd_knowledge_traps (ui-knowledge.c L2641-2664): every trap kind with a
 * name (L2656), grouped by trap_order, sorted within a group by description
 * name (t_cmp_tkind, L2544-2566, which compares on the desc field). The desc is
 * shown in the trap's colour to convey its symbol colour.
 */
export function trapKnowledgeGroups(traps: readonly TrapKind[]): KnowledgeGroup<TrapKind>[] {
  const groups: KnowledgeGroup<TrapKind>[] = TRAP_GROUP_TEXT.map((name) => ({ name, rows: [] }));
  for (const trap of traps) {
    if (!trap.name) continue; // L2656: skip nameless slots
    const gid = trapOrder(trap);
    groups[gid]!.rows.push({
      label: trap.desc,
      color: colorToCss(colorCharToAttr(trap.color)),
      member: trap,
    });
  }
  for (const g of groups) g.rows.sort((a, b) => strcmp(a.member.desc, b.member.desc));
  return groups;
}

export async function showTrapKnowledge(term: GlyphTerm, traps: readonly TrapKind[]): Promise<void> {
  await runGroupedBrowser(term, "traps", trapKnowledgeGroups(traps), async (trap) => {
    const cap = trap.desc.charAt(0).toUpperCase() + trap.desc.slice(1);
    // trap_lore (ui-knowledge.c L2588-2605): capitalized desc then trap->text.
    // Upstream only opens the recall when trap->text is non-empty (L2590); a
    // trap with no paragraph shows just the title, matching that guard.
    const lines: ScreenLine[] = [{ text: cap, color: "#8ab8ff" }];
    if (trap.text) {
      lines.push({ text: "", color: FG });
      lines.push({ text: trap.text, color: FG });
    }
    await showTextScreen(term, cap, lines);
  });
}

// ---------------------------------------------------------------------------
// Artifact knowledge (14.11) - do_cmd_knowledge_artifacts, ui-knowledge.c L1740
// ---------------------------------------------------------------------------

/**
 * artifact_is_known (ui-knowledge.c L1687-1707): the oracle lists an artifact
 * when it is_artifact_created AND no unidentified copy exists live in the world
 * (find_artifact + object_is_known_artifact). That exact gate is now ported in
 * core (obj/artifact-known.ts); pass its `exact` env (a world-object scan +
 * is_artifact_created + wizard) to use it verbatim.
 *
 * Without the `exact` env this falls back to the strictly-safe subset - an
 * artifact the player's history records as KNOWN (history_is_artifact_known,
 * player-history.c L139-153) - which never leaks, so a caller that has not yet
 * assembled the world scan still gets a correct (if narrower) list.
 */
export function artifactIsKnown(
  art: Artifact,
  player: Player,
  _state: ArtifactState,
  exact?: ArtifactKnownEnv,
): boolean {
  if (!art.name) return false;
  if (exact) return coreArtifactIsKnown(art, exact);
  return historyIsArtifactKnown(player, art);
}

/**
 * do_cmd_knowledge_artifacts (ui-knowledge.c L1740-1763): the known artifacts,
 * grouped by obj_group_order[tval] and sorted within a group by sval then name
 * (a_cmp_tval, L1656-1673). Membership is artifactIsKnown (see the note there);
 * pass `exact` for the exact created-and-not-live-unidentified gate.
 */
export function artifactKnowledgeGroups(
  artifacts: readonly (Artifact | null)[],
  bases: readonly (ObjectBase | undefined)[],
  player: Player,
  state: ArtifactState,
  exact?: ArtifactKnownEnv,
): KnowledgeGroup<Artifact>[] {
  const order = buildObjGroupOrder(bases);
  const byGid = new Map<number, KnowledgeRow<Artifact>[]>();
  for (const art of artifacts) {
    if (!art) continue;
    if (!artifactIsKnown(art, player, state, exact)) continue;
    const gid = order[art.tval] ?? -1;
    if (gid < 0) continue;
    if (!byGid.has(gid)) byGid.set(gid, []);
    byGid.get(gid)!.push({ label: art.name, color: FG, member: art });
  }
  const gids = Array.from(byGid.keys()).sort((a, b) => a - b);
  return gids.map((gid) => {
    const rows = byGid.get(gid)!;
    rows.sort((a, b) => {
      const c = a.member.sval - b.member.sval;
      if (c) return c;
      return strcmp(a.member.name, b.member.name);
    });
    return { name: objGroupName(gid), rows };
  });
}

/**
 * The deps showArtifactKnowledge needs beyond the artifact list: the live game
 * state, the object registry (base-kind lookup for make_fake_artifact), the
 * z_info constants, the player, the created-flag state, the object-info extras
 * (projections / race origins), the rune env, and the optional exact
 * artifact_is_known env.
 */
export interface ArtifactKnowledgeDeps {
  state: GameState;
  reg: ObjRegistry;
  constants: Constants;
  player: Player;
  artState: ArtifactState;
  inspectExtras: ObjectInfoExtras;
  runeEnv: RuneEnv;
  exact?: ArtifactKnownEnv;
  /** seed_randart (do_cmd_knowledge_artifacts L1756), for the title under
   * birth_randarts. Absent -> the plain "artifacts" title. */
  seedRandart?: number;
}

const RECALL_TITLE = "#8ab8ff";

/**
 * desc_art_fake (ui-knowledge.c L1610-1654): the artifact-knowledge recall.
 * Upstream builds a fake artifact object (make_fake_artifact), points its known
 * twin at either a base twin (kind + artifact only) or - when the character's
 * history records the artifact as fully known (history_is_artifact_known,
 * L1636) - a full object_copy, then dumps object_info(obj, OINFO_NONE) under
 * object_desc(ODESC_PREFIX|ODESC_FULL|ODESC_CAPITAL).
 *
 * The port synthesises the known-shadow on demand from the player's rune
 * knowledge (obj/known-object.ts), so this reproduces the two twin states with
 * a scratch player whose object-knowledge is set to match:
 * - fully known: every rune learned (playerLearnAllRunes) + the object marked
 *   ASSESSED, so the shadow reveals the full mechanics, exactly as the
 *   object_copy twin would;
 * - base only: a zeroed object-knowledge (not even the birth-known dice/combat
 *   runes) and the object left un-assessed, so the shadow exposes only the base
 *   item, exactly as C's raw OBJECT_NULL twin. The artifact flavour paragraph
 *   still shows in this branch (known_obj->artifact is set, L1631), so it is
 *   prepended explicitly since the un-assessed shadow carries no artifact.
 *
 * DETERMINISM: make_fake_artifact draws its curse-timeout RNG from a dedicated
 * throwaway stream (obj/artifact-fake.ts), never the game RNG, so browsing an
 * artifact never perturbs the game state. The scratch player is a shallow clone
 * with its own object-knowledge block, so the live player's knowledge is never
 * mutated.
 */
export function artifactFakeRecall(
  deps: ArtifactKnowledgeDeps,
  art: Artifact,
): { title: string; lines: ScreenLine[] } {
  const { state, reg, constants, player, runeEnv, inspectExtras } = deps;

  const obj = makeFakeArtifact(reg, constants, art);
  if (!obj) {
    /* No base kind: make_fake_artifact returns false (L737); show the name. */
    const lines: ScreenLine[] = [{ text: art.name, color: RECALL_TITLE }];
    if (art.text) {
      lines.push({ text: "", color: FG });
      lines.push({ text: art.text, color: FG });
    }
    return { title: art.name, lines };
  }

  const fullyKnown = historyIsArtifactKnown(player, art);

  /* A fully-known scratch player for the header name (the artifact name is not
   * a spoiler; object_desc reads the known twin's artifact for it). */
  const namePlayer: Player = { ...player, objKnown: blankObjKnowledge() };
  playerLearnAllRunes(namePlayer, runeEnv);
  const nameState: GameState = {
    ...state,
    actor: { ...state.actor, player: namePlayer },
    isAware: () => true,
  };
  const savedNotice = obj.notice;
  obj.notice |= OBJ_NOTICE.ASSESSED;
  const title = objectDesc(
    obj,
    ODESC.PREFIX | ODESC.FULL | ODESC.CAPITAL,
    namePlayer,
    runeEnv,
    knownDescOf(nameState),
  );

  /* Now build the body under the branch-appropriate knowledge. */
  const scratchKnown = blankObjKnowledge();
  if (fullyKnown) {
    /* object_copy(known_obj, obj): everything known. */
    playerLearnAllRunes({ ...player, objKnown: scratchKnown } as Player, runeEnv);
    obj.notice |= OBJ_NOTICE.ASSESSED;
  } else {
    /* Base twin: zero even the birth-known dice/combat runes so only the base
     * item shows, and leave the object un-assessed. */
    scratchKnown.toA = 0;
    scratchKnown.toH = 0;
    scratchKnown.toD = 0;
    scratchKnown.dd = 0;
    scratchKnown.ds = 0;
    scratchKnown.ac = 0;
    obj.notice = savedNotice & ~OBJ_NOTICE.ASSESSED;
  }
  const scratchPlayer: Player = { ...player, objKnown: scratchKnown };
  const scratchState: GameState = {
    ...state,
    actor: { ...state.actor, player: scratchPlayer },
    isAware: () => true,
  };

  const tb = objectInfo(obj, OINFO.NONE, makeObjectInfoDeps(scratchState, obj, inspectExtras));
  const bodyText = textblockToString(tb);

  const lines: ScreenLine[] = [];
  /* Base branch: the artifact flavour paragraph (known_obj->artifact set). */
  if (!fullyKnown && art.text) {
    lines.push({ text: art.text, color: FG });
    lines.push({ text: "", color: FG });
  }
  for (const raw of bodyText.split("\n")) {
    lines.push({ text: raw.replace(/\s+$/u, ""), color: FG });
  }
  /* Trim leading blank lines object_info emits before the first real line. */
  while (lines.length > 1 && lines[0]!.text === "") lines.shift();

  return { title, lines };
}

/**
 * do_cmd_knowledge_artifacts (ui-knowledge.c L1740): the grouped artifact
 * browser with the desc_art_fake recall wired in. Membership + grouping come
 * from artifactKnowledgeGroups; the recall is the full faithful object_info
 * dump (artifactFakeRecall).
 */
export async function showArtifactKnowledge(
  term: GlyphTerm,
  deps: ArtifactKnowledgeDeps,
): Promise<void> {
  const groups = artifactKnowledgeGroups(
    deps.reg.artifacts,
    deps.reg.bases,
    deps.player,
    deps.artState,
    deps.exact,
  );
  const seed = deps.seedRandart ?? 0;
  const title =
    deps.state.options?.get("birth_randarts") && deps.seedRandart !== undefined
      ? `artifacts (seed ${(seed >>> 0).toString(16).padStart(8, "0")})`
      : "artifacts";
  await runGroupedBrowser(term, title, groups, async (art) => {
    const recall = artifactFakeRecall(deps, art);
    await showTextScreen(term, recall.title, recall.lines);
  });
}

// ---------------------------------------------------------------------------
// Object knowledge (14.9) - textui_browse_object_knowledge, ui-knowledge.c L2139
// ---------------------------------------------------------------------------

/**
 * The per-kind knowledge the object browser reads. Mirrors the object_kind
 * fields upstream reads: object_flavor_is_aware / _was_tried (FlavorKnowledge),
 * kind->everseen (EverseenKnowledge), kind->flavor != NULL (hasFlavor), and
 * object_kind_name (kindName, the leak-safe name: real name when aware, flavour
 * text when an unidentified flavoured kind, per obj-desc.c L48).
 */
export interface ObjectBrowserDeps {
  isAware(kind: ObjectKind): boolean;
  wasTried(kind: ObjectKind): boolean;
  everseen(kind: ObjectKind): boolean;
  hasFlavor(kind: ObjectKind): boolean;
  /** object_kind_name(kind, aware): the display name, never leaking a flavour. */
  kindName(kind: ObjectKind, aware: boolean): string;
  /**
   * The `{` inscribe action inside the object-knowledge browser
   * (ui-knowledge.c:2101-2123): set/update/clear the highlighted kind's
   * autoinscription. Optional so existing callers/tests still compile; when
   * present, `{` is bound in the browser and invokes this for the highlighted
   * kind. The callback owns the "Inscribe with: " prompt and the registry
   * write (see main.ts). The browser awaits it, then repaints.
   */
  setAutoinscription?(kind: ObjectKind): Promise<void> | void;
}

/** o_cmp_tval within-group order (ui-knowledge.c L1984-2024). */
function objCmpTval(a: ObjectKind, b: ObjectKind, deps: ObjectBrowserDeps): number {
  /* aware has low sort weight: aware kinds sort first (return -c). */
  const c = (deps.isAware(a) ? 1 : 0) - (deps.isAware(b) ? 1 : 0);
  if (c) return -c;
  switch (a.tval) {
    case TV["LIGHT"]:
    case TV["MAGIC_BOOK"]:
    case TV["PRAYER_BOOK"]:
    case TV["NATURE_BOOK"]:
    case TV["SHADOW_BOOK"]:
    case TV["OTHER_BOOK"]:
    case TV["DRAG_ARMOR"]:
      break; // leave sorted by sval
    default:
      if (deps.isAware(a)) return strcmp(a.name, b.name);
      /* Then in tried order, then by flavour text (approximated by kindName's
       * unaware output - the leak-safe flavour string). */
      const t = (deps.wasTried(a) ? 1 : 0) - (deps.wasTried(b) ? 1 : 0);
      if (t) return -t;
      return strcmp(deps.kindName(a, false), deps.kindName(b, false));
  }
  return a.sval - b.sval;
}

/**
 * textui_browse_object_knowledge (ui-knowledge.c L2139-2168): every kind that
 * is everseen OR flavoured (so an unfound flavour still lists by its flavour
 * name), excluding INSTA_ART special-artifact dummies and kinds whose tval has
 * no display group. Grouped by obj_group_order, sorted within a group by
 * o_cmp_tval. The label is object_kind_name plus " {tried}" for a tried-but-
 * unaware flavour (display_object L1915-1916).
 */
export function objectKnowledgeGroups(
  kinds: readonly ObjectKind[],
  bases: readonly (ObjectBase | undefined)[],
  deps: ObjectBrowserDeps,
): KnowledgeGroup<ObjectKind>[] {
  const order = buildObjGroupOrder(bases);
  const byGid = new Map<number, ObjectKind[]>();
  for (const kind of kinds) {
    if (!kind) continue;
    const listed = deps.everseen(kind) || deps.hasFlavor(kind);
    if (!listed) continue;
    if (kind.kindFlags.has(KF.INSTA_ART)) continue;
    const gid = order[kind.tval] ?? -1;
    if (gid < 0) continue;
    if (!byGid.has(gid)) byGid.set(gid, []);
    byGid.get(gid)!.push(kind);
  }
  const gids = Array.from(byGid.keys()).sort((a, b) => a - b);
  return gids.map((gid) => {
    const members = byGid.get(gid)!;
    members.sort((a, b) => objCmpTval(a, b, deps));
    const rows: KnowledgeRow<ObjectKind>[] = members.map((kind) => {
      const aware = !deps.hasFlavor(kind) || deps.isAware(kind);
      let label = deps.kindName(kind, aware);
      if (deps.wasTried(kind) && !aware) label += " {tried}";
      return { label, color: FG, member: kind };
    });
    return { name: objGroupName(gid), rows };
  });
}

export async function showObjectKnowledge(
  term: GlyphTerm,
  kinds: readonly ObjectKind[],
  bases: readonly (ObjectBase | undefined)[],
  deps: ObjectBrowserDeps,
): Promise<void> {
  const groups = objectKnowledgeGroups(kinds, bases, deps);
  const recall = async (kind: ObjectKind): Promise<void> => {
    const aware = !deps.hasFlavor(kind) || deps.isAware(kind);
    const title = deps.kindName(kind, aware);
    // desc_obj_fake (ui-knowledge.c L1938) shows object_info(OINFO_FAKE); the
    // computed flag/combat lines are deferred, so the recall shows the name and
    // the kind's flavour/description text when known.
    const lines: ScreenLine[] = [{ text: title, color: "#8ab8ff" }];
    if (aware && kind.text) {
      lines.push({ text: "", color: FG });
      lines.push({ text: kind.text, color: FG });
    }
    await showTextScreen(term, title, lines);
  };

  // Without the `{` inscribe callback the shared grouped browser suffices.
  const inscribe = deps.setAutoinscription;
  if (!inscribe) {
    await runGroupedBrowser(term, "known objects", groups, recall);
    return;
  }

  // With `{` bound (ui-knowledge.c:2101-2123: "Inscribe with: " sets the
  // highlighted kind's autoinscription), drive the browser locally so the
  // async prompt can run between repaints. `{` resolves the menu on the
  // cursor row, we run the callback, then re-open on the same row - exactly
  // like the upstream screen_save/screen_load round the prompt.
  const { items, members } = groupsToMenu(groups);
  if (items.length === 0) return;
  let cursor: number | undefined;
  for (;;) {
    let inscribeRow: number | null = null;
    const idx = await selectFromMenu(term, "known objects", items, undefined, {
      ...(cursor !== undefined ? { initialCursor: cursor } : {}),
      onHighlight: (i) => {
        cursor = i;
      },
      footer: "[ a-z to choose, { to inscribe, ESC to cancel ]",
      commands: {
        "{": (cur) => {
          inscribeRow = cur;
          return cur;
        },
      },
    });
    if (idx === null) return;
    const member = members[idx];
    if (member == null) continue; // a header row; ignore
    if (inscribeRow !== null) {
      await inscribe(member); // owns the "Inscribe with: " prompt + registry write
      continue; // re-open (repaint) on the same cursor row
    }
    await recall(member);
  }
}

// ---------------------------------------------------------------------------
// Ego item knowledge (14.12) - do_cmd_knowledge_ego_items, ui-knowledge.c L1827
// ---------------------------------------------------------------------------

/**
 * do_cmd_knowledge_ego_items (ui-knowledge.c L1827-1875): every ego the player
 * has everseen, expanded into one entry per object-group its poss_items span
 * (default_join), grouped by obj_group_order and sorted by group then name
 * (e_cmp_tval L1810-1824). Membership is ego->everseen (L1847).
 */
export function egoKnowledgeGroups(
  egos: readonly EgoItem[],
  kinds: readonly ObjectKind[],
  bases: readonly (ObjectBase | undefined)[],
  everseen: EverseenKnowledge,
): KnowledgeGroup<EgoItem>[] {
  const order = buildObjGroupOrder(bases);
  const byGid = new Map<number, EgoItem[]>();
  for (const ego of egos) {
    if (!ego || !ego.name) continue;
    if (!everseen.egoSeen(ego)) continue;
    /* The set of display groups this ego can appear in (its poss_items' tvals),
     * matching the default_join expansion. */
    const gids = new Set<number>();
    for (const kidx of ego.possItems) {
      const tval = kinds[kidx]?.tval;
      if (tval === undefined) continue;
      const gid = order[tval] ?? -1;
      if (gid >= 0) gids.add(gid);
    }
    for (const gid of gids) {
      if (!byGid.has(gid)) byGid.set(gid, []);
      byGid.get(gid)!.push(ego);
    }
  }
  const gids = Array.from(byGid.keys()).sort((a, b) => a - b);
  return gids.map((gid) => {
    const rows = byGid
      .get(gid)!
      .sort((a, b) => strcmp(a.name, b.name))
      .map((ego) => ({ label: ego.name, color: FG, member: ego }));
    return { name: objGroupName(gid), rows };
  });
}

export async function showEgoKnowledge(
  term: GlyphTerm,
  egos: readonly EgoItem[],
  kinds: readonly ObjectKind[],
  bases: readonly (ObjectBase | undefined)[],
  everseen: EverseenKnowledge,
): Promise<void> {
  const groups = egoKnowledgeGroups(egos, kinds, bases, everseen);
  await runGroupedBrowser(term, "ego items", groups, async (ego) => {
    // desc_ego_fake (ui-knowledge.c L1789) shows object_info_ego's flag lines;
    // those computed lines are deferred, so the recall shows the ego name and
    // its lore text when the record carries one.
    const lines: ScreenLine[] = [{ text: ego.name, color: "#8ab8ff" }];
    if (ego.text) {
      lines.push({ text: "", color: FG });
      lines.push({ text: ego.text, color: FG });
    }
    await showTextScreen(term, ego.name, lines);
  });
}

// ---------------------------------------------------------------------------
// Shapechange knowledge (14.14) - do_cmd_knowledge_shapechange, ui-knowledge.c
// L3142
// ---------------------------------------------------------------------------

/**
 * do_cmd_knowledge_shapechange (ui-knowledge.c L3142-3260): every shape except
 * "normal" (count_interesting_shapes L2675), sorted alphabetically by name
 * (compare_shape_names, my_stricmp - case-insensitive L2696). Each recall is
 * the ported shape_lore textblock (core shapeLoreLines).
 */
export function shapeKnowledgeRows(shapes: readonly Shape[]): Shape[] {
  return shapes
    .filter((s) => s.name !== "normal")
    .sort((a, b) => strcmp(a.name.toLowerCase(), b.name.toLowerCase()));
}

export async function showShapeKnowledge(
  term: GlyphTerm,
  shapes: readonly Shape[],
  env: ShapeLoreEnv,
): Promise<void> {
  const rows = shapeKnowledgeRows(shapes);
  if (rows.length === 0) return;
  const groups: KnowledgeGroup<Shape>[] = [
    { name: "Shapes", rows: rows.map((s) => ({ label: s.name, color: FG, member: s })) },
  ];
  await runGroupedBrowser(term, "shapes", groups, async (shape) => {
    const lines = shapeLoreLines(shape, env).map((text, i) => ({
      text,
      color: i === 0 ? "#8ab8ff" : FG,
    }));
    await showTextScreen(term, shape.name, lines);
  });
}
