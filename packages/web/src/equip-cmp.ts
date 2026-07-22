/**
 * The equipment-comparison screen (ui-equip-cmp.c equip_cmp_display): a
 * resistance/ability/hindrance/modifier grid across worn, carried, floor,
 * home and store wearables, plus the "@" combined player+equipment row.
 *
 * The core (game/equip-cmp.ts) already computes the model - columns, the
 * combined row, and the filtered/sorted item rows, reusing the ui-entry
 * compute/render backend the character screen uses. This owns only the
 * Term drawing and the keyboard loop (its own window keydown, like
 * charsheet.ts), following the faithful key set: j/k or arrows move, n/p
 * (or space/PgUp/PgDn) page, c cycles the source filter, v cycles the
 * attribute view, r reverses, R resets, x/I picks one or two items to
 * compare (their object_info textblocks side by side, via the ported
 * obj/object-info.ts - not re-derived here), ? shows help, ESC exits.
 *
 * Simplified vs. upstream (see game/equip-cmp.ts's header for the model-side
 * notes): the intricate per-terminal-width page/view reconfiguration
 * collapses to plain vertical scroll plus a fixed 2/3-view split, and the
 * free-text quick filter (q/!) and file dump (d) are not implemented - both
 * are UI conveniences over the same model, not present in this scoped port.
 */

import {
  COLOUR_WHITE,
  colorToCss,
  equipCmpSummary,
  objectInfoTextblock,
} from "@neo-angband/core";
import type {
  EquipCmpModel,
  EquipCmpOptions,
  GameState,
  ObjectInfoExtras,
  StoreInclusion,
  Textblock,
  UiEntryPackRecords,
} from "@neo-angband/core";
import type { GlyphTerm } from "./term";
import { showTextScreen, selectFromMenu, menuNav } from "./overlay";
import type { ScreenLine } from "./overlay";
import { wrapRuns } from "./screens";
import { UI_TEXT, UI_DIM, UI_GOLD, UI_CURSOR } from "./ui-colors";

const FG = UI_TEXT;
const DIM = UI_DIM;
const TITLE = UI_TEXT;
const HEADER_ROW = 0;
const LABEL_ROW0 = 1;
const LABEL_ROW1 = 2;
const COMBINED_ROW = 3;
const ITEMS_TOP = 4;
const NAME_COL = 4;
const NAME_WIDTH = 20;

const SOURCE_MSG: Record<StoreInclusion, string> = {
  "no-store": "",
  "only-store": "Only showing goods from stores; press c to change",
  "yes-store": "Showing possessions and goods from stores; press c to change",
  "only-carried": "Only showing carried items; press c to change",
};

const SRC_CHAR: Record<string, string> = {
  worn: "e",
  pack: "p",
  floor: "f",
  home: "h",
  store: "s",
};

/** Deps the equip-cmp screen needs beyond GameState (registry pack data). */
export interface EquipCmpDeps {
  packs: UiEntryPackRecords;
  entryDeps?: EquipCmpOptions["entryDeps"];
  inspectExtras: ObjectInfoExtras;
}

/**
 * equip_cmp_display: show the comparison grid as a modal, owning the
 * keyboard until ESC. Re-derives the model on every state-changing key
 * (source cycle / reverse / reset) so the grid always reflects live gear.
 */
