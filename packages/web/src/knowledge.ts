/**
 * The "display current knowledge" sub-browsers (ui-knowledge.c do_cmd_knowledge_*,
 * reached from the '~' master menu). These are drawn with upstream's own two-pane
 * group/member navigator (display_knowledge, ui-knowledge.c L1050-1240) - see
 * runGroupedBrowser.
 *
 * THEY USED NOT TO BE, and this header said so: the web platform "substitutes the
 * same flat, grouped, letter-selectable list the rest of this shell uses". That
 * substitution is what made known objects unusable. Flattening every group into
 * one menu makes several hundred rows, the letters run out at the fifty-second,
 * and a group heading becomes a dim row to scroll past rather than a thing to
 * choose. Upstream's two menus letter NOTHING - both are built from iters whose
 * `get_tag` is NULL, and menu_init memsets `selections` to NULL - because picking
 * a group first is what keeps the member list short enough to be a list.
 * Membership, sort order, grouping, the "N unknown" counts and the identification
 * gating were already exact, and are untouched.
 *
 * This module is presentation only: it reads already-ported core knowledge state
 * (rune knowledge, feature/trap registries, artifact-created tracking) and never
 * mutates the game. The pure list builders (grouped rows) are exported for unit
 * tests; the interactive `show*` orchestrators drive them through selectFromMenu.
 *
 * C oracle: reference/src/ui-knowledge.c. Attribution: neostryder / RPGM Tools.
 */

import { inputEvents } from "./input-door";
import {
  COLOUR_YELLOW,
  COLOUR_VIOLET,
  RF,
  buildRuneList,
  playerKnowsRune,
  runeName,
  runeDesc,
  shapeLoreLines,
  colorToCss,
  colorCharToAttr,
  historyIsArtifactKnown,
  artifactIsKnown as coreArtifactIsKnown,
  makeFakeArtifact,
  makeFakeKind,
  objectInfoEgo,
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
} from "@rpgm-tools/neo-angband-core";
import type {
  Rune,
  Player,
  MonsterRace,
  MonsterLore,
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
} from "@rpgm-tools/neo-angband-core";
import { setActiveCellTap, type GridPointerInput, type GridSurface } from "./term";
import {
  promptText,
  showTextScreen,
  menuNav,
  type MenuNav,
  type ScreenLine,
} from "./overlay";
import { UI_TEXT, UI_DIM, UI_CURSOR } from "./ui-colors";

const FG = UI_TEXT;
/* COLOUR_YELLOW: display_rune paints the autoinscription in it. */
const UI_YELLOW = colorToCss(COLOUR_YELLOW);

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
  /**
   * Extra fields the member renderer writes at FIXED columns, in its own
   * colours - upstream's member display callback after the name: display_rune's
   * yellow autoinscription at column 47 (ui-knowledge.c:2201-2202),
   * display_monster's symbol / kills / fully-known at 64 / 68 / 75
   * (`:1200-1213`). A list rather than one annotation because that is what the
   * callbacks do; the header above them is the browser's `otherfields`.
   */
  cells?: readonly { text: string; color: string; col: number }[];
  /**
   * The row's own prompt line, i.e. an xtra_prompt hook (rune_xtra_prompt,
   * ui-knowledge.c:2238-2244 returns a DIFFERENT string per row depending on
   * whether that rune carries a note).
   */
  hint?: string;
}

/** A named group of knowledge rows, rendered as a header + its members. */
export interface KnowledgeGroup<T> {
  name: string;
  rows: KnowledgeRow<T>[];
}

/* groupsToMenu - which flattened the groups into one lettered list with a dim
 * header row per group - is GONE, along with the two callers that drove it. It
 * was the whole reason known objects handed out letters it could not honour
 * past the fifty-second row. See runGroupedBrowser below for what upstream
 * actually draws. */

/** Optional hooks a browser can add, mirroring member_funcs' xtra_* callbacks. */
export interface GroupedBrowserHooks<T> {
  /**
   * rune_xtra_act (ui-knowledge.c L2247): a key the member pane handles itself.
   * Return true if the key was consumed. Async because the port's version of
   * "type an inscription" is an await, where upstream's is a blocking
   * get_string.
   */
  xtraAct?: (key: string, member: T) => Promise<boolean>;
  /**
   * display_knowledge's `otherfields` (ui-knowledge.c:931-932): one header
   * string printed at column 46 of the label row, naming whatever extra columns
   * that browser's member renderer writes. It is passed VERBATIM by the caller
   * because upstream's is a literal with its own leading padding - monsters
   * pass `"                 Sym  Kills  Full"` (`:1451`).
   */
  otherfields?: string;
  /**
   * g_funcs.summary (ui-knowledge.c:997-1001): one line for the CURRENT group,
   * drawn at the member column just under the member list. Only the monster
   * browser supplies one (mon_summary, `:1303`); every other g_funcs leaves the
   * field NULL and the row stays blank.
   */
  summary?: (groupIndex: number) => { text: string; color: string } | null;
}

