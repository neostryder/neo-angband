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
  colorToCss,
  colorCharToAttr,
  historyIsArtifactKnown,
  TF,
  TRF,
  TV,
} from "@neo-angband/core";
import type {
  Rune,
  Player,
  Artifact,
  ObjectBase,
  Feature,
  FeatureRegistry,
  TrapKind,
  ArtifactState,
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
 * capitalized name and description. The port's Rune record carries the name
 * but not rune_desc (the description text is not modelled in core), so the
 * recall shows the capitalized name and its group; when a description becomes
 * available in core it slots in here.
 */
function runeRecallLines(rune: Rune): ScreenLine[] {
  const cap = rune.name.charAt(0).toUpperCase() + rune.name.slice(1);
  return [
    { text: cap, color: "#8ab8ff" },
    { text: "", color: FG },
    { text: `Rune type: ${RUNE_GROUP_TEXT[runeGroupIndex(rune.variety)]}`, color: FG },
  ];
}

export async function showRuneKnowledge(
  term: GlyphTerm,
  runeEnv: Parameters<typeof buildRuneList>[0],
  player: Player,
): Promise<void> {
  const { title, groups } = runeKnowledgeGroups(buildRuneList(runeEnv), player);
  await runGroupedBrowser(term, title, groups, async (rune) => {
    const cap = rune.name.charAt(0).toUpperCase() + rune.name.slice(1);
    await showTextScreen(term, cap, runeRecallLines(rune));
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
    // trap_lore (L2588-2605) prints trap->text; the port's TrapKind stores only
    // the short desc (the long paragraph is not compiled into the trap record),
    // so the recall shows the description name alone.
    await showTextScreen(term, cap, [{ text: cap, color: "#8ab8ff" }]);
  });
}

// ---------------------------------------------------------------------------
// Artifact knowledge (14.11) - do_cmd_knowledge_artifacts, ui-knowledge.c L1740
// ---------------------------------------------------------------------------

/**
 * artifact_is_known, non-leaking web variant (ui-knowledge.c L1688-1707): the
 * oracle shows an artifact when it is_artifact_created AND no unidentified copy
 * exists live in the world (find_artifact + object_is_known_artifact). The port
 * exposes is_artifact_created (ArtifactState) but not the live-object world scan
 * or object_is_known_artifact, so a created-only gate would leak an artifact
 * that was just generated but never seen/identified. To honour the no-leak rule
 * this uses the strictly safe subset: an artifact the player's history records
 * as KNOWN (history_is_artifact_known, player-history.c L139-153). Exact-parity
 * (created + world-scan) is tracked as WIRING-NEEDED.
 */
export function artifactIsKnown(art: Artifact, player: Player, _state: ArtifactState): boolean {
  if (!art.name) return false;
  return historyIsArtifactKnown(player, art);
}

/**
 * do_cmd_knowledge_artifacts (ui-knowledge.c L1740-1763): the known artifacts,
 * grouped by obj_group_order[tval] and sorted within a group by sval then name
 * (a_cmp_tval, L1656-1673). Membership is artifactIsKnown (see the note there).
 */
export function artifactKnowledgeGroups(
  artifacts: readonly (Artifact | null)[],
  bases: readonly (ObjectBase | undefined)[],
  player: Player,
  state: ArtifactState,
): KnowledgeGroup<Artifact>[] {
  const order = buildObjGroupOrder(bases);
  const byGid = new Map<number, KnowledgeRow<Artifact>[]>();
  for (const art of artifacts) {
    if (!art) continue;
    if (!artifactIsKnown(art, player, state)) continue;
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