export function showEquipCmp(term: GlyphTerm, state: GameState, deps: EquipCmpDeps): Promise<void> {
  return new Promise<void>((resolve) => {
    let source: StoreInclusion = "no-store";
    let reverse = false;
    let view = 0; // 0 = all categories, 1 = stat_modifiers only (the 2-view split)
    let cursor = 0;
    let top = 0;
    let colScroll = 0;
    let dlgMsg = "";
    const summaryOpts = (): EquipCmpOptions => ({
      source,
      reverse,
      ...(deps.entryDeps !== undefined ? { entryDeps: deps.entryDeps } : {}),
    });
    let model: EquipCmpModel = equipCmpSummary(state, deps.packs, summaryOpts());

    const rebuild = (): void => {
      model = equipCmpSummary(state, deps.packs, summaryOpts());
      if (cursor >= model.items.length) cursor = Math.max(0, model.items.length - 1);
    };

    /** Column groups for the "v" view cycle - a fixed 2-way split (see the
     * core module's header note on the simplified view/paging model). */
    const viewColumns = (): number[] => {
      const all = model.columns.map((_, i) => i);
      if (view === 0) return all.filter((i) => model.columns[i]?.category !== "stat_modifiers");
      return all.filter((i) => model.columns[i]?.category === "stat_modifiers");
    };

    const paint = (): void => {
      const { cols, rows } = term.size();
      term.clear();
      term.print(0, HEADER_ROW, dlgMsg || "Equipment comparison".slice(0, cols - 1), dlgMsg ? UI_GOLD : TITLE);
      dlgMsg = "";

      const colIdx = viewColumns();
      const availCols = Math.max(1, cols - NAME_COL - NAME_WIDTH - 1);
      if (colScroll > Math.max(0, colIdx.length - availCols)) colScroll = Math.max(0, colIdx.length - availCols);
      const visible = colIdx.slice(colScroll, colScroll + availCols);

      // Two rows of 2-char vertical column labels, alternating white/l-white.
      visible.forEach((ci, vi) => {
        const col = model.columns[ci];
        if (!col) return;
        const x = NAME_COL + NAME_WIDTH + vi;
        const shade = vi % 2 === 0 ? FG : DIM;
        term.print(x, LABEL_ROW0, (col.label[0] ?? " "), shade);
        term.print(x, LABEL_ROW1, (col.label[1] ?? " "), shade);
      });

      // The "@" combined row.
      term.print(0, COMBINED_ROW, "@".padEnd(NAME_COL + NAME_WIDTH), UI_GOLD);
      visible.forEach((ci, vi) => {
        const cell = model.combinedCells[ci];
        if (!cell) return;
        term.put(NAME_COL + NAME_WIDTH + vi, COMBINED_ROW, { ch: cell.symbol, fg: colorToCss(cell.color) });
      });

      const bodyRows = Math.max(1, rows - ITEMS_TOP - 1);
      if (cursor < top) top = cursor;
      if (cursor >= top + bodyRows) top = cursor - bodyRows + 1;
      for (let r = 0; r < bodyRows; r++) {
        const i = top + r;
        const item = model.items[i];
        if (!item) break;
        const y = ITEMS_TOP + r;
        const selected = i === cursor;
        term.put(0, y, { ch: item.equippyCh, fg: colorToCss(item.equippyAttr) });
        term.print(2, y, SRC_CHAR[item.src] ?? "?", DIM);
        term.print(NAME_COL, y, item.shortName.padEnd(NAME_WIDTH).slice(0, NAME_WIDTH), selected ? UI_CURSOR : FG);
        visible.forEach((ci, vi) => {
          const cell = item.cells[ci];
          if (!cell) return;
          term.put(NAME_COL + NAME_WIDTH + vi, y, { ch: cell.symbol, fg: colorToCss(cell.color) });
        });
      }

      const srcMsg = SOURCE_MSG[source];
      const footer = srcMsg || "[j/k move; n/p page; c source; v view; r reverse; x compare; ? help; ESC]";
      term.print(0, rows - 1, footer.slice(0, cols - 1), DIM);
    };

    const showHelp = async (): Promise<void> => {
      await showTextScreen(term, "Equipment comparison - help", [
        { text: "j, down / k, up   move one line" },
        { text: "n, PgDn / p, PgUp page" },
        { text: "c   cycle equipment source (none / only store / all / carried only)" },
        { text: "v   cycle attribute view" },
        { text: "r   reverse order" },
        { text: "R   reset to defaults" },
        { text: "x, I select one or two items to compare" },
        { text: "Left/Right  scroll property columns" },
        { text: "ESC exit" },
      ].map((l) => ({ text: l.text, color: FG }) as ScreenLine));
    };

    const compare = async (i0: number, i1: number | null): Promise<void> => {
      const a = model.items[i0];
      if (!a) return;
      const tb0 = objectInfoTextblock(state, a.obj, deps.inspectExtras);
      if (i1 !== null && i1 !== i0 && model.items[i1]) {
        const b = model.items[i1]!;
        const tb1 = objectInfoTextblock(state, b.obj, deps.inspectExtras);
        // display_object_comparison (ui-equip-cmp.c L1440): the two items'
        // headers and object_info textblocks, back to back.
        const combined: Textblock = {
          runs: [
            { text: `${a.shortName}\n`, attr: COLOUR_WHITE },
            ...tb0.runs,
            { text: `\n${b.shortName}\n`, attr: COLOUR_WHITE },
            ...tb1.runs,
          ],
        };
        await showTextScreen(term, "Object comparison", wrapRuns(combined, term.size().cols));
      } else {
        await showTextScreen(term, a.shortName, wrapRuns(tb0, term.size().cols));
      }
    };

    const runSelect = async (): Promise<void> => {
      if (model.items.length === 0) return;
      const items = model.items.map((it, i) => ({ label: `${it.shortName}`, color: i === cursor ? UI_CURSOR : FG }));
      const first = await selectFromMenu(term, "Select first item to compare (ESC to skip)", items);
      if (first === null) return;
      const second = await selectFromMenu(
        term,
        "Select second item to compare (ESC to show just the first)",
        items,
      );
      await compare(first, second);
    };

    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const { rows } = term.size();
      const page = Math.max(1, rows - ITEMS_TOP - 2);
      const last = Math.max(0, model.items.length - 1);
      // Arrows AND numpad digits move the cursor (menuNav), so the numpad is
      // not dead here when NumLock is on; horizontal arrows still column-scroll.
      const nav = menuNav(ev);
      if (nav === "up") { cursor = Math.max(0, cursor - 1); paint(); return; }
      if (nav === "down") { cursor = Math.min(last, cursor + 1); paint(); return; }
      if (nav === "pageup") { cursor = Math.max(0, cursor - page); paint(); return; }
      if (nav === "pagedown") { cursor = Math.min(last, cursor + page); paint(); return; }
      if (nav === "home") { cursor = 0; paint(); return; }
      if (nav === "end") { cursor = last; paint(); return; }
      switch (ev.key) {
        case "Escape":
          window.removeEventListener("keydown", onKey, true);
          resolve();
          return;
        case "j":
        case "ArrowDown":
          cursor = Math.min(Math.max(0, model.items.length - 1), cursor + 1);
          break;
        case "k":
        case "ArrowUp":
          cursor = Math.max(0, cursor - 1);
          break;
        case "n":
        case " ":
        case "PageDown":
          cursor = Math.min(Math.max(0, model.items.length - 1), cursor + page);
          break;
        case "p":
        case "PageUp":
          cursor = Math.max(0, cursor - page);
          break;
        case "ArrowLeft":
          colScroll = Math.max(0, colScroll - 1);
          break;
        case "ArrowRight":
          colScroll += 1;
          break;
        case "c":
          source =
            source === "no-store"
              ? "only-store"
              : source === "only-store"
                ? "yes-store"
                : source === "yes-store"
                  ? "only-carried"
                  : "no-store";
          rebuild();
          break;
        case "v":
          view = view === 0 ? 1 : 0;
          dlgMsg = "Showing alternate attributes; press v to cycle";
          break;
        case "r":
          reverse = !reverse;
          rebuild();
          break;
        case "R":
          source = "no-store";
          reverse = false;
          view = 0;
          colScroll = 0;
          rebuild();
          break;
        case "x":
        case "I":
          void (async () => {
            await runSelect();
            paint();
          })();
          return;
        case "?":
          void (async () => {
            await showHelp();
            paint();
          })();
          return;
        default:
          return;
      }
      paint();
    };
    window.addEventListener("keydown", onKey, true);
    paint();
  });
}