/** Row 5's rule and the `|` divider are drawn at these fixed offsets. */
const OTHERFIELDS_COL = 46;
const BROWSER_TITLE_ROW = 2;
const BROWSER_LABEL_ROW = 4;
const BROWSER_RULE_ROW = 5;
const BROWSER_TOP = 6;

/**
 * display_knowledge (ui-knowledge.c L1050-1240): the real two-pane knowledge
 * browser - Group on the left, Name on the right, a `|` between them and a rule
 * of `=` above.
 *
 * WHY THIS REPLACED A FLAT LIST. The port flattened the groups into one lettered
 * menu, with a dim header row per group, and lettered every row a..z then A..Z.
 * Known objects runs to several hundred rows, so past the fifty-second every row
 * was drawn with a blank tag and could only be reached by scrolling - and the
 * lettering itself was an invention. Upstream's two menus are built with
 * `menu_find_iter(MN_ITER_STRINGS)` and `{NULL, NULL, display_group_member, NULL,
 * NULL}`; both have a NULL `get_tag`, and `menu_init` memsets `selections` to
 * NULL, so `display_menu_row` prints no tag at all on either side. There are no
 * letters in this screen. It is arrows, and choosing a group is what makes the
 * member list short enough to be a list.
 *
 * The panel dance is upstream's, including which key does what:
 *
 *   scroll_process_direction: LEFT -> EVT_ESCAPE, RIGHT -> EVT_SELECT.
 *   EVT_ESCAPE: panel 1 goes back to panel 0; panel 0 leaves.
 *   EVT_SELECT: panel 0 enters panel 1; panel 1 recalls the row it is on.
 *   'r' / 'R': recall, from either panel.
 *
 * so ESC is "back one level" here without any port-specific rule for it.
 */
export async function runGroupedBrowser<T>(
  term: GridSurface & GridPointerInput,
  title: string,
  groups: readonly KnowledgeGroup<T>[],
  recall: (member: T, groupName: string) => Promise<void>,
  hooks: GroupedBrowserHooks<T> = {},
): Promise<void> {
  /* Upstream builds g_list from the sorted object list, so a group with no
   * members cannot appear; ours are built per group, so drop the empties here. */
  const live = groups.filter((g) => g.rows.length > 0);
  if (live.length === 0) return;

  /* g_name_len: at least 8, at most 20 (L1136-1142). */
  let nameLen = 8;
  for (const g of live) nameLen = Math.max(nameLen, g.name.length);
  if (nameLen >= 20) nameLen = 20;
  const memberCol = nameLen + 3;

  let group = 0;
  let member = 0;
  /* panel 0 = the group list, panel 1 = the member list (upstream's `panel`). */
  let panel: 0 | 1 = 0;
  let groupTop = 0;
  let memberTop = 0;

  for (;;) {
    const wanted = await browsePanels();
    if (wanted === null) return;
    /* desc_ego_fake's header names the group the row was chosen from
     * (ego_grp_name(default_group_id(oid)), ui-knowledge.c L1801), so hand the
     * highlighted group's name along with the member. */
    await recall(wanted, live[group]?.name ?? "");
  }

  /** Paint, then read keys until a member is chosen for recall (or ESC leaves). */
  function browsePanels(): Promise<T | null> {
    return new Promise<T | null>((resolve) => {
      const paint = (): void => {
        const { cols, rows } = term.size();
        const browserRows = Math.max(1, rows - 8);
        term.clear();
        term.print(0, BROWSER_TITLE_ROW, `Knowledge - ${title}`.slice(0, cols - 1), UI_CURSOR);
        term.print(0, BROWSER_LABEL_ROW, "Group", UI_DIM);
        term.print(memberCol, BROWSER_LABEL_ROW, "Name", UI_DIM);
        /* prt(otherfields, 4, 46) (ui-knowledge.c:931-932) - the same row as the
         * Group/Name labels, at a column upstream hard-codes. */
        if (hooks.otherfields && OTHERFIELDS_COL < cols - 1) {
          term.print(
            OTHERFIELDS_COL,
            BROWSER_LABEL_ROW,
            hooks.otherfields.slice(0, cols - 1 - OTHERFIELDS_COL),
            UI_DIM,
          );
        }
        term.print(0, BROWSER_RULE_ROW, "=".repeat(Math.min(cols - 1, 79)), UI_DIM);

        const rows_ = live[group]?.rows ?? [];
        /* Both panes scroll independently, each chasing its own cursor. */
        groupTop = clampTop(groupTop, group, live.length, browserRows);
        memberTop = clampTop(memberTop, member, rows_.length, browserRows);

        for (let r = 0; r < browserRows; r++) {
          const y = BROWSER_TOP + r;
          term.print(nameLen + 1, y, "|", UI_DIM);
          const g = live[groupTop + r];
          if (g) {
            const sel = groupTop + r === group;
            term.print(
              0,
              y,
              g.name.slice(0, nameLen),
              /* curs_attrs: only the ACTIVE pane's cursor is lit; the inactive
               * one keeps a dimmer mark so the player can still see where they
               * were (upstream draws the inactive menu with cursor=false). */
              sel ? (panel === 0 ? UI_CURSOR : UI_DIM) : FG,
            );
          }
          const row = rows_[memberTop + r];
          if (row) {
            const sel = memberTop + r === member;
            term.print(
              memberCol,
              y,
              row.label.slice(0, cols - 1 - memberCol),
              sel ? (panel === 1 ? UI_CURSOR : UI_DIM) : row.color,
            );
            for (const cell of row.cells ?? []) {
              if (!cell.text || cell.col >= cols - 1) continue;
              term.print(cell.col, y, cell.text.slice(0, cols - 1 - cell.col), cell.color);
            }
          }
        }
        /* g_funcs.summary(..., object_menu.active.row + active.page_rows,
         * object_region.col) (ui-knowledge.c:997-1001): the row immediately
         * below the member list, at the member column. */
        const sum = hooks.summary?.(group);
        if (sum && sum.text) {
          term.print(
            memberCol,
            BROWSER_TOP + browserRows,
            sum.text.slice(0, cols - 1 - memberCol),
            sum.color,
          );
        }
        term.setCursor?.(
          panel === 0 ? 0 : memberCol,
          BROWSER_TOP + (panel === 0 ? group - groupTop : member - memberTop),
        );
        /* prt(format("<dir>%s%s%s, ESC", ...), hgt - 1, 0) (L1191), where the
         * last %s is member_funcs.xtra_prompt for the row under the cursor -
         * KnowledgeRow.hint here, which already carries upstream's exact strings
         * (rune_xtra_prompt's ", 'r'ecall, '{', '}'"). The port spells the arrows
         * out, because "<dir>" is a manual convention rather than a legend, and
         * names the read key itself when the row offers no prompt of its own. */
        const xtra = rows_[member]?.hint ?? "";
        const nav =
          panel === 0
            ? "[ arrows to choose a group, right/Enter for its names, ESC to leave ]"
            : xtra
              ? `[ arrows${xtra}, left/ESC back to the groups ]`
              : "[ arrows, Enter or 'r' to read, left/ESC back to the groups ]";
        term.print(0, rows - 1, nav.slice(0, cols - 1), UI_DIM);
      };

      const finish = (value: T | null): void => {
        inputEvents.removeEventListener("keydown", onKey, true);
        setActiveCellTap(term, null);
        resolve(value);
      };

      const recallHere = (): void => {
        const row = live[group]?.rows[member];
        if (row) finish(row.member);
      };

      const onKey = (ev: KeyboardEvent): void => {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        const rows_ = live[group]?.rows ?? [];

        /* xtra_act runs before anything else claims the key, exactly as upstream
         * dispatches it from the EVT_KBRD branch after 'r'. It is async, so the
         * listener is torn down for the duration and the loop re-enters. */
        const cur = rows_[member];
        if (hooks.xtraAct && cur && panel === 1 && ev.key.length === 1 && ev.key !== "r" && ev.key !== "R") {
          const act = hooks.xtraAct;
          const held = cur.member;
          inputEvents.removeEventListener("keydown", onKey, true);
          void act(ev.key, held).then((used) => {
            if (used) {
              /* Consumed: nothing was chosen, so re-arm and repaint over
               * whatever the prompt drew. */
              inputEvents.addEventListener("keydown", onKey, true);
              paint();
            } else {
              inputEvents.addEventListener("keydown", onKey, true);
              paint();
            }
          });
          return;
        }

        if (ev.key === "r" || ev.key === "R") {
          recallHere();
          return;
        }
        if (ev.key === "Escape" || ev.key === "ArrowLeft") {
          if (panel === 1) {
            panel = 0;
            paint();
          } else {
            finish(null);
          }
          return;
        }
        if (ev.key === "Enter" || ev.key === "ArrowRight") {
          if (panel === 0) {
            if (rows_.length > 0) panel = 1;
            paint();
          } else {
            recallHere();
          }
          return;
        }
        const nav = menuNav(ev);
        if (!nav) return;
        const { rows } = term.size();
        const page = Math.max(1, rows - 8);
        if (panel === 0) {
          const before = group;
          group = moveIn(nav, group, live.length, page);
          if (group !== before) member = 0; // g_cur != grp_old -> o_cur = 0 (L1153-1160)
        } else {
          member = moveIn(nav, member, rows_.length, page);
        }
        paint();
      };

      inputEvents.addEventListener("keydown", onKey, true);
      /* Tap: the pane you touch becomes the active one and the row you touch
       * becomes its cursor - upstream's EVT_MOUSE branch (region_inside on the
       * inactive menu swaps panels), plus MN_DBL_TAP's second tap to select. */
      setActiveCellTap(term, (cell) => {
        const { rows } = term.size();
        const browserRows = Math.max(1, rows - 8);
        const r = cell.row - BROWSER_TOP;
        if (r < 0 || r >= browserRows) return;
        if (cell.col <= nameLen) {
          const g = groupTop + r;
          if (g >= live.length) return;
          if (panel === 0 && g === group) {
            panel = 1;
          } else {
            panel = 0;
            if (g !== group) member = 0;
            group = g;
          }
          paint();
          return;
        }
        const i = memberTop + r;
        if (i >= (live[group]?.rows.length ?? 0)) return;
        if (panel === 1 && i === member) {
          recallHere();
          return;
        }
        panel = 1;
        member = i;
        paint();
      });
      paint();
    });
  }
}

/** display_scrolling's `top` chase, for one pane. */
function clampTop(top: number, cursor: number, count: number, page: number): number {
  let t = top;
  if (cursor < t) t = cursor;
  if (cursor >= t + page) t = cursor - page + 1;
  t = Math.min(t, Math.max(0, count - page));
  return Math.max(0, t);
}

/** One navigation step within a pane, wrapping at both ends as upstream does. */
function moveIn(nav: MenuNav, cursor: number, count: number, page: number): number {
  if (count === 0) return 0;
  switch (nav) {
    case "up":
      return (cursor - 1 + count) % count;
    case "down":
      return (cursor + 1) % count;
    case "pageup":
      return Math.max(0, cursor - page);
    case "pagedown":
      return Math.min(count - 1, cursor + page);
    case "home":
      return 0;
    case "end":
      return count - 1;
  }
}

// ---------------------------------------------------------------------------
// Rune knowledge (14.10) - do_cmd_knowledge_runes, ui-knowledge.c L2291
// ---------------------------------------------------------------------------

/** rune_group_text[] (ui-knowledge.c L2178-2188), indexed by RuneVariety. */
const RUNE_GROUP_TEXT = ["Combat", "Modifiers", "Resists", "Brands", "Slays", "Curses", "Other"];

/**
 * The variety -> group index used by rune_var (ui-knowledge.c L2211-2214).
 *
 * THE CALLER HOLE gap 16 turned up. `RuneVariety` used to be a closed union of
 * seven string literals, so this switch was exhaustive by construction and
 * needed no default. Opening the type (obj/rune-registry.ts) means a mod can
 * coin a variety, and without a fallback here its runes would be silently
 * DROPPED from the knowledge browser - learnable, describable, and invisible.
 *
 * A mod's variety lands in "Other", which is upstream's own catch-all group and
 * where `flag` already lives. Letting a mod NAME its own group is a UI question
 * rather than a rune question, and belongs to MOD_REACH gap 9 (UI moddable) -
 * this is deliberately the smallest thing that stops a rune vanishing, not a
 * second UI seam invented on the way past.
 */
const RUNE_GROUP_OTHER = 6;

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
      return RUNE_GROUP_OTHER;
    default:
      return RUNE_GROUP_OTHER;
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
  runeNote?: (index: number) => string | undefined,
): { title: string; groups: KnowledgeGroup<Rune>[]; unknown: number } {
  const groups: KnowledgeGroup<Rune>[] = RUNE_GROUP_TEXT.map((name) => ({ name, rows: [] }));
  let known = 0;
  for (let i = 0; i < allRunes.length; i++) {
    const rune = allRunes[i]!;
    if (!playerKnowsRune(player, rune)) continue;
    known++;
    const gid = runeGroupIndex(rune.variety);
    /* display_rune (ui-knowledge.c:2198) prints rune_name(oid), which carries
     * the variety decoration ("<x> brand", "slay <x>", "<x> curse",
     * "resist <x>") - not the bare rune->name. */
    const note = runeNote?.(i);
    groups[gid]!.rows.push({
      label: runeName(rune),
      color: FG,
      member: rune,
      /* display_rune (ui-knowledge.c:2200-2202): the autoinscription, yellow,
       * at column 47. `col` counts from screen column 0 exactly as upstream
       * does; the label already sits at the same offset via the menu prefix. */
      ...(note !== undefined
        ? { cells: [{ text: note, color: UI_YELLOW, col: 47 }] }
        : {}),
      /* rune_xtra_prompt (ui-knowledge.c:2238-2244): the '}' uninscribe key is
       * offered only for a rune that already carries a note. */
      hint: note !== undefined ? ", 'r'ecall, '{', '}'" : ", 'r'ecall, '{'",
    });
  }
  const unknown = allRunes.length - known;
  return { title: `runes (${unknown} unknown)`, groups, unknown };
}

/**
 * The rune-note seam the rune knowledge screen needs: rune_note /
 * rune_set_note (obj-knowledge.c:406/414) plus rune_autoinscribe
 * (obj-ignore.c:193), all keyed by the rune's buildRuneList index like
 * upstream's rune_list index. Optional at the call site: without it the screen
 * is read-only (no '{' / '}'), which is what a spectator/harness host wants.
 */
export interface RuneNoteHooks {
  get: (index: number) => string | undefined;
  set: (index: number, note: string | null) => void;
  autoinscribe: (index: number) => void;
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
  /* my_strcap(string_make(rune_name(oid))) (ui-knowledge.c:2219-2220). */
  const full = runeName(rune);
  const cap = full.charAt(0).toUpperCase() + full.slice(1);
  const desc = runeDesc(runeEnv, rune);
  const lines: ScreenLine[] = [{ text: cap, color: UI_CURSOR }];
  if (desc) {
    lines.push({ text: "", color: FG });
    lines.push({ text: desc, color: FG });
  }
  return lines;
}

export async function showRuneKnowledge(
  term: GridSurface & GridPointerInput,
  runeEnv: Parameters<typeof buildRuneList>[0],
  player: Player,
  notes?: RuneNoteHooks,
): Promise<void> {
  const allRunes = buildRuneList(runeEnv);
  const recall = async (rune: Rune): Promise<void> => {
    const full = runeName(rune);
    const cap = full.charAt(0).toUpperCase() + full.slice(1);
    await showTextScreen(term, cap, runeRecallLines(rune, runeEnv));
  };
  if (!notes) {
    const { title, groups } = runeKnowledgeGroups(allRunes, player);
    await runGroupedBrowser(term, title, groups, recall);
    return;
  }
  /*
   * The inscribable form. This used to be a second copy of the browser driven
   * straight off selectFromMenu, with a comment saying runGroupedBrowser had no
   * seam for upstream's xtra_prompt / xtra_act pair (rune_xtra_prompt
   * ui-knowledge.c:2238, rune_xtra_act :2247). It has one now - it is the same
   * pair, under the same names - so the copy is gone rather than being ported to
   * two panels twice.
   *
   * The '{' branch is rune_xtra_act's askfor_aux sequence verbatim: prompt seeded
   * with the current note, on accept clear the old note, set the new one, then
   * rune_autoinscribe (:2275).
   */
  for (;;) {
    /* Rebuilt each pass because a note CHANGES a row (the yellow suffix and the
     * per-row prompt both read it), and the browser holds its groups by value. */
    const { title, groups } = runeKnowledgeGroups(allRunes, player, notes.get);
    let again = false;
    await runGroupedBrowser(term, title, groups, recall, {
      xtraAct: async (key, rune) => {
        if (key !== "{" && key !== "}") return false;
        const i = allRunes.indexOf(rune);
        if (i < 0) return true;
        if (key === "}") {
          /* rune_set_note(oid, NULL) (ui-knowledge.c:2252). */
          notes.set(i, null);
          again = true;
          return true;
        }
        /* askfor_aux(note_text, sizeof(note_text)) with char[80] -> 79 chars. */
        const text = await promptText(term, "Inscribe with: ", notes.get(i) ?? "", 79);
        if (text !== null) {
          notes.set(i, null);
          notes.set(i, text);
          notes.autoinscribe(i);
          again = true;
        }
        return true;
      },
    });
    /* A note was written, so the rows are stale - rebuild and re-enter. ESC with
     * nothing changed is the player leaving, and leaves. */
    if (!again) return;
  }
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

export async function showFeatureKnowledge(term: GridSurface & GridPointerInput, reg: FeatureRegistry): Promise<void> {
  await runGroupedBrowser(term, "features", featureKnowledgeGroups(reg), async (feat) => {
    const cap = feat.name.charAt(0).toUpperCase() + feat.name.slice(1);
    const lines: ScreenLine[] = [{ text: cap, color: UI_CURSOR }];
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

export async function showTrapKnowledge(term: GridSurface & GridPointerInput, traps: readonly TrapKind[]): Promise<void> {
  await runGroupedBrowser(term, "traps", trapKnowledgeGroups(traps), async (trap) => {
    const cap = trap.desc.charAt(0).toUpperCase() + trap.desc.slice(1);
    // trap_lore (ui-knowledge.c L2588-2605): capitalized desc then trap->text.
    // Upstream only opens the recall when trap->text is non-empty (L2590); a
    // trap with no paragraph shows just the title, matching that guard.
    const lines: ScreenLine[] = [{ text: cap, color: UI_CURSOR }];
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

const RECALL_TITLE = UI_CURSOR;

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

  /* THE GAME STREAM, as upstream. desc_art_fake calls make_fake_artifact
   * (ui-knowledge.c:1629) with no stream of its own, so copy_curses' timeout
   * roll (obj-curse.c:67) comes off the global RNG and browsing an artifact
   * DOES advance Angband's stream. This used to pass a throwaway Rng at a fixed
   * seed so browsing could not perturb a run - which was an improvement, and
   * improvements do not belong in the port. See the note in
   * obj/artifact-fake.ts. */
  const obj = makeFakeArtifact(reg, constants, art, state.rng);
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
  term: GridSurface & GridPointerInput,
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

/**
 * What the object BROWSER needs on top of the list predicates: the live-game
 * handles desc_obj_fake runs object_info with. REQUIRED, not optional - it is
 * what produces the recall body, and an absent supplier would leave the recall
 * silently back where it was, a name and no lines. Split from
 * ObjectBrowserDeps so the pure grouping builder still takes only predicates.
 */
export interface ObjectRecallDeps extends ObjectBrowserDeps {
  recall: FakeRecallDeps;
}

/**
 * The live-game handles the two fake-object recalls need to run object_info on
 * a throwaway object: the state and player the knowledge shadow is derived
 * from, the registry and constants the builders read, and the object-info
 * extras (projections / race origins / timed + summon names).
 */
export interface FakeRecallDeps {
  state: GameState;
  reg: ObjRegistry;
  constants: Constants;
  player: Player;
  inspectExtras: ObjectInfoExtras;
  runeEnv: RuneEnv;
}

/**
 * A textblock's flat text as screen lines: trailing whitespace stripped (the
 * run stream ends sections with two spaces) and the leading blanks object_info
 * emits before its first real line dropped, since the overlay already puts the
 * body under a title.
 *
 * LOOKED AT AND LEFT, step 5b-ii, and recorded rather than fixed. This is a THIRD
 * rendering of the same `Textblock` the object-inspect page renders: it flattens
 * through `textblockToString` and so drops every run colour, which is why the
 * knowledge browser's object recall is monochrome where the 'I' inspect of the
 * same object is not. Converting it to a `text` block would give it colours AND a
 * wrap it does not have today - two visible changes to what the player sees - so
 * it wants its own adjudication against upstream rather than a drive-by. Same
 * verdict for the rune, feature, trap and shape recalls just above and below:
 * they push their description as ONE line, so a long one is TRUNCATED at
 * `cols - 1` by `showTextScreen` instead of wrapping. See MOD_REACH.md row 21.
 */
function recallBodyLines(text: string): ScreenLine[] {
  const lines: ScreenLine[] = text
    .split("\n")
    .map((raw) => ({ text: raw.replace(/\s+$/u, ""), color: FG }));
  while (lines.length > 1 && lines[0]!.text === "") lines.shift();
  return lines;
}

/**
 * desc_obj_fake (ui-knowledge.c L1938-1981): the known-objects recall. Upstream
 * preps a throwaway object of the kind on the EXTREMIFY aspect, points its
 * known twin at either a full object_copy (when the kind is aware, or has no
 * flavour to be unaware of) or a blank OBJECT_NULL, and dumps
 * object_info(obj, OINFO_FAKE) under object_desc(ODESC_PREFIX|ODESC_CAPITAL).
 *
 * The port synthesises the known shadow from the player's rune knowledge, so
 * the two twin states are reproduced with a scratch player, exactly as
 * artifactFakeRecall does:
 * - aware: every rune learned + the object marked ASSESSED, so the shadow
 *   reveals the full mechanics as the object_copy twin would;
 * - unaware flavoured kind: upstream's blank twin has `known->kind == NULL`, so
 *   object_info_out returns at its very first branch (obj-info.c L2328) with
 *   "You do not know what this is." The port's shadow ALWAYS mirrors obj.kind
 *   (objectKnownShadow, known-object.ts), so that branch is unreachable through
 *   the engine and is written out here instead.
 *
 * The header still reads the live flavour knowledge (state.flavorKnown), so an
 * unaware kind the player has tried keeps its "{tried}" exactly as the browser
 * row shows it.
 */
export function objectFakeRecall(
  deps: ObjectRecallDeps,
  kind: ObjectKind,
): { title: string; lines: ScreenLine[] } {
  const { state, reg, constants, player, runeEnv, inspectExtras } = deps.recall;
  /* `kind->aware || !kind->flavor` (L1958). */
  const aware = !deps.hasFlavor(kind) || deps.isAware(kind);

  const obj = makeFakeKind(reg, constants, kind);

  const scratchKnown = blankObjKnowledge();
  const scratchPlayer: Player = { ...player, objKnown: scratchKnown };
  if (aware) {
    playerLearnAllRunes(scratchPlayer, runeEnv);
    obj.notice |= OBJ_NOTICE.ASSESSED;
  }
  const scratchState: GameState = {
    ...state,
    actor: { ...state.actor, player: scratchPlayer },
    /* Only this kind is ever described here, so a constant is exact. */
    isAware: () => aware,
  };

  const title = objectDesc(
    obj,
    ODESC.PREFIX | ODESC.CAPITAL,
    scratchPlayer,
    runeEnv,
    knownDescOf(scratchState),
  );

  if (!aware) {
    return {
      title,
      lines: [{ text: "You do not know what this is.", color: FG }],
    };
  }

  /* object_info ORs in OINFO_SUBJ (obj-info.c L2394). */
  const tb = objectInfo(
    obj,
    OINFO.FAKE | OINFO.SUBJ,
    makeObjectInfoDeps(scratchState, obj, inspectExtras),
  );
  return { title, lines: recallBodyLines(textblockToString(tb)) };
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
    default: {
      if (deps.isAware(a)) return strcmp(a.name, b.name);
      /* Then in tried order, then by flavour text (approximated by kindName's
       * unaware output - the leak-safe flavour string). */
      const t = (deps.wasTried(a) ? 1 : 0) - (deps.wasTried(b) ? 1 : 0);
      if (t) return -t;
      return strcmp(deps.kindName(a, false), deps.kindName(b, false));
    }
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
  term: GridSurface & GridPointerInput,
  kinds: readonly ObjectKind[],
  bases: readonly (ObjectBase | undefined)[],
  deps: ObjectRecallDeps,
): Promise<void> {
  const groups = objectKnowledgeGroups(kinds, bases, deps);
  const recall = async (kind: ObjectKind): Promise<void> => {
    const { title, lines } = objectFakeRecall(deps, kind);
    await showTextScreen(term, title, lines);
  };

  /* `{` is object_xtra_act (ui-knowledge.c:2101-2123: "Inscribe with: " sets the
   * highlighted kind's autoinscription) - a key the MEMBER pane handles itself,
   * which is exactly the xtra_act hook. Absent when the host does not offer
   * autoinscription, and then the browser runs with no extra keys at all. */
  const inscribe = deps.setAutoinscription;
  if (!inscribe) {
    await runGroupedBrowser(term, "known objects", groups, recall);
    return;
  }
  /* o_xtra_prompt (ui-knowledge.c:2057-2071) offers 's' to toggle ignore and '}'
   * to uninscribe as well; neither is wired in this port yet, so the prompt names
   * what this build can actually do rather than what the C's string says. */
  const withPrompt = groups.map((g) => ({
    ...g,
    rows: g.rows.map((r) => ({ ...r, hint: ", 'r'ecall, '{' to inscribe" })),
  }));
  await runGroupedBrowser(term, "known objects", withPrompt, recall, {
    xtraAct: async (key, kind) => {
      if (key !== "{") return false;
      await inscribe(kind); // owns the "Inscribe with: " prompt + registry write
      return true;
    },
  });
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

/**
 * desc_ego_fake (ui-knowledge.c L1789-1804): the ego-knowledge recall - the
 * object_info_ego textblock under a "<group name> <ego name>" header.
 *
 * The ego's own flavour text is NOT prepended here: object_info_out reaches
 * describe_flavor_text with the ego bit set, which prints `obj->ego->text`
 * itself (obj-info.c L2244), so adding it would print it twice.
 *
 * object_info_ego builds a FULLY KNOWN object (`object_copy(&known_obj, &obj)`,
 * L2437), which the port reproduces the same way artifactFakeRecall does: a
 * scratch player with every rune learned, and the object marked ASSESSED.
 */
export function egoFakeRecall(
  deps: FakeRecallDeps,
  ego: EgoItem,
  groupName: string,
): { title: string; lines: ScreenLine[] } {
  const { state, reg, player, runeEnv, inspectExtras } = deps;
  const title = `${groupName} ${ego.name}`;

  const scratchPlayer: Player = { ...player, objKnown: blankObjKnowledge() };
  playerLearnAllRunes(scratchPlayer, runeEnv);

  const tb = objectInfoEgo(reg, ego, (obj) => {
    obj.notice |= OBJ_NOTICE.ASSESSED;
    const scratchState: GameState = {
      ...state,
      actor: { ...state.actor, player: scratchPlayer },
      isAware: () => true,
    };
    return makeObjectInfoDeps(scratchState, obj, inspectExtras);
  });

  return { title, lines: recallBodyLines(textblockToString(tb)) };
}

export async function showEgoKnowledge(
  term: GridSurface & GridPointerInput,
  egos: readonly EgoItem[],
  kinds: readonly ObjectKind[],
  bases: readonly (ObjectBase | undefined)[],
  everseen: EverseenKnowledge,
  recallDeps: FakeRecallDeps,
): Promise<void> {
  const groups = egoKnowledgeGroups(egos, kinds, bases, everseen);
  /* The header is `format("%s %s", ego_grp_name(default_group_id(oid)),
   * ego->name)` (L1801) - the group the highlighted row sits under, which is
   * why one ego browsed from two groups gets two different headers. */
  await runGroupedBrowser(term, "ego items", groups, async (ego, groupName) => {
    const { title, lines } = egoFakeRecall(recallDeps, ego, groupName);
    await showTextScreen(term, title, lines);
  });
}

// ---------------------------------------------------------------------------
// Monster knowledge - do_cmd_knowledge_monsters, ui-knowledge.c L1382
// ---------------------------------------------------------------------------

/** display_knowledge's `otherfields` for monsters (ui-knowledge.c:1451). */
export const MONSTER_OTHERFIELDS = "                 Sym  Kills  Full";

/** The absolute columns display_monster writes (ui-knowledge.c:1200-1213). */
const MON_SYM_COL = 64;
const MON_KILLS_COL = 68;
const MON_FULL_COL = 75;

/** display_monster's kills field (ui-knowledge.c:1202-1210). */
export function monsterKillsCell(race: MonsterRace, pkills: number): string {
  if (!race.rarity) return "shape";
  if (race.flags.has(RF.UNIQUE)) return race.maxNum === 0 ? " dead" : "alive";
  /* "%5d" - right-justified in five columns, which is what keeps this field
   * clear of "Full" at 75 when a player has killed ten thousand of something. */
  return String(pkills).padStart(5);
}

/**
 * mon_summary (ui-knowledge.c:1303-1328). Two forms: the uniques group (gid 0,
 * when its first member is a unique) counts known uniques and how many are
 * slain; every other group reports its own kills against the total.
 *
 * `total` is upstream's `tkills`, summed over the whole of `l_list` - so the
 * caller must sum EVERY race's kills once. A race with kills has necessarily
 * been sighted, so summing the known set is the same number, but a race that
 * joins two categories must not be counted twice.
 */
export function monsterSummaryLine(
  groupIndex: number,
  members: readonly { race: MonsterRace; lore: MonsterLore }[],
  total: number,
): string {
  const kills = members.reduce((s, m) => s + m.lore.pkills, 0);
  const first = members[0];
  if (groupIndex === 0 && first && first.race.flags.has(RF.UNIQUE)) {
    return `${members.length} known uniques, ${kills} slain.`;
  }
  return `Creatures slain: ${kills}/${total} (in group/in total)`;
}

/**
 * do_cmd_knowledge_monsters' browser (ui-knowledge.c L1382-1454). The thematic
 * ui_knowledge.txt categories on the left, their members on the right with
 * display_monster's Sym / Kills / Full columns and mon_summary underneath.
 *
 * It goes through runGroupedBrowser like every other knowledge screen. It used
 * to have a renderer of its own, in main.ts, which is why it was the one
 * knowledge screen with no "Group" label, no `=` rule and no `|` divider, and
 * why its group column could be narrower than the eight columns
 * display_knowledge floors g_name_len at. The two extra things it needs -
 * `otherfields` and `summary` - are seams display_knowledge already has and the
 * port had simply never carried, since monsters are the only caller that passes
 * either.
 *
 * `purpleUniques` is display_monster's OPT(player, purple_uniques) branch
 * (`:1188-1194`), which recolours a unique's SYMBOL violet - not its name; the
 * name takes the cursor colour like every other row.
 */
export async function showMonsterKnowledge(
  term: GridSurface & GridPointerInput,
  views: readonly { name: string; rows: readonly { race: MonsterRace; lore: MonsterLore }[] }[],
  purpleUniques: boolean,
  recall: (row: { race: MonsterRace; lore: MonsterLore }) => Promise<void>,
): Promise<void> {
  const seen = new Set<number>();
  let total = 0;
  for (const v of views) {
    for (const row of v.rows) {
      if (seen.has(row.race.ridx)) continue;
      seen.add(row.race.ridx);
      total += row.lore.pkills;
    }
  }

  const groups: KnowledgeGroup<{ race: MonsterRace; lore: MonsterLore }>[] = views.map((v) => ({
    name: v.name,
    rows: v.rows.map((row) => {
      const violet = purpleUniques && row.race.flags.has(RF.UNIQUE);
      return {
        /* c_prt(attr, race->name, ...) (:1197): the RAW name, uncapitalised,
         * in the cursor colour rather than the monster's. */
        label: row.race.name,
        color: UI_TEXT,
        member: row,
        cells: [
          {
            text: row.race.dChar,
            color: colorToCss(violet ? COLOUR_VIOLET : row.race.dAttr),
            col: MON_SYM_COL,
          },
          { text: monsterKillsCell(row.race, row.lore.pkills), color: UI_TEXT, col: MON_KILLS_COL },
          { text: row.lore.allKnown ? "yes" : "no", color: UI_TEXT, col: MON_FULL_COL },
        ],
      };
    }),
  }));

  await runGroupedBrowser(term, "monsters", groups, (row) => recall(row), {
    otherfields: MONSTER_OTHERFIELDS,
    summary: (gi) => {
      const members = groups[gi]?.rows.map((r) => r.member) ?? [];
      if (members.length === 0) return null;
      return { text: monsterSummaryLine(gi, members, total), color: UI_CURSOR };
    },
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
  term: GridSurface & GridPointerInput,
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
      color: i === 0 ? UI_CURSOR : FG,
    }));
    await showTextScreen(term, shape.name, lines);
  });
}
