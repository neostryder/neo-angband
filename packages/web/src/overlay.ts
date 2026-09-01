/**
 * Modal overlay primitives for the glyph terminal: the reusable screen/menu
 * machinery every full-screen UI (inventory, equipment, character sheet,
 * message history, item/spell selection, birth) is built from.
 *
 * The pattern mirrors the score screen (score.ts): each modal owns the keyboard
 * while open (its own window keydown listener), repaints the whole terminal, and
 * resolves a Promise when dismissed. The caller (main.ts) gates the in-game key
 * handler behind a "modal open" flag so only one owner reads the keyboard at a
 * time, exactly as the upstream single-threaded UI does.
 *
 * These are platform UI, not core: the core stays UI-agnostic (decision 21) and
 * hands the UI data models (char-sheet panels, gear lists, spell menus); this turns
 * them into faithful full-screen views a keyboard or touch can drive.
 */

import { inputEvents } from "./input-door";
import { userExists, userPath } from "./user-io";
import { argForceName } from "./launch";
import { localTimestampSuffix } from "./timestamp";
import {
  setActiveCellTap,
  type GridCell,
  type GridPointerInput,
  type GridSurface,
  type RenderAssetRef,
} from "./term";
import { isGraphicsOverview } from "./mapview";
import type { LevelOverview, OverviewGlyph } from "./mapview";
import type { GridGeometry } from "./regions";
import { DIRS_ROGUELIKE } from "./keymap";
import type { MenuSemantics, MenuTransformRow } from "@rpgm-tools/neo-angband-core";
import { menuRegistry } from "./menu-registry";
import { buildMenuQuestion, type MenuAnswer, type MenuQuestion } from "./menu-view";
import {
  askInstalledPresenter,
  currentMenuPresenter,
  refuseMenuAnswer,
} from "./menu-runtime";
import { linesScreen, screenBodyLines, SCREEN_FOOTER, type ScreenView } from "./screen-view";
import { ScreenAbandoned, showThroughPresenter } from "./screen-runtime";
import { popRegion, pushRegion, regionSurface, type RegionSpec } from "./ui-stack";

/** A single styled line of overlay text. `color` is a CSS color string. */
export interface ScreenLine {
  text: string;
  color?: string;
  /**
   * Optional per-run colouring: when present, the row is painted run by run
   * (advancing the column) instead of as one `color` block. Used by the item
   * inspection viewer, whose lines carry multiple colours (obj-info's
   * L_GREEN / L_RED segments). `text` should still hold the concatenated
   * characters so width / scroll bookkeeping stays correct.
   *
   * A run's own `href` makes just that span a link (see `ScreenLine.href`);
   * absent on every run this project drew before links existed.
   */
  runs?: readonly { text: string; color: string; href?: string }[];
  /**
   * Makes the WHOLE line a tap/key target that opens `href` (an `http(s):`
   * address, or a `mailto:` one) rather than only scrolling or dismissing the
   * screen it sits on. Ignored when `runs` is present - a line split into runs
   * says which of its OWN spans are links, and a whole-line href would only
   * disagree with that. See `help.ts`'s community page and `report.ts`'s
   * "where to report it" rows for the two shapes in use.
   */
  href?: string;
}

import { UI_TEXT, UI_DIM, UI_GOLD, UI_BG, UI_CURSOR } from "./ui-colors";
import { openExternalUrl, openMailtoLink } from "./external-link";

const FG = UI_TEXT;
/** curs_attrs[CURS_KNOWN][1] (ui-menu.c:32): the selected menu row's colour. */
const CURSOR = UI_CURSOR;
const DIM = UI_DIM;
const TITLE = UI_TEXT;
const HEADER_ROW = 0;
const BODY_TOP = 2;

/** a-z index letters, then A-Z, matching upstream's all_letters selection. */
const LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Letter shown for menu row `i` (a..z, A..Z), or "" past the alphabet. */
export function menuLetter(i: number): string {
  return LETTERS[i] ?? "";
}

/** Coarse vertical navigation intent for a scrollable list or lettered menu. */
export type MenuNav = "up" | "down" | "pageup" | "pagedown" | "home" | "end";

/**
 * Menu/list navigation intent from a key event, or null when the key is not
 * navigation. The reference drives every menu cursor through target_dir_allow
 * (ui-target.c:99-108) -> process_dir, where numpad digits and arrow keys are
 * interchangeable directions; for a vertical list only the y component matters,
 * so keypad 7/8/9 move up and 1/2/3 move down (ddy[7..9]=-1, ddy[1..3]=+1),
 * while 4/6 (pure horizontal) do nothing. That is mirrored here so the numpad
 * works in menus regardless of NumLock: event.key is the digit when NumLock is
 * ON and an Arrow* name when OFF, and event.code is Numpad* in both states (the
 * belt-and-suspenders half). This is the single helper every overlay handler shares
 * so the "numpad is dead in menus" asymmetry cannot creep back in per-screen.
 *
 * `roguelike` mirrors the live rogue_like_commands option (see keymap.ts):
 * when true, h/j/k/l resolve through the SAME DIRS_ROGUELIKE table
 * resolveKey uses for movement, so a menu's up/down cursor matches whichever
 * keyset the player has chosen, exactly as process_dir does for every C menu.
 * Only j (down, dir 2) and k (up, dir 8) produce a MenuNav value here - h and l
 * (dirs 4/6, pure horizontal) stay inert, mirroring numpad 4/6 above: this
 * helper is deliberately vertical-only, and a screen with real left/right
 * semantics (e.g. birth's ArrowLeft "back", or the option list's ArrowLeft/
 * ArrowRight) already reads those keys itself rather than through menuNav.
 */
export function menuNav(ev: KeyboardEvent, roguelike = false): MenuNav | null {
  switch (ev.key) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "PageUp":
      return "pageup";
    case "PageDown":
      return "pagedown";
    case "Home":
      return "home";
    case "End":
      return "end";
    default:
      break;
  }
  const digit = /^[1-9]$/u.test(ev.key)
    ? ev.key
    : /^Numpad[1-9]$/u.test(ev.code)
      ? ev.code.slice(6)
      : "";
  switch (digit) {
    case "7":
    case "8":
    case "9":
      return "up";
    case "1":
    case "2":
    case "3":
      return "down";
    default:
      break;
  }
  if (roguelike) {
    switch (DIRS_ROGUELIKE[ev.key]) {
      case 8:
        return "up";
      case 2:
        return "down";
      default:
        return null;
    }
  }
  return null;
}

/**
 * A scrollable full-screen viewer (inventory, equipment, character sheet, message
 * history, help), offered to the installed screen presenter first.
 *
 * TWO WAYS TO CALL IT, and they mean different things. Handed a `ScreenView` this
 * shows a screen that has given up its model: the presenter gets columns with
 * stable keys, rows with semantics, and can draw the inventory as sprites. Handed
 * a title and pre-wrapped `ScreenLine[]` it shows a page of prose - the presenter
 * is still offered it, under the shared `core:text` id, and can reskin the frame
 * but has nothing to reimagine. Which screens are which is not a matter of taste:
 * `MODELLED_SCREENS` names them and a test pins the list.
 *
 * Either way the TERMINAL's own painting goes through `screenBodyLines`, so the
 * model and the faithful rendering cannot part - the lesson from the HUD, where a
 * model beside a second hand-laid drawing of the same thing was two
 * transcriptions and the one nobody looked at was the one that rotted.
 *
 * Scrolls with the arrows / PageUp-PageDown when the content is taller than the
 * screen. Any of ESC / Enter / Space closes it; resolves when dismissed.
 */
export function showTextScreen(
  term: GridSurface & GridPointerInput,
  view: ScreenView,
  roguelike?: boolean,
): Promise<void>;
export function showTextScreen(
  term: GridSurface & GridPointerInput,
  title: string,
  lines: readonly ScreenLine[],
  footer?: string,
  roguelike?: boolean,
): Promise<void>;
export async function showTextScreen(
  term: GridSurface & GridPointerInput,
  titleOrView: string | ScreenView,
  linesOrRoguelike?: readonly ScreenLine[] | boolean,
  footer = SCREEN_FOOTER,
  roguelikeArg = false,
): Promise<void> {
  const view =
    typeof titleOrView === "string"
      ? linesScreen(titleOrView, (linesOrRoguelike as readonly ScreenLine[] | undefined) ?? [], footer)
      : titleOrView;
  const roguelike = typeof titleOrView === "string" ? roguelikeArg : ((linesOrRoguelike as boolean | undefined) ?? false);
  const taken = showThroughPresenter(view, screenFault);
  if (taken) {
    try {
      await taken;
      return;
    } catch (error) {
      /* The presenter died with the screen open. It has already been reported and
       * the seam is already out; all that is left is to show the player the screen
       * they asked for, which the fall-through below does. */
      if (!(error instanceof ScreenAbandoned)) throw error;
    }
  }
  return showViewOnTerminal(
    term,
    view.title,
    screenBodyLines(view, term.size().cols),
    view.footer,
    roguelike,
  );
}

/**
 * The id a core screen occupies the modal band under while it is open.
 *
 * Deliberately a plain string and deliberately NOT a member of
 * `SCREEN_REGION_NAMES` - that constant means "the regions that tile the
 * terminal", and a screen is not one of those (see `regions.ts`).
 */
export const SCREEN_REGION_ID = "core:screen";

/**
 * A core screen's rectangle: THE WHOLE TERMINAL, and that is not a placeholder.
 *
 * 4.2.6 shows a screen as screen_save / full repaint / screen_load, and the
 * parity suite pins those pictures byte for byte. Shrinking core's tombstone
 * would move a picture upstream's own tests describe, for the benefit of no mod:
 * a mod that wants a panel declares its own region rather than asking core to
 * make room. What the screen did not have - and now does - is a rectangle at
 * all, so everything else on the display can learn it is being covered.
 *
 * EXPORTED because it is the shell's answer to "what rectangle is a core screen",
 * and every screen outside this file that declares itself (birth.ts, charsheet.ts,
 * mod-browse.ts) must give the same answer. A copy per file would be three places
 * for one id and one policy to drift apart in, and the drift would be invisible:
 * each copy would look right on its own.
 */
export function screenRegionSpec(): RegionSpec {
  return {
    id: SCREEN_REGION_ID,
    layer: "modal",
    place: (g) => ({ col: 0, row: 0, cols: g.cols, rows: g.rows }),
  };
}

/**
 * The faithful terminal's own way of showing a screen; see `showTextScreen`.
 *
 * Declares the screen's region for as long as it is open and hands the painting
 * a surface clipped to it. `paintViewOnTerminal` below is the painter, and it is
 * UNCHANGED from before it had a region - which is the property `clipSurface`
 * exists to have: region-local coordinates and a `size()` that answers the
 * rectangle mean a painter written against the terminal needs no edit at all.
 */
function showViewOnTerminal(
  host: GridSurface & GridPointerInput,
  title: string,
  lines: readonly ScreenLine[],
  footer: string,
  roguelike = false,
): Promise<void> {
  const handle = pushRegion(screenRegionSpec(), host.size());
  return paintViewOnTerminal(
    regionSurface(host, handle.cells),
    title,
    lines,
    footer,
    roguelike,
  ).finally(() => {
    popRegion(handle);
  });
}

/** One clickable span this paint left on the grid; see `linkSpanAt`. */
interface LinkSpan {
  readonly row: number;
  readonly startCol: number;
  readonly endCol: number;
  readonly href: string;
}

/** The span under `cell`, if any - the tap handler's "did they hit a link" check. */
function linkSpanAt(spans: readonly LinkSpan[], cell: GridCell): LinkSpan | undefined {
  return spans.find(
    (s) => s.row === cell.row && cell.col >= s.startCol && cell.col < s.endCol,
  );
}

/**
 * Hand a line's `href` to the player's real browser (or mail client), the same
 * click-driven contract `openExternalUrl` and `openMailtoLink` both keep: called
 * straight from the key press or tap and never awaited first.
 */
function openScreenLink(href: string): void {
  if (href.startsWith("mailto:")) openMailtoLink(href.slice("mailto:".length));
  else openExternalUrl(href);
}

function paintViewOnTerminal(
  term: GridSurface & GridPointerInput,
  title: string,
  lines: readonly ScreenLine[],
  footer: string,
  roguelike = false,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let top = 0;
    let linkSpans: LinkSpan[] = [];
    const paint = (): void => {
      const { cols, rows } = term.size();
      term.clear();
      term.print(0, HEADER_ROW, title.slice(0, cols - 1), TITLE);
      const bodyRows = rows - BODY_TOP - 1; // last row is the footer
      const maxTop = Math.max(0, lines.length - bodyRows);
      if (top > maxTop) top = maxTop;
      const spans: LinkSpan[] = [];
      for (let r = 0; r < bodyRows; r++) {
        const line = lines[top + r];
        if (!line) break;
        if (line.runs) {
          let x = 0;
          for (const run of line.runs) {
            if (x >= cols - 1) break;
            const chunk = run.text.slice(0, cols - 1 - x);
            term.print(x, BODY_TOP + r, chunk, run.color);
            if (run.href !== undefined && chunk !== "") {
              spans.push({ row: BODY_TOP + r, startCol: x, endCol: x + chunk.length, href: run.href });
            }
            x += chunk.length;
          }
        } else {
          const shown = line.text.slice(0, cols - 1);
          term.print(0, BODY_TOP + r, shown, line.color ?? FG);
          if (line.href !== undefined && shown !== "") {
            spans.push({ row: BODY_TOP + r, startCol: 0, endCol: shown.length, href: line.href });
          }
        }
      }
      linkSpans = spans;
      const more = maxTop > 0 ? `  (${top + 1}-${Math.min(top + bodyRows, lines.length)}/${lines.length})` : "";
      term.print(0, rows - 1, (footer + more).slice(0, cols - 1), DIM);
    };
    const finish = (): void => {
      inputEvents.removeEventListener("keydown", onKey, true);
      setActiveCellTap(term, null);
      resolve();
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const { rows } = term.size();
      const page = Math.max(1, rows - BODY_TOP - 2);
      if (ev.key === "Escape" || ev.key === "Enter" || ev.key === " ") {
        finish();
        return;
      }
      // Scroll with arrows AND numpad digits (menuNav): the numpad must drive
      // scrollable lists regardless of NumLock, not just the arrow keys. j/k
      // scroll too under the roguelike keyset (menuNav's own roguelike gate).
      const bodyRows = rows - BODY_TOP - 1;
      const maxTop = Math.max(0, lines.length - bodyRows);
      const nav = menuNav(ev, roguelike);
      if (!nav) return;
      if (nav === "up") top = Math.max(0, top - 1);
      else if (nav === "down") top += 1;
      else if (nav === "pageup") top = Math.max(0, top - page);
      else if (nav === "pagedown") top += page;
      else if (nav === "home") top = 0;
      else if (nav === "end") top = maxTop;
      paint();
    };
    inputEvents.addEventListener("keydown", onKey, true);
    // Tap: footer row closes; when the content scrolls, a tap in the upper
    // half pages up and in the lower half pages down; a non-scrolling screen
    // closes on any tap (the touch analogue of "any of ESC/Enter/Space").
    setActiveCellTap(term, (cell) => {
      const hit = linkSpanAt(linkSpans, cell);
      if (hit) {
        openScreenLink(hit.href);
        return;
      }
      const { rows } = term.size();
      const bodyRows = rows - BODY_TOP - 1;
      const maxTop = Math.max(0, lines.length - bodyRows);
      if (cell.row === rows - 1 || maxTop === 0) {
        finish();
        return;
      }
      const page = Math.max(1, rows - BODY_TOP - 2);
      if (cell.row < Math.floor(rows / 2)) top = Math.max(0, top - page);
      else top += page;
      paint();
    });
    paint();
  });
}

/**
 * do_cmd_view_map ('M', ui-map.c): a modal, scaled whole-level overview -
 * screen_save / display_map / "Hit any key to continue" / anykey /
 * screen_load, mirroring showTextScreen's Promise + window-keydown shape.
 * `overview` is the priority-resolved miniature buildOverview (mapview.ts)
 * already produced; this only draws it (box border in COLOUR_WHITE, the
 * player's '@' at its scaled cell, the centered footer) and resolves on any
 * key or tap - it builds no rendering of its own.
 */
/**
 * One miniature cell. `put` rather than `print` because a cell can carry a
 * graphics tile: display_map queues (a, c, ta, tc) through Term_queue_char
 * (ui-map.c:849), the same pair the live map queues, so the overview is a tile
 * map whenever a tileset is active. A cell with no tile lands on exactly the
 * ASCII print this replaced - `put` degrades to ch/fg on its own, and also does
 * so when the atlas image is not ready yet.
 */
function drawOverviewCell(
  term: GridSurface,
  x: number,
  y: number,
  g: OverviewGlyph,
): void {
  if (!g.tile) {
    term.print(x, y, g.ch, g.css);
    return;
  }
  term.put(x, y, {
    ch: g.ch,
    fg: g.css,
    tile: flat(g.tile),
    ...(g.bgTile ? { bgTile: flat(g.bgTile) } : {}),
  });
}

/**
 * The miniature is ONE cell per dungeon grid, so a double-height tile must not
 * overdraw here - a tall monster would eat the map row above it, which on a
 * compressed overview is a different part of the dungeon entirely.
 *
 * The reference does the same thing by swapping in a one-by-one tilesheet for
 * the overview (main-sdl.c ~L5245). Dropping the flag is that swap: same
 * picture, cropped to its own cell, which is exactly what the overview wants.
 */
function flat(ref: RenderAssetRef): RenderAssetRef {
  if (!ref.tall) return ref;
  const { tall: _tall, ...rest } = ref;
  return rest;
}

/** SDL2's REASONABLE_MAP_TILE_{WIDTH,HEIGHT}. */
const GRAPHICS_OVERVIEW_TILE = 16;

/** A `RenderAssetRef`'s browser-only tile payload (term.ts owns the same seam). */
interface CanvasTileData {
  blitter?: {
    drawTile(
      ctx: CanvasRenderingContext2D,
      px: number,
      py: number,
      w: number,
      h: number,
      code: { row: number; col: number },
      grid?: { x: number; y: number },
      tall?: boolean,
    ): boolean;
  };
  code?: { row: number; col: number };
  grid?: { x: number; y: number };
  dimScale?: number;
}

/** The offscreen equivalent of GlyphTerm's two-pass tile blit. */
function drawGraphicsTile(
  ctx: CanvasRenderingContext2D,
  asset: RenderAssetRef,
  px: number,
  py: number,
  w: number,
  h: number,
): boolean {
  if (asset.kind !== "canvas-tile" || !asset.data || typeof asset.data !== "object") return false;
  const data = asset.data as CanvasTileData;
  if (!data.blitter || !data.code) return false;
  const alpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha * (data.dimScale ?? 1);
  try {
    return data.blitter.drawTile(ctx, px, py, w, h, data.code, data.grid, asset.tall);
  } finally {
    ctx.globalAlpha = alpha;
  }
}

/** Draw a full-grid graphics cell; foreground failures fall back to its glyph. */
function drawGraphicsOverviewCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  glyph: OverviewGlyph,
): void {
  if (glyph.bgTile) {
    drawGraphicsTile(ctx, glyph.bgTile, x, y, GRAPHICS_OVERVIEW_TILE, GRAPHICS_OVERVIEW_TILE);
  }
  if (glyph.tile && drawGraphicsTile(ctx, glyph.tile, x, y, GRAPHICS_OVERVIEW_TILE, GRAPHICS_OVERVIEW_TILE)) {
    return;
  }
  ctx.fillStyle = glyph.css;
  ctx.font = `${String(GRAPHICS_OVERVIEW_TILE)}px monospace`;
  ctx.textBaseline = "top";
  ctx.fillText(glyph.ch, x, y);
}

function mapModalSize(
  term: GridSurface,
  overview: LevelOverview,
): { mapW: number; mapH: number } {
  if (!isGraphicsOverview(overview)) return { mapW: overview.mapW, mapH: overview.mapH };
  const { cols, rows } = term.size();
  return {
    mapW: Math.min(cols - 2, overview.width),
    mapH: Math.min(rows - 2, overview.height),
  };
}

function hasGridGeometry(surface: GridSurface): surface is GridSurface & GridGeometry {
  return typeof (surface as Partial<GridGeometry>).metrics === "function";
}

/**
 * Build SDL2's full-level texture offscreen, then put one scaled bitmap over
 * the terminal's existing map-box interior.  The terminal still owns the box
 * and footer; this layer owns only the graphical miniature itself.
 */
function mountGraphicsOverview(
  host: GridSurface,
  overview: Extract<LevelOverview, { kind: "graphics" }>,
): HTMLCanvasElement | null {
  if (typeof document === "undefined" || !document.body || !hasGridGeometry(host)) return null;
  const { mapW, mapH } = mapModalSize(host, overview);
  if (mapW < 1 || mapH < 1 || overview.width < 1 || overview.height < 1) return null;
  const source = document.createElement("canvas");
  source.width = overview.width * GRAPHICS_OVERVIEW_TILE;
  source.height = overview.height * GRAPHICS_OVERVIEW_TILE;
  const sourceCtx = source.getContext("2d");
  if (!sourceCtx) return null;
  sourceCtx.imageSmoothingEnabled = false;
  for (let y = 0; y < overview.height; y++) {
    const row = overview.cells[y];
    if (!row) continue;
    for (let x = 0; x < overview.width; x++) {
      const glyph = row[x];
      if (!glyph) continue;
      drawGraphicsOverviewCell(
        sourceCtx,
        x * GRAPHICS_OVERVIEW_TILE,
        y * GRAPHICS_OVERVIEW_TILE,
        glyph,
      );
    }
  }
  const player = overview.playerGlyph ?? { ch: "@", css: TITLE };
  drawGraphicsOverviewCell(
    sourceCtx,
    overview.playerGrid.x * GRAPHICS_OVERVIEW_TILE,
    overview.playerGrid.y * GRAPHICS_OVERVIEW_TILE,
    player,
  );

  const metrics = host.metrics();
  const availableW = mapW * metrics.cellWidth;
  const availableH = mapH * metrics.cellHeight;
  const scale = Math.min(availableW / source.width, availableH / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  const left = metrics.originX + metrics.cellWidth + (availableW - width) / 2;
  const top = metrics.originY + metrics.cellHeight + (availableH - height) / 2;
  const canvas = document.createElement("canvas");
  const dpr = (typeof window === "undefined" ? 1 : window.devicePixelRatio) || 1;
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  Object.assign(canvas.style, {
    position: "fixed",
    left: `${String(left)}px`,
    top: `${String(top)}px`,
    width: `${String(width)}px`,
    height: `${String(height)}px`,
    imageRendering: "pixelated",
    pointerEvents: "none",
    zIndex: "1",
  });
  canvas.setAttribute("aria-hidden", "true");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, width, height);
  try {
    document.body.appendChild(canvas);
    return canvas;
  } catch {
    return null;
  }
}

/**
 * do_cmd_view_map ('M'): the whole level in miniature.
 *
 * A REGION, for the same reason `showViewOnTerminal` is one, and this is the
 * site where the risk stopped being theoretical (#261 commit 5). 'M' takes the
 * direct modal path to this function rather than going through `showTextScreen`,
 * so before this it was the one full-screen erase a mod could not survive: the
 * overview called `term.clear()`, and `renderBackground()` refuses to run
 * `render()` while a modal owns the terminal - so `paintRegionStack()` could not
 * repaint what had just been wiped until the player closed the map again. A
 * mod's window was drawn, the player pressed 'M', and the window was gone with
 * no exception, no console entry and nothing to search for.
 *
 * The split into a `show*`/`paint*` pair is the shape `showViewOnTerminal` and
 * `paintViewOnTerminal` already use, and the painter's body is UNCHANGED - which
 * is the property `clipSurface` exists to have. `term.clear()` inside it now
 * erases the screen's own rectangle, which happens to be the whole terminal,
 * because that is what a 4.2.6 screen is. The picture is byte-identical; what
 * changed is that everything else on the display can see it happen.
 */
export function showLevelMap(
  host: GridSurface & GridPointerInput,
  overview: LevelOverview | (() => LevelOverview),
  connectRepaint?: (repaint: () => void) => () => void,
): Promise<void> {
  const handle = pushRegion(screenRegionSpec(), host.size());
  return paintLevelMapOnTerminal(
    regionSurface(host, handle.cells),
    host,
    typeof overview === "function" ? overview : () => overview,
    connectRepaint,
  ).finally(() => {
    popRegion(handle);
  });
}

function paintLevelMapOnTerminal(
  term: GridSurface & GridPointerInput,
  host: GridSurface & GridPointerInput,
  overviewForPaint: () => LevelOverview,
  connectRepaint?: (repaint: () => void) => () => void,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let graphics: HTMLCanvasElement | null = null;
    const paint = (): void => {
      graphics?.remove();
      graphics = null;
      const overview = overviewForPaint();
      const { cols, rows } = term.size();
      term.clear();
      const { mapW, mapH } = mapModalSize(term, overview);
      if (mapW >= 1 && mapH >= 1) {
        // window_make (ui-output.c): a '+' cornered box in COLOUR_WHITE
        // around the interior, offsetting every interior cell by (+1,+1).
        term.print(0, 0, `+${"-".repeat(mapW)}+`, TITLE);
        term.print(0, mapH + 1, `+${"-".repeat(mapW)}+`, TITLE);
        for (let r = 0; r < mapH; r++) {
          term.print(0, r + 1, "|", TITLE);
          term.print(mapW + 1, r + 1, "|", TITLE);
        }
        if (!isGraphicsOverview(overview)) {
          for (let r = 0; r < mapH; r++) {
            const row = overview.cells[r];
            if (!row) continue;
            for (let c = 0; c < mapW; c++) {
              const g = row[c];
              if (g) drawOverviewCell(term, c + 1, r + 1, g);
            }
          }
          // The player is always drawn last, on top of whatever occupies its cell.
          drawOverviewCell(
            term,
            overview.playerCol + 1,
            overview.playerRow + 1,
            overview.playerGlyph ?? { ch: "@", css: TITLE },
          );
        }
      }
      const footer = "Hit any key to continue";
      const fx = Math.max(0, Math.floor((cols - footer.length) / 2));
      term.print(fx, rows - 1, footer.slice(0, cols - 1), DIM);
      graphics = isGraphicsOverview(overview) ? mountGraphicsOverview(host, overview) : null;
    };
    const disconnectRepaint = connectRepaint?.(paint) ?? (() => undefined);
    const finish = (): void => {
      inputEvents.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onTap, true);
      disconnectRepaint();
      graphics?.remove();
      resolve();
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      finish();
    };
    const onTap = (ev: Event): void => {
      ev.preventDefault();
      finish();
    };
    inputEvents.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onTap, true);
    paint();
  });
}

/** One row of a show_obj_list listing (ui-object.c:140-238). */
export interface ObjListRow {
  /** items[].label - "a) " for the floor (ui-object.c:291). */
  label: string;
  /** items[].o_name - object_desc(ODESC_PREFIX | ODESC_FULL) (ui-object.c:437). */
  name: string;
  /** obj->kind->base->attr as CSS (ui-object.c:176-186). */
  color: string;
  /** obj->number * object_weight_one(obj), in TENTHS of a pound (ui-object.c:462). */
  weight: number;
}

/** OLIST_WEIGHT's column width (ui-object.c:406: `ex_width += 9`). */
const OLIST_WEIGHT_WIDTH = 9;

/**
 * The floor-pile listing that see_floor_items shows when more than one object is
 * on your grid (ui-display.c:2629-2647):
 *
 *     screen_save();
 *     show_floor(floor_list, floor_num, OLIST_WEIGHT, NULL);
 *     prt(format("You %s: ", p), 0, 0);
 *     e = inkey_ex();
 *     Term_event_push(&e);
 *     screen_load();
 *
 * Four things there that the port's showTextScreen substitute got wrong:
 *
 * 1. It is an OVERLAY over screen_save, not a cleared screen. show_obj_list
 *    right-anchors the block (`col = Term->wid - 1 - max_len - ex_width`,
 *    ui-object.c:418-422) starting at ROW 1, and each row clears only from
 *    `MAX(col - 1, 0)` rightwards (ui-object.c:151). Everything to the left of
 *    that - the map, the sidebar - stays on screen. term.clear() blanked it.
 * 2. OLIST_WEIGHT is passed, so every row carries a `%4d.%1d lb` column
 *    (ui-object.c:461-464). The port showed no weights at all.
 * 3. There is NO footer. The port's showTextScreen appended
 *    "[ Press ESC to return ]", which upstream never writes anywhere on this
 *    screen - an invented string, which is worse than an absence because it
 *    fills the slot where a census would notice one missing.
 * 4. `Term_event_push(&e)` RE-FEEDS the dismissing key as the next command, so
 *    stepping onto a pile and pressing 'g' picks up in one keystroke. The port
 *    swallowed it. `refeed` is the port's Term_event_push (input-queue.ts
 *    enqueueKeys), injected rather than imported so this module stays free of the
 *    shell's input plumbing.
 *
 * screen_load is the caller's job: the shell repaints with render() when this
 * resolves, which is what puts the map back.
 */
export function showFloorList(
  term: GridSurface & GridPointerInput,
  prompt: string,
  rows: readonly ObjListRow[],
  refeed?: (key: string) => void,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const { cols } = term.size();
    /* set_obj_names' max_len: label + equip_label + o_name, and the floor has no
     * equip_label (ui-object.c:326-327, :455-458). */
    let maxLen = 0;
    for (const r of rows) maxLen = Math.max(maxLen, r.label.length + r.name.length);
    /* "Determine beginning row and column" (ui-object.c:411-422). */
    const row = 1;
    let col = cols - 1 - maxLen - OLIST_WEIGHT_WIDTH;
    if (col < 3) col = 0;
    /* "Column offset of the first extra field" (ui-object.c:425). */
    const exOffset = Math.min(maxLen, cols - 1 - OLIST_WEIGHT_WIDTH - col);

    rows.forEach((r, i) => {
      const y = row + i;
      /* "Clear the line" (ui-object.c:151): from col - 1, NOT from col 0. */
      term.prt(Math.max(col - 1, 0), y, "", FG);
      /* The label, then the object name, both c_put_str (ui-object.c:158, :189). */
      term.print(col, y, r.label, FG);
      /* "Limit object name" (ui-object.c:164-174): truncate to ex_offset. */
      let name = r.name;
      if (r.label.length + name.length > exOffset) {
        name = name.slice(0, Math.max(0, exOffset - r.label.length));
      }
      term.print(col + r.label.length, y, name, r.color);
      /* Weight: `%4d.%1d lb` in tenths (ui-object.c:461-464), put_str at
       * col + ex_offset - a put_str, so it does NOT erase. */
      const lbs = String(Math.trunc(r.weight / 10)).padStart(4);
      term.print(col + exOffset, y, `${lbs}.${r.weight % 10} lb`, FG);
    });
    /* "Print a drop shadow for the main window if necessary" (ui-object.c:465-467):
     * one more cleared row under the list, only while it fits on the term. */
    if (rows.length > 0 && row + rows.length < 24) {
      term.prt(Math.max(col - 2, 0), row + rows.length, "", FG);
    }
    /* prt(format("You %s: ", p), 0, 0) (ui-display.c:2640). */
    term.prt(0, 0, prompt.slice(0, cols - 1), FG);

    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      /* A lone modifier is not a key inkey_ex would return. */
      if (ev.key === "Shift" || ev.key === "Control" || ev.key === "Alt" || ev.key === "Meta") {
        return;
      }
      inputEvents.removeEventListener("keydown", onKey, true);
      setActiveCellTap(term, null);
      /* Term_event_push(&e) (ui-display.c:2644): the key that dismissed the list
       * becomes the next command. */
      refeed?.(ev.key);
      resolve();
    };
    inputEvents.addEventListener("keydown", onKey, true);
    /* A tap is the touch analogue of "any key"; there is no key to re-feed. */
    setActiveCellTap(term, () => {
      inputEvents.removeEventListener("keydown", onKey, true);
      setActiveCellTap(term, null);
      resolve();
    });
  });
}

/** getAimDir sentinel: the player pressed '*' (or <click>) to pick a target. */
export const AIM_STAR = -1;
/** getAimDir sentinel: the player pressed "'" to target the closest monster. */
export const AIM_CLOSEST = -2;

/** Keypad direction from an arrow key (ddd/ddx/ddy convention), else 0. */
const ARROW_DIR: Record<string, number> = {
  ArrowUp: 8, ArrowDown: 2, ArrowLeft: 4, ArrowRight: 6,
};

/**
 * Clear the row-0 prompt line: `prt("", 0, 0)` (ui-input.c:1275, :1325, :1433,
 * :1518 ...), i.e. `Term_erase(0, 0, 255)` with an empty string to draw. The next
 * frame repaints the message line, but blanking here keeps a cancelled prompt
 * from lingering when the caller returns without rendering.
 *
 * This used to print `cols - 1` spaces, which left the LAST column of the row
 * untouched (Term_erase's 255 is clamped to the full term width) and painted
 * spaces where upstream leaves empty cells. term.prt does the real erase.
 */
function clearPromptRow(term: GridSurface & GridPointerInput, row = 0): void {
  term.prt(0, row, "", FG);
}

/**
 * textui_get_rep_dir (ui-input.c L1487): a "repeated"/movement direction for
 * open / close / tunnel / disarm / alter / walk / run / jump / steal. Draws the
 * single shared prompt at row 0 in white (prt) and accepts keypad 1-9 and the
 * arrows; ESC cancels. `allow5` mirrors the C allow_5 flag: when false, keypad
 * 5 is equivalent to escape (returns null). It does NOT accept '*' - aiming is
 * a separate function (get_aim_dir). Resolves the keypad digit, or null.
 */
export function getRepDir(
  term: GridSurface & GridPointerInput,
  allow5 = false,
): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    const { cols } = term.size();
    /* prt("Direction or <click> (Escape to cancel)? ", 0, 0) (ui-input.c:1512):
     * prt, not put_str - it is drawn over the live message row. */
    term.prt(0, 0, "Direction or <click> (Escape to cancel)? ".slice(0, cols - 1), FG);
    const finish = (value: number | null): void => {
      inputEvents.removeEventListener("keydown", onKey, true);
      clearPromptRow(term);
      resolve(value);
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (ev.key === "Escape") return finish(null);
      let dir = 0;
      if (ev.key in ARROW_DIR) dir = ARROW_DIR[ev.key] ?? 0;
      else if (/^[1-9]$/.test(ev.key)) dir = Number(ev.key);
      if (dir === 0) return; // bell(): ignore non-direction keys
      if (dir === 5 && !allow5) return finish(null); // "5 is equivalent to escape"
      finish(dir);
    };
    inputEvents.addEventListener("keydown", onKey, true);
  });
}

/**
 * textui_get_aim_dir (ui-input.c L1608): an aiming direction for fire / throw /
 * aim / zap / attack spells. Draws one of two row-0 white prompts depending on
 * whether a target is already set (target_okay). Accepts keypad 1-9 and arrows
 * (a compass direction), '*' or <click> to open the target picker (AIM_STAR),
 * "'" for the closest monster (AIM_CLOSEST), and 5/t/0/. to use the current
 * target (returns 5, DIR_TARGET) - the last only when a target is set. ESC
 * cancels. Resolves the keypad digit, a sentinel, 5, or null.
 */
export function getAimDir(
  term: GridSurface & GridPointerInput,
  targetOkay: boolean,
): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    const { cols } = term.size();
    const prompt = targetOkay
      ? "Direction ('5' for target, '*' or <click> to re-target, Escape to cancel)? "
      : "Direction ('*' or <click> to target, \"'\" for closest, Escape to cancel)? ";
    /* textui_get_aim_dir asks through get_com_ex (ui-input.c:1637), which is
     * `prt(prompt, 0, 0)` at ui-input.c:1427 - over the live message row. */
    term.prt(0, 0, prompt.slice(0, cols - 1), FG);
    const finish = (value: number | null): void => {
      inputEvents.removeEventListener("keydown", onKey, true);
      clearPromptRow(term);
      resolve(value);
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (ev.key === "Escape") return finish(null);
      if (ev.key === "*") return finish(AIM_STAR);
      if (ev.key === "'") return finish(AIM_CLOSEST);
      if (ev.key === "t" || ev.key === "5" || ev.key === "0" || ev.key === ".") {
        if (targetOkay) return finish(5); // DIR_TARGET
        return; // bell(): no target to use
      }
      let dir = 0;
      if (ev.key in ARROW_DIR) dir = ARROW_DIR[ev.key] ?? 0;
      else if (/^[1-9]$/.test(ev.key)) dir = Number(ev.key);
      if (dir === 0 || dir === 5) return; // bell(): 5 handled above
      finish(dir);
    };
    inputEvents.addEventListener("keydown", onKey, true);
  });
}

/**
 * textui_get_check (ui-input.c L1255): an inline yes/no confirmation. Builds
 * "%.70s[y/n] " (the prompt truncated to 70 chars, then "[y/n] "), draws it at
 * row 0 in white (prt), and reads a single key. Returns true only for 'y'/'Y';
 * every other key - including Escape - is "no", exactly as the reference. Pure
 * modifier keydowns (Shift/Ctrl/Alt/Meta) are ignored so a Shift+Y chord is
 * not read as an immediate "no".
 */
export function getCheck(term: GridSurface & GridPointerInput, prompt: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const { cols } = term.size();
    const buf = `${prompt.slice(0, 70)}[y/n] `;
    /* prt(buf, 0, 0) (ui-input.c:1271). This MUST erase: the prompt lands on the
     * message row, and a bare print left the tail of the previous message behind
     * - the live "Save and quit?[y/n] d5) (+5,+3) (0)." report. */
    term.prt(0, 0, buf.slice(0, cols - 1), FG);
    const finish = (value: boolean): void => {
      inputEvents.removeEventListener("keydown", onKey, true);
      clearPromptRow(term);
      resolve(value);
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Shift" || ev.key === "Control" || ev.key === "Alt" || ev.key === "Meta") {
        return; // a modifier alone is not an answer
      }
      ev.preventDefault();
      ev.stopImmediatePropagation();
      finish(ev.key === "y" || ev.key === "Y");
    };
    inputEvents.addEventListener("keydown", onKey, true);
  });
}

/**
 * A single inline keypress over the current screen (prt(prompt, 0, 0); inkey()).
 * Draws `prompt` at row 0 in white, reads ONE key (lone Shift/Ctrl/Alt/Meta
 * ignored), clears row 0, and resolves the key string - the faithful shape of
 * the retire '@' verification (ui-command.c L178-182) and any other "type this
 * exact key to confirm" prompt, which do NOT open a full-screen line editor.
 *
 * This is get_com_ex / textui_get_com (ui-input.c:1407); textui_get_com is only
 * get_com_ex narrowed to an ASCII char, so it has no separate counterpart. The
 * C returns false on ESCAPE where callers here compare the resolved key.
 *
 * `col` is the column to draw at. get_com_ex is always column 0, but the same
 * prt-then-inkey shape is written out by hand in a few places at a column of
 * their own - close_game's "Press Return (or Escape)." sits at column 40
 * (ui-game.c:1155) - and those are this function with a different anchor rather
 * than a second copy of the keypress plumbing.
 */
export function getKeyInline(
  term: GridSurface & GridPointerInput,
  prompt: string,
  col = 0,
): Promise<string> {
  return new Promise<string>((resolve) => {
    const { cols } = term.size();
    /* prt(prompt, 0, 0) (get_com_ex, ui-input.c:1427). */
    term.prt(col, 0, prompt.slice(0, Math.max(0, cols - 1 - col)), FG);
    const finish = (key: string): void => {
      inputEvents.removeEventListener("keydown", onKey, true);
      clearPromptRow(term);
      resolve(key);
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Shift" || ev.key === "Control" || ev.key === "Alt" || ev.key === "Meta") {
        return;
      }
      ev.preventDefault();
      ev.stopImmediatePropagation();
      finish(ev.key);
    };
    inputEvents.addEventListener("keydown", onKey, true);
  });
}

/** The buffer and cursor askfor_aux threads through its keypress handler. */
interface LineEdit {
  buf: string;
  /** k in askfor_aux (L864). Starts at 0, i.e. in FRONT of the default. */
  curs: number;
}

/**
 * askfor_aux_keypress (ui-input.c:662-800), the line editor both prompts share.
 * Upstream handles exactly six cases and no others, and anything unmatched is
 * inert -- which is also how askfor_aux_numbers (ui-options.c:1026) restricts
 * itself to digits: it switches on the keys it allows and delegates every one of
 * them here, returning false for the rest. Hence `accepts`.
 *
 * The `firsttime` rule is the whole point of the function and the part the port
 * originally dropped (found by W1-CITED, fixed 2026-07-26): a default answer
 * behaves like a suggestion you type OVER, not text you append to. The flag
 * clears after ANY keypress (L910).
 */
function askforAuxKeypress(
  st: LineEdit,
  maxLen: number,
  key: string,
  firsttime: boolean,
  accepts: (ch: string) => boolean,
): "escape" | "enter" | "edit" {
  /* ESCAPE (L669-673) / KC_ENTER (L675-679). */
  if (key === "Escape") return "escape";
  if (key === "Enter") return "enter";

  if (key === "ArrowLeft") {
    /* L682-689: the first left jumps to the front, it does not step. */
    st.curs = firsttime ? 0 : Math.max(0, st.curs - 1);
  } else if (key === "ArrowRight") {
    /* L691-698. */
    st.curs = firsttime ? st.buf.length : Math.min(st.buf.length, st.curs + 1);
  } else if (key === "Backspace" || key === "Delete") {
    if (firsttime) {
      /* L703-709: "If this is the first time round, backspace means delete
       * all". The C shares the case, so Delete does it too. */
      st.buf = "";
      st.curs = 0;
    } else if (key === "Backspace") {
      /* L712-714 refuses to backspace into oblivion. */
      if (st.curs > 0) {
        st.buf = st.buf.slice(0, st.curs - 1) + st.buf.slice(st.curs);
        st.curs--;
      }
    } else if (st.curs < st.buf.length) {
      st.buf = st.buf.slice(0, st.curs) + st.buf.slice(st.curs + 1);
    }
  } else if (key.length === 1 && accepts(key)) {
    /* The printable default (L749-800). */
    if (firsttime) {
      /* L765-771: the first printable key clears the buffer, so a typed answer
       * REPLACES the default. Without this the birth screen's default "Gandalf"
       * plus typing "Bob" produced "GandalfBob". */
      st.buf = "";
      st.curs = 0;
    }
    /* L772-775: refuse when there is no room, rather than truncating. */
    if (st.buf.length < maxLen) {
      st.buf = st.buf.slice(0, st.curs) + key + st.buf.slice(st.curs);
      st.curs++;
    }
  }
  return "edit";
}

/** Insert one pasted, single-line value at the line editor cursor. */
function pasteLineEdit(st: LineEdit, maxLen: number, clipboardText: string): void {
  const text = clipboardText.split(/\r\n?|\n/u, 1)[0] ?? "";
  const inserted = text.slice(0, Math.max(0, maxLen - st.buf.length));
  st.buf = st.buf.slice(0, st.curs) + inserted + st.buf.slice(st.curs);
  st.curs += inserted.length;
}

/**
 * Draw the buffer with its cursor. There is no Term_gotoxy on this surface, so
 * the cursor is an inverted cell. The text renders in COLOUR_YELLOW while the
 * default is untouched and COLOUR_WHITE after the first keypress (L892 vs L907).
 *
 * Deliberately print(), NOT prt(): askfor_aux clears the field with the BOUNDED
 * `Term_erase(x, y, (int)len)` (ui-input.c:891, :906, :983, :1012) - len cells,
 * not to the end of the row - because anything further right on that row belongs
 * to the screen underneath and must survive. Each caller's paint() has already
 * cleared the field's span (term.clear(), or the prompt's own prt erasing to the
 * end of the row) before this runs.
 */
function paintLineEdit(
  term: GridSurface & GridPointerInput,
  x: number,
  y: number,
  st: LineEdit,
  firsttime: boolean,
): void {
  const { cols } = term.size();
  const fg = firsttime ? UI_GOLD : FG;
  term.print(x, y, `${st.buf}`.slice(0, cols - 1 - x), fg);
  const cx = x + st.curs;
  if (cx < cols) term.print(cx, y, st.buf[st.curs] ?? " ", UI_BG, fg);
}

/**
 * A single-line text input (get_string / textui_get_name), ported from
 * askfor_aux (ui-input.c:860) driving askfor_aux_keypress (L662). Resolves the
 * entered string (possibly empty) or null on cancel.
 *
 * The `firsttime` rule is the part that matters and the part the port originally
 * dropped (found by W1-CITED, fixed 2026-07-26). Upstream a default answer
 * behaves like a suggestion you type OVER: the first printable key clears the
 * whole buffer (L765-771) and the first Backspace or Delete deletes all of it
 * (L703-709), while the first ARROW_LEFT jumps to the front and the first
 * ARROW_RIGHT to the end (L682-698) rather than stepping. The flag clears after
 * ANY keypress (L910). Without it the birth screen's default "Gandalf" plus
 * typing "Bob" produced "GandalfBob".
 *
 * The cursor is real: k starts at 0, i.e. in FRONT of the default (L864), and
 * insert/delete happen at it. There is no Term_gotoxy on this surface, so it
 * draws as an inverted cell. The default renders in COLOUR_YELLOW until the
 * first keypress and COLOUR_WHITE after (L892 vs L907).
 *
 * askfor_aux_keypress handles exactly six cases and no others -- ESCAPE,
 * KC_ENTER, ARROW_LEFT, ARROW_RIGHT, KC_BACKSPACE/KC_DELETE, and printable --
 * so anything else is deliberately inert here too.
 *
 * `randomize` opts this surface into get_name_keypress (ui-input.c L1028), the
 * handler askfor_aux is given for the CHARACTER NAME field specifically: it
 * intercepts '*' ahead of the default handler, replaces the whole buffer with
 * player_random_name's output and resets the cursor to 0 (L1035-1042), then
 * carries on editing. `firsttime` is not consulted by that case, so '*' as the
 * very first key replaces rather than clears-and-inserts; it does clear
 * firsttime afterwards, as any keypress does (L910).
 */
/**
 * askfor_aux over the CURRENT screen (ui-input.c:860), the inline form: the
 * prompt is drawn at row 0 and the answer is typed right after it, leaving
 * everything already on screen untouched.
 *
 * This is the shape of get_character_name (ui-input.c:1145-1169) - `prt("Enter a
 * name for your character (* for a random name): ", 0, 0)` over the character
 * sheet display_player(0) has just drawn - and of get_string generally. The
 * full-screen promptText below is a different thing (its own titled screen) and
 * must not be used where the C keeps the screen.
 *
 * Resolves the entered string, or null on ESCAPE. Clears the prompt row either
 * way (`prt("", 0, 0)`, L1162).
 *
 * `row` is where the prompt is drawn. Upstream's askfor_aux takes no row at
 * all - it draws wherever the cursor already is - so the row is whatever the
 * caller's preceding prt() left it on. Row 0 is the common case (the message
 * line); the pref-file screens prt their prompt further down the screen first
 * (get_pref_path's `prt("File: ", row + 2, 0)`), and pass that row here.
 */
export function promptTextInline(
  term: GridSurface & GridPointerInput,
  prompt: string,
  initial = "",
  maxLen = 15,
  randomize?: () => string,
  row = 0,
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const st: LineEdit = { buf: initial, curs: 0 };
    let firsttime = true;
    let composing = false;
    const x = prompt.length;
    const paint = (): void => {
      const { cols } = term.size();
      /* The caller's own `prt(prompt, row, 0)` (e.g. ui-input.c:1153, :1189,
       * :1357, ui-options.c:57) - one erase-then-draw, not a spaces pass
       * followed by a draw. */
      term.prt(0, row, prompt.slice(0, cols - 1), FG);
      paintLineEdit(term, x, row, st, firsttime);
    };
    const finish = (value: string | null): void => {
      inputEvents.removeEventListener("keydown", onKey, true);
      inputEvents.removeEventListener("paste", onPaste, true);
      inputEvents.removeEventListener("compositionstart", onCompositionStart, true);
      inputEvents.removeEventListener("compositionend", onCompositionEnd, true);
      clearPromptRow(term, row);
      resolve(value);
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (composing || ev.isComposing) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        return;
      }
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const wasFirst = firsttime;
      firsttime = false;
      /* get_name_keypress' '*' -> player_random_name (ui-input.c L1035-1042). */
      if (randomize && ev.key === "*") {
        const generated = randomize();
        if (generated !== "") {
          st.buf = generated.slice(0, maxLen);
          st.curs = 0;
        }
        paint();
        return;
      }
      const r = askforAuxKeypress(st, maxLen, ev.key, wasFirst, () => !ev.ctrlKey && !ev.metaKey);
      if (r === "escape") return finish(null);
      if (r === "enter") return finish(st.buf);
      paint();
    };
    const onPaste = (ev: ClipboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      pasteLineEdit(st, maxLen, ev.clipboardData?.getData("text") ?? "");
      firsttime = false;
      paint();
    };
    const onCompositionStart = (): void => {
      composing = true;
    };
    const onCompositionEnd = (): void => {
      composing = false;
    };
    inputEvents.addEventListener("keydown", onKey, true);
    inputEvents.addEventListener("paste", onPaste, true);
    inputEvents.addEventListener("compositionstart", onCompositionStart, true);
    inputEvents.addEventListener("compositionend", onCompositionEnd, true);
    paint();
  });
}

/**
 * get_string (textui_get_string, ui-input.c:1181): `prt(prompt, 0, 0)`, then
 * askfor_aux over the untouched screen with `initial` as the default answer,
 * then `prt("", 0, 0)`. Resolves the typed string, or null where the C returns
 * false (ESCAPE).
 *
 * `len` is the C's `sizeof(buf)`, so the answer is at most len-1 characters -
 * and askfor_aux narrows that again to what still fits on an 80-column row
 * after the prompt (L881-882: `if (x + len > 80) len = 80 - x`). Callers pass
 * the C's sizeof value verbatim so both limits land where upstream puts them.
 */
export function getString(
  term: GridSurface & GridPointerInput,
  prompt: string,
  initial = "",
  len = 80,
  row = 0,
): Promise<string | null> {
  const x = prompt.length;
  const eff = x + len > 80 ? 80 - x : len;
  return promptTextInline(term, prompt, initial, Math.max(1, eff - 1), undefined, row);
}

/**
 * get_quantity (textui_get_quantity, ui-input.c:1206): an amount prompt over
 * the current screen. `max` of 1 answers 1 without asking; otherwise it is a
 * get_string defaulting to "1" with a 7-byte buffer, read with atoi, where a
 * leading '*' or letter means "all", and the result is clamped to [0, max].
 * ESCAPE is 0, which every caller treats as "no".
 *
 * `prompt` is the caller's (e.g. "How many great objects? "); null builds
 * upstream's own "Quantity (0-N, *=all): ".
 */
export async function getQuantity(
  term: GridSurface & GridPointerInput,
  prompt: string | null,
  max: number,
): Promise<number> {
  if (max === 1) return 1;
  const label = prompt ?? `Quantity (0-${max}, *=all): `;
  const s = await getString(term, label, "1", 7);
  if (s === null) return 0;
  /* atoi: leading digits, 0 for anything unparseable. */
  const parsed = Number.parseInt(s, 10);
  let amt = Number.isFinite(parsed) ? parsed : 0;
  /* L1234: only the FIRST character makes it "all". */
  const first = s.charAt(0);
  if (first === "*" || /^[a-zA-Z]$/.test(first)) amt = max;
  if (amt > max) amt = max;
  if (amt < 0) amt = 0;
  return amt;
}

/**
 * get_char (ui-input.c:1300-1329): a one-key choice from a fixed option set.
 * Builds "%.70s[%s] " (strnfmt into a 78-byte buffer), reads one key,
 * lower-cases A-Z, and answers `fallback` for anything not in `options`.
 */
export async function getChar(
  term: GridSurface & GridPointerInput,
  prompt: string,
  options: string,
  fallback = " ",
): Promise<string> {
  const buf = `${prompt.slice(0, 70)}[${options}] `.slice(0, 77);
  let key = await getKeyInline(term, buf);
  /* "Lowercase answer if necessary" (L1318). */
  if (key.length === 1 && key >= "A" && key <= "Z") key = key.toLowerCase();
  if (key.length !== 1 || !options.includes(key)) key = fallback;
  return key;
}

/**
 * get_file (get_file_text, ui-input.c:1350-1398): ask where to write a dump.
 *
 *   File name: <suggested>          get_string over the untouched screen
 *   <empty or leading space>        -> cancel (L1362)
 *   Replace existing file?          only when the user directory has that name
 *   Saving as user/<name>.          prt + anykey + prt("", 0, 0)
 *
 * Resolves the file name, or null on any of the three cancels.
 *
 * Under arg_force_name (L1363-1383) the prompt is replaced: the host has pinned
 * the name, so the ".txt" is overwritten with a timestamp and the player is
 * asked to confirm the result rather than type it. Reachable only with `-f`,
 * which means only on a front end that has a command line.
 */
export async function getFile(
  term: GridSurface & GridPointerInput,
  suggestedName: string,
): Promise<string | null> {
  /* char buf[160] (L1352). */
  let name: string;
  if (argForceName()) {
    /* prt("File name: ", 0, 0) (L1372) - drawn, then left for the get_check
     * below to overwrite, exactly as upstream leaves it. */
    term.prt(0, 0, "File name: ", FG);
    /* strftime("-%Y-%m-%d-%H-%M.txt") over the last four characters, which are
     * the ".txt" the caller appended (L1375-1377, with its assert that they are
     * there to overwrite). */
    const stem =
      suggestedName.length >= 4 ? suggestedName.slice(0, -4) : suggestedName;
    name = `${stem}${localTimestampSuffix(new Date())}`;
    if (!(await getCheck(term, `Confirm writing to ${name}? `))) return null;
  } else {
    const typed = await getString(term, "File name: ", suggestedName, 160);
    if (typed === null) return null;
    /* "Make sure it's actually a filename" (L1361-1362). */
    if (typed === "" || typed.startsWith(" ")) return null;
    name = typed;
  }
  if (userExists(name) && !(await getCheck(term, "Replace existing file? "))) {
    return null;
  }
  /* "Tell the user where it's saved to." (L1392-1395). */
  await getKeyInline(term, `Saving as ${userPath(name)}.`);
  return name;
}

export function promptText(
  term: GridSurface & GridPointerInput,
  title: string,
  initial = "",
  maxLen = 15,
  footer = "[ type a name, Enter to accept, ESC to cancel ]",
  randomize?: () => string,
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const st: LineEdit = { buf: initial, curs: 0 };
    let firsttime = true;
    let composing = false;
    const PROMPT = "> ";
    const paint = (): void => {
      const { cols, rows } = term.size();
      term.clear();
      term.print(0, HEADER_ROW, title.slice(0, cols - 1), TITLE);
      term.print(0, BODY_TOP, PROMPT, FG);
      paintLineEdit(term, PROMPT.length, BODY_TOP, st, firsttime);
      term.print(0, rows - 1, footer.slice(0, cols - 1), DIM);
    };
    const finish = (value: string | null): void => {
      inputEvents.removeEventListener("keydown", onKey, true);
      inputEvents.removeEventListener("paste", onPaste, true);
      inputEvents.removeEventListener("compositionstart", onCompositionStart, true);
      inputEvents.removeEventListener("compositionend", onCompositionEnd, true);
      resolve(value);
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (composing || ev.isComposing) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        return;
      }
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const wasFirst = firsttime;
      firsttime = false;
      /* get_name_keypress' '*' case (ui-input.c L1035-1042), ahead of the
       * default handler and independent of firsttime. */
      if (randomize && ev.key === "*") {
        const generated = randomize();
        if (generated !== "") {
          st.buf = generated.slice(0, maxLen);
          st.curs = 0;
        }
        paint();
        return;
      }
      const r = askforAuxKeypress(
        st,
        maxLen,
        ev.key,
        wasFirst,
        () => !ev.ctrlKey && !ev.metaKey,
      );
      if (r === "escape") return finish(null);
      if (r === "enter") return finish(st.buf);
      paint();
    };
    const onPaste = (ev: ClipboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      pasteLineEdit(st, maxLen, ev.clipboardData?.getData("text") ?? "");
      firsttime = false;
      paint();
    };
    const onCompositionStart = (): void => {
      composing = true;
    };
    const onCompositionEnd = (): void => {
      composing = false;
    };
    inputEvents.addEventListener("keydown", onKey, true);
    inputEvents.addEventListener("paste", onPaste, true);
    inputEvents.addEventListener("compositionstart", onCompositionStart, true);
    inputEvents.addEventListener("compositionend", onCompositionEnd, true);
    paint();
  });
}

/**
 * A digit-only numeric prompt (askfor_aux_numbers, ui-options.c L1026): shows
 * the current value on its own line, accepts only digits/Backspace, Enter
 * confirms (clamped to [min, max]), Escape cancels (resolves null). `subtitle`
 * renders as a second line above the input, e.g. "Current hitpoint warning: 3
 * (30%)" (do_cmd_hp_warn) or "Current base delay factor: 40 msec"
 * (do_cmd_delay).
 *
 * The [min, max] clamp matches do_cmd_delay's `MIN(val, 255)` exactly, but
 * do_cmd_hp_warn's ">9 resets to 0" rule is NOT a plain clamp (12 -> 0, not
 * 9) - callers with that rule should pass a generous `max` (so this function
 * never mis-clamps the raw value) and apply the >9 -> 0 reset themselves on
 * the returned number.
 */
export function promptNumber(
  term: GridSurface & GridPointerInput,
  title: string,
  current: number,
  min: number,
  max: number,
  subtitle?: string,
  maxLen = 3,
): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    const st: LineEdit = { buf: String(current), curs: 0 };
    let firsttime = true;
    let composing = false;
    const PROMPT = "> ";
    const paint = (): void => {
      const { cols, rows } = term.size();
      term.clear();
      term.print(0, HEADER_ROW, title.slice(0, cols - 1), TITLE);
      let y = BODY_TOP;
      if (subtitle) {
        term.print(0, y, subtitle.slice(0, cols - 1), DIM);
        y += 1;
      }
      term.print(0, y, PROMPT, FG);
      paintLineEdit(term, PROMPT.length, y, st, firsttime);
      term.print(0, rows - 1, "[ digits, Enter to accept, ESC to cancel ]".slice(0, cols - 1), DIM);
    };
    const finish = (value: number | null): void => {
      inputEvents.removeEventListener("keydown", onKey, true);
      inputEvents.removeEventListener("compositionstart", onCompositionStart, true);
      inputEvents.removeEventListener("compositionend", onCompositionEnd, true);
      resolve(value);
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (composing || ev.isComposing) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        return;
      }
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const wasFirst = firsttime;
      firsttime = false;
      /* askfor_aux_numbers (ui-options.c:1026) allows ESCAPE, ENTER, the two
       * arrows, DELETE, BACKSPACE and the ten digits, delegates every one of them
       * to askfor_aux_keypress, and returns false -- inert -- for anything else. */
      const r = askforAuxKeypress(st, maxLen, ev.key, wasFirst, (ch) =>
        /^[0-9]$/.test(ch),
      );
      if (r === "escape") return finish(null);
      if (r === "enter") {
        const n = st.buf.length > 0 ? Number.parseInt(st.buf, 10) : current;
        const clamped = Math.max(min, Math.min(max, Number.isFinite(n) ? n : current));
        return finish(clamped);
      }
      paint();
    };
    const onCompositionStart = (): void => {
      composing = true;
    };
    const onCompositionEnd = (): void => {
      composing = false;
    };
    inputEvents.addEventListener("keydown", onKey, true);
    inputEvents.addEventListener("compositionstart", onCompositionStart, true);
    inputEvents.addEventListener("compositionend", onCompositionEnd, true);
    paint();
  });
}

/** One selectable row in a menu. Disabled rows show dimmed and cannot be picked. */
export interface MenuItem extends Omit<MenuTransformRow, "id" | "semantic"> {
  /** Stable row identity for front-end transformers. Omitted only by legacy tests. */
  id?: string;
  /** What this row means, independent of its localized label or current layout. */
  semantic?: MenuSemantics;
  /**
   * An explicit tag letter (menu_action's own `.c` tag, e.g. option_actions[]'
   * stable a/b/d/h in ui-options.c), overriding the default positional a,b,c..
   * lettering. Matched case-insensitively (MN_CASELESS_TAGS, do_cmd_options'
   * own menu flag) so pressing either case of the tag selects the row; rows
   * without a tag keep the exact-case positional behaviour untouched.
   */
  tag?: string;
  /**
   * The object's inscription (`obj->note`, the upstream quark) for rows in the
   * get_item picker, so `@`-tags can quick-select this row (MN_INSCRIP_TAGS /
   * get_tag, ui-object.c:693-753). Only the item picker reads it; every other
   * menu leaves it unset and behaves exactly as before.
   */
  inscrip?: string | null;
  /**
   * One-line help for THIS row, shown on a reserved line above the footer
   * while the row is under the cursor (the game menu's action descriptions,
   * char-select's roster detail, birth's per-race/class notes). When any item
   * in the menu carries a hint, the hint line is reserved for all of them so
   * the list never jumps as the cursor moves.
   */
  hint?: string;
  /**
   * A right-hand annotation drawn at a fixed column in its OWN colour, after
   * the label. This is display_rune's second field (ui-knowledge.c:2124-2125:
   * `c_put_str(COLOUR_YELLOW, inscrip, row, 47)`) - the rune's autoinscription
   * beside its name. Rows without one paint exactly as before.
   */
  suffix?: { text: string; color: string; col: number };
}

/**
 * Optional extras for selectFromMenu, ported from upstream's menu browse_hook
 * (curse_menu_browser, view_ability_menu_browser): a per-cursor detail pane
 * drawn below the list, and (for the read-only ability browser) a "browse
 * only" mode where Enter/letter re-displays the current row instead of
 * closing the menu (upstream's MN_DBL_TAP with no EVT_SELECT action) so only
 * ESC exits.
 */
export interface SelectMenuOptions {
  /**
   * The terminal's faithful skin for a menu whose content still travels through
   * this selector. It receives already-transformed rows and resolves their
   * stable id; `selectFromMenu` remains responsible for mapping that id back to
   * the caller's original row. Used by the upstream-shaped command browser,
   * whose scrolling boxes are deliberately unlike the normal lettered menu.
   */
  terminalPicker?: (items: readonly MenuItem[]) => Promise<string | null>;
  /** browse_hook: lines shown below the list for the row under the cursor. */
  detail?: (index: number) => readonly ScreenLine[];
  /**
   * Enables the `@`-inscription quick-select (MN_INSCRIP_TAGS) on this menu, for
   * the object pickers upstream drives through get_item. The value is the
   * invoking command's own key (cmd_lookup_key_unktrl), matched by the `@xn`
   * form; set it only on menus whose rows carry MenuItem.inscrip. Leaving it
   * unset keeps digits meaning cursor navigation, as every other menu expects.
   */
  inscripCmdKey?: string | undefined;
  /** MN_DBL_TAP / read-only menu: Enter and letters never resolve; only ESC does. */
  browseOnly?: boolean;
  /**
   * MN_CASELESS_TAGS (ui-menu.h:192): match a typed tag letter without regard to
   * case. Only three upstream menus set it - the death menu (ui-death.c:397),
   * the option menus (ui-options.c:2074) and the spell menu (ui-spell.c:250) -
   * because most tables use both cases of a letter as DIFFERENT rows. Leave it
   * unset and the tag match is exact, as get_cursor_key's default is.
   */
  caselessTags?: boolean;
  /** Colour applied to the cursor row instead of its own MenuItem.color (upstream draws the highlighted row COLOUR_WHITE regardless of its normal colour, e.g. view_ability_display). */
  cursorColor?: string;
  /**
   * spell_menu_handler's '?' toggle (ui-spell.c L127-142): when set, `detail`
   * only renders while toggled on, and this key flips it (repainting in
   * place, no selection made). Omitted entirely, `detail` behaves as before
   * (always shown) - the curse-removal and ability-browser callers, which
   * predate this toggle, are unaffected since they never set it.
   */
  detailToggleKey?: string;
  /** Initial toggle state when `detailToggleKey` is set (default false, matching spell_menu_new's cast/study call sites; textui_book_browse passes true). */
  detailInitiallyShown?: boolean;
  /**
   * A one-line subtitle under the title (upstream birthmenu_data.hint: the
   * stage-wide "Race affects stats and skills..." line), rendered dim on the
   * row the plain menu leaves blank - no layout shift for callers without it.
   */
  subtitle?: string;
  /**
   * A command-key layer laid over the a-z selection letters, mirroring the
   * store menu's command keys (ui-store.c:1097-1120: p/g buy, s/d sell, l/x
   * examine). Checked BEFORE positional-letter selection and cursor nav, so a
   * command key takes precedence over the same letter's positional meaning
   * (upstream guarantees the command and selection key sets never intersect).
   * The handler receives the current cursor row; returning a number resolves
   * the menu with THAT row index (respecting disabled), returning null/void
   * consumes the key without resolving (the caller handled it, e.g. opened its
   * own sub-flow, or it was a no-op).
   */
  commands?: Record<string, (cursor: number) => number | null | void>;
  /**
   * Control-modified command keys, for death_screen's KTRL('X') / KTRL('N')
   * (ui-death.c:406-407). Upstream matches the control CODE against cmd_keys,
   * and KTRL('X') is 0x18 rather than 'x', so a control chord can never collide
   * with a row tag - which is why `commands` above is matched only when no
   * modifier is held. Keys are named unmodified and lower case ("x" for Ctrl-X).
   * A handler returning MENU_CLOSE closes the menu with that sentinel (the
   * caller acted and wants out), a row index resolves that row, null/void
   * consumes the chord.
   */
  ctrlCommands?: Record<string, (cursor: number) => number | null | void>;
  /** Footer legend override; wins over the positional `footer` parameter. */
  footer?: string;
  /**
   * do_cmd_options_birth key ('=', ui-birth.c:126): when set, pressing this key
   * closes the menu resolving with the MENU_OPTIONS sentinel so the caller can
   * open a sub-flow (e.g. the birth-options editor) and then re-show the menu.
   * The menu must close first - opening another modal while this menu's own
   * capturing keydown listener is still attached would double-capture keys.
   */
  optionsKey?: string;
  /** Start the cursor on this row (skipped if it is disabled/out of range). */
  initialCursor?: number;
  /** Called with the cursor row on open and after every cursor move. */
  onHighlight?: (index: number) => void;
  /**
   * Draw OVER what is already on screen instead of clearing it, in a
   * right-aligned box - upstream's item/spell picker (item_menu, ui-object.c
   * L1198-1215).
   *
   * Upstream never blanks the map to ask which book you meant. `area.col` is
   * `MIN(wid - 1 - max_len, prompt_size - 2)`, each row of the box is erased with
   * `prt("", row, area.col - 1)` - which clears from that column rightwards and
   * leaves the dungeon to its LEFT untouched - and `screen_save`/`screen_load`
   * put back whatever the box covered. The port cleared the whole terminal for
   * every picker, so casting a spell blanked the level.
   *
   * The legend moves onto the title row here, because upstream's box has no
   * footer: `header` on row 0 is the prompt AND the key legend, and the rows
   * below it are the list.
   */
  overlay?: boolean;
  /**
   * Rows of the LIST that must stay visible when a detail pane is competing for
   * the same screen (default 3).
   *
   * The pane is sized from its own content, and `bodyRows` was whatever was left
   * over with a floor of ONE. A mod whose description ran to thirty wrapped lines
   * therefore produced a menu showing its first action row and nothing else -
   * which is what Linoleum's manager screen looked like. The pane is the part
   * that can afford to be cut here: it says so, and the caller offers the full
   * text somewhere that scrolls.
   */
  minListRows?: number;
  /**
   * The live rogue_like_commands option (see keymap.ts / menuNav): when true,
   * j/k also move the cursor down/up, matching the reference's process_dir
   * remap for every menu, not just movement. Defaults false (the original
   * keyset), matching menuNav's own default.
   */
  roguelike?: boolean;
}

/**
 * A single-column lettered selection menu (the object/spell/command menus).
 * Rows are labelled a).. and picked by that letter; ESC returns null. Resolves
 * to the chosen index, or null if the user cancelled. Disabled rows are shown
 * but reject selection (e.g. a spell too high level, an item that cannot be
 * used). Falls back to arrow-key + Enter selection for touch/discoverability.
 *
 * `extra.detail`, when given, renders a description pane below the list for
 * the row under the cursor (the curse-removal and abilities screens use this
 * to show the curse/ability's long description, mirroring upstream's
 * browse_hook). `extra.browseOnly` turns the menu read-only (abilities): Enter
 * / letter-select just re-paints instead of resolving, so only ESC exits.
 *
 * This is the port of ui-menu.c's whole menu object for every non-item menu, so
 * menu_new (ui-menu.c:980) - the allocator for `struct menu` - has no
 * counterpart: a menu here is one call with its rows, not a long-lived struct
 * with a skin, an iterator and priv state. (Object selection keeps its own
 * shape in itemSelect below, upstream's item_menu.)
 */
/**
 * selectFromMenu resolves with this sentinel (instead of a row index or null)
 * when the caller set SelectMenuOptions.optionsKey and the user pressed it -
 * the do_cmd_options_birth '=' path. A negative value never collides with a
 * real 0..n-1 row index; callers that never set optionsKey never see it.
 */
export const MENU_OPTIONS = -2;

/**
 * A ctrlCommands handler returns this to close the menu without selecting a
 * row - death_screen's `break` on KTRL('X') (ui-death.c:406), where the caller
 * has already decided what happens next. Negative, so it never collides with a
 * real row index; callers that set no ctrlCommands never see it.
 */
export const MENU_CLOSE = -3;

/**
 * A `commands` handler returns this to close the menu asking the caller to
 * REBUILD and re-open it, rather than to act on a row.
 *
 * It exists for the mod manager's space-to-toggle: flipping a mod on changes its
 * row's label, its colour, its detail pane and whether an "Apply changes" row
 * belongs in the list at all, and none of those are things a menu holding a fixed
 * `items` array can repaint. The caller's loop already rebuilds every pass, so
 * the honest move is to let it. Paired with `initialCursor` and `onHighlight` the
 * round trip is invisible: the same row is under the cursor when it comes back,
 * which is the whole point (a toggle that threw the player back to the top of a
 * thirty-mod list is what this replaced).
 */
export const MENU_REFRESH = -4;

export function selectFromMenu(
  host: GridSurface & GridPointerInput,
  id: string,
  title: string,
  items: readonly MenuItem[],
  footer?: string,
  extra?: SelectMenuOptions,
): Promise<number | null>;
/** Compatibility for focused renderer tests; production callers declare an id. */
export function selectFromMenu(
  term: GridSurface & GridPointerInput,
  title: string,
  items: readonly MenuItem[],
  footer?: string,
  extra?: SelectMenuOptions,
): Promise<number | null>;
export function selectFromMenu(
  host: GridSurface & GridPointerInput,
  idOrTitle: string,
  titleOrItems: string | readonly MenuItem[],
  itemsOrFooter?: readonly MenuItem[] | string,
  footerOrExtra?: string | SelectMenuOptions,
  maybeExtra?: SelectMenuOptions,
): Promise<number | null> {
  const declared = typeof titleOrItems === "string";
  const id = declared ? idOrTitle : "test:legacy-menu";
  const title = declared ? titleOrItems : idOrTitle;
  const rawItems = (declared ? itemsOrFooter : titleOrItems) as readonly MenuItem[];
  const footer = (declared ? footerOrExtra : itemsOrFooter) as string | undefined;
  const extra = (declared ? maybeExtra : footerOrExtra) as SelectMenuOptions | undefined;
  const originalRows: readonly MenuTransformRow[] = rawItems.map((item, index) => ({
    ...item,
    id: item.id ?? `${id}:row:${index}`,
    semantic: item.semantic ?? { kind: "choice", ref: index },
  }));
  const items = (declared ? menuRegistry.transform(id, originalRows) : originalRows) as readonly MenuItem[];
  const originalIndex = new Map(originalRows.map((row, index) => [row.id, index]));
  const displayedFooter = footer ?? "[ a-z to choose, ESC to cancel ]";
  /* The terminal's own way of asking, unchanged, as a function - so a mod that
   * has taken the menus can decline THIS question and fall straight into it
   * (menu-runtime.ts). Everything below is exactly what used to follow a bare
   * `return new Promise(...)` here. */
  const askTerminal = (): Promise<number | null> => {
    const handle = pushRegion(screenRegionSpec(), host.size());
    return askTerminalOnTerminal(regionSurface(host, handle.cells)).finally(() => {
      popRegion(handle);
    });
  };
  const askTerminalOnTerminal = (term: GridSurface & GridPointerInput): Promise<number | null> => {
    if (extra?.terminalPicker) {
      return (async (): Promise<number | null> => {
        /* A transformer may add a row, but the faithful shell has no action for
         * it. Keep asking after that row is picked, as the normal picker does,
         * rather than resolving it to whichever source row shares its ordinal. */
        for (;;) {
          const pickedId = await extra.terminalPicker!(items);
          if (pickedId === null) return null;
          const source = originalIndex.get(pickedId);
          if (source !== undefined) return source;
        }
      })();
    }
    return new Promise<number | null>((resolve) => {
    let cursor = initialMenuCursor(items, extra?.initialCursor);
    let top = 0;
    // Painted geometry, kept for the tap handler (a tapped screen row maps
    // back to top + (row - listTop) using exactly what the last paint drew).
    let paintedBodyRows = 1;
    let listTop = BODY_TOP;
    const detail = extra?.detail;
    const toggleKey = extra?.detailToggleKey;
    const hasHints = items.some((it) => it.hint !== undefined);
    const boxed = extra?.overlay === true;
    let detailShown = toggleKey ? (extra?.detailInitiallyShown ?? false) : true;
    /* Where the overlay box starts, kept for the tap handler exactly as
     * paintedBodyRows/listTop are: a tap has to land on the row it looks like it
     * landed on, and in overlay mode the rows do not start at BODY_TOP. */
    let boxCol = 0;
    const paint = (): void => {
      const { cols, rows } = term.size();
      /* Upstream's header is the prompt AND the legend on one row (get_item builds
       * `header` from both), because the box it opens has no footer line. */
      const heading = boxed ? `${title} ${extra?.footer ?? displayedFooter}` : title;
      /* menu_layout gives a menu with a `header` its own row, and the list starts
       * below it (the spell menu's "Name Lv Mana Fail Info", ui-spell.c:250). Off
       * screen that is BODY_TOP's spare row; in a box it has to be counted. */
      const subtitleRow = extra?.subtitle ? 1 : 0;
      if (boxed) {
        /* max_len over the rows about to be drawn - the header included, since
         * it sits inside the box - then the same clamp upstream applies: right-
         * align to fit, but never push the box past the prompt's own end, and give
         * up on the offset entirely once it is down to a few columns. */
        const widest = items.reduce(
          (w, it) => Math.max(w, 3 + it.label.length),
          extra?.subtitle?.length ?? 0,
        );
        boxCol = Math.min(cols - 1 - widest, heading.length - 2);
        if (boxCol <= 3) boxCol = 0;
        term.eraseToEol(0, HEADER_ROW);
      } else {
        boxCol = 0;
        term.clear();
      }
      term.print(0, HEADER_ROW, heading.slice(0, cols - 1), TITLE);
      if (extra?.subtitle) {
        const at = boxed ? boxCol : 0;
        if (boxed) term.eraseToEol(Math.max(0, boxCol - 1), HEADER_ROW + 1);
        term.print(at, HEADER_ROW + 1, extra.subtitle.slice(0, cols - 1 - at), DIM);
      }
      const hintRows = hasHints ? 1 : 0;
      /* THE PANE IS WHAT GIVES WAY, not the list.
       *
       * bodyRows was "whatever the pane leaves, floor of one", so a long enough
       * detail pane left a menu one row tall. Reserve the list's rows first and
       * hand the pane the remainder; a pane that does not fit is cut with a line
       * saying so, because silently dropping its last lines loses the end - and
       * the end of a mod's pane is where the two permanent-once-on warnings are. */
      const listFloor = Math.min(items.length, Math.max(1, extra?.minListRows ?? 3));
      const paneRoom = Math.max(0, rows - BODY_TOP - 1 - hintRows - listFloor);
      const wanted = detail && detailShown ? detail(cursor) : [];
      const detailLines =
        wanted.length <= paneRoom
          ? wanted
          : paneRoom >= 1
            ? [...wanted.slice(0, paneRoom - 1), { text: "...  (more than fits here)", color: DIM }]
            : [];
      listTop = boxed ? HEADER_ROW + 1 + subtitleRow : BODY_TOP;
      /* In a box the list is `area.page_rows = m->count` (ui-object.c:1199) - as
       * tall as it needs to be and no taller, so the map keeps every row the
       * picker does not want. Off screen it fills what is left. */
      const bodyRows = boxed
        ? Math.max(1, Math.min(items.length, rows - listTop - detailLines.length - hintRows))
        : Math.max(1, rows - BODY_TOP - 1 - detailLines.length - hintRows);
      paintedBodyRows = bodyRows;
      /* display_scrolling (ui-menu.c:190-200). The port had only the two
       * cursor-chasing tests, and was missing both context rows AND the clamp:
       *
       *   *top = MIN(*top, n - rows_per_page);
       *   *top = MAX(*top, 0);
       *
       * Without that first line `top` only ever moves TOWARD the cursor, never
       * back, so when the visible height GROWS the list keeps the position a
       * shorter page left it at and paints blank rows below the last item.
       * Pressing '?' to hide the mod manager's description pane is exactly that
       * case: it hands twenty rows to a thirty-mod list that goes on showing
       * five. Upstream cannot reach the state because its region's page_rows is
       * fixed for the life of the menu; this one is recomputed every paint from the
       * detail pane's height, which is what made the missing clamp visible. */
      if (cursor <= top && top > 0) top = cursor - 1;
      if (cursor >= top + (bodyRows - 1)) top = cursor - (bodyRows - 1) + 1;
      top = Math.min(top, items.length - bodyRows);
      top = Math.max(top, 0);
      /* Port-only, and only for a geometry upstream's region never has: a detail
       * pane on a short terminal can squeeze bodyRows to 1 or 2, where the
       * context-distance lines above push `top` one PAST the cursor and the
       * selected row is off screen. This restores the invariant that arithmetic
       * assumes rather than changing what it does - at bodyRows >= 3 it is a
       * no-op. */
      if (cursor < top) top = cursor;
      else if (cursor >= top + bodyRows) top = cursor - bodyRows + 1;
      for (let r = 0; r < bodyRows; r++) {
        const i = top + r;
        const it = items[i];
        if (!it) break;
        const letter = it.tag ?? menuLetter(i);
        // display_menu_row (ui-menu.c:577-585): the tag is "%c) " - three
        // columns - and the WHOLE row (tag included) takes the cursor colour
        // when selected. There is no '>' marker in Angband; the selected row is
        // light blue and carries the terminal cursor (set after this loop).
        const prefix = letter ? `${letter}) ` : "   ";
        const color = it.disabled
          ? DIM
          : i === cursor
            ? (extra?.cursorColor ?? CURSOR)
            : it.color ?? FG;
        /* `prt("", row, area.col - 1)` (ui-object.c:1213): clear the box's own
         * columns and everything right of them, and nothing to the left. */
        if (boxed) term.eraseToEol(Math.max(0, boxCol - 1), listTop + r);
        term.print(boxCol, listTop + r, `${prefix}${it.label}`.slice(0, cols - 1 - boxCol), color);
        /* display_rune's second field: its own colour at its own column. */
        const sfx = it.suffix;
        if (sfx && sfx.text.length > 0 && sfx.col < cols - 1) {
          term.print(
            sfx.col,
            listTop + r,
            sfx.text.slice(0, cols - 1 - sfx.col),
            it.disabled ? DIM : sfx.color,
          );
        }
      }
      /* Port-only addition: upstream never scrolls a menu taller than the
       * screen (its region's page_rows is fixed for the menu's whole life), so
       * ui-menu.c has no cue for "there is more above/below" to port. Off
       * screen a detail pane can squeeze the list to a handful of rows at any
       * time, and nothing said so - arrowing down through the mod manager's
       * "Recommended mods" list past the edge of what fit gave no sign there
       * was anything left to find. The row content itself is untouched (the
       * scrolling arithmetic above already gets `top` and `bodyRows` right);
       * this only marks the one column every row already leaves empty - a
       * label is sliced to `cols - 1 - boxCol` and a suffix to `cols - 1 -
       * sfx.col`, so column `cols - 1` never carries real content. */
      const marginCol = cols - 1;
      if (marginCol > boxCol && bodyRows > 0) {
        if (top > 0) term.print(marginCol, listTop, "^", DIM);
        if (top + bodyRows < items.length) term.print(marginCol, listTop + bodyRows - 1, "v", DIM);
      }
      // Term_gotoxy on the selected row (display_scrolling, ui-menu.c:212-213):
      // the yellow frame the Windows front end draws for the cursor.
      if (cursor >= top && cursor < top + bodyRows) {
        term.setCursor?.(boxCol, listTop + (cursor - top));
      }
      let dy = listTop + bodyRows;
      for (const line of detailLines) {
        if (dy >= rows - (boxed ? 0 : 1) - hintRows) break;
        if (boxed) term.eraseToEol(Math.max(0, boxCol - 1), dy);
        if (line.runs) {
          let x = boxCol;
          for (const run of line.runs) {
            if (x >= cols - 1) break;
            const chunk = run.text.slice(0, cols - 1 - x);
            term.print(x, dy, chunk, run.color);
            x += chunk.length;
          }
        } else {
          term.print(boxCol, dy, line.text.slice(0, cols - 1 - boxCol), line.color ?? FG);
        }
        dy++;
      }
      if (hasHints) {
        const hint = items[cursor]?.hint ?? "";
        if (boxed) term.eraseToEol(0, rows - 2);
        if (hint) term.print(0, rows - 2, hint.slice(0, cols - 1), DIM);
      }
      /* No footer row in overlay mode: the legend is already on the title row,
       * and a bar across the bottom of the map is the thing this avoids. */
      if (!boxed) term.print(0, rows - 1, (extra?.footer ?? displayedFooter).slice(0, cols - 1), DIM);
    };
    const finish = (value: number | null): void => {
      inputEvents.removeEventListener("keydown", onKey, true);
      setActiveCellTap(term, null);
      resolve(value);
    };
    const setCursor = (i: number): void => {
      if (i === cursor) return;
      cursor = i;
      extra?.onHighlight?.(cursor);
    };
    const pick = (i: number): void => {
      const it = items[i];
      if (!it || it.disabled) return;
      if (extra?.browseOnly) {
        setCursor(i);
        paint();
        return;
      }
      /* A tag letter, a jump key or a tap can select a row the cursor never
       * navigated onto - setCursor is never called for those, so onHighlight
       * never learns the row that is actually about to be picked. Report it
       * here too, same early-out as setCursor (skip if nothing would change),
       * so a caller reopening this same menu with the reported cursor lands on
       * the row just picked - not wherever the last NAVIGATION, as opposed to
       * selection, happened to leave it. */
      if (i !== cursor) {
        cursor = i;
        extra?.onHighlight?.(cursor);
      }
      /* A transformer may reorder rows. Callers intentionally still receive an
       * index into their own source list, so map the chosen stable row id back
       * rather than treating its visual position as an action. A genuinely new
       * row has no faithful-shell action yet; it remains visible for a replacing
       * front end but cannot accidentally invoke whichever core action happened
       * to occupy the same ordinal slot. */
      const source = originalIndex.get(it.id ?? "");
      if (source === undefined) return;
      finish(source);
    };
    const commands = extra?.commands;
    /**
     * One row along, skipping unselectable rows - and WRAPPING at both ends when
     * asked, which is what upstream does.
     *
     * menu_handle_keypress (ui-menu.c) lets scroll_process_direction step the
     * cursor off the end and then fixes it up:
     *
     *   while (!is_valid_row(menu, menu->cursor)) {
     *     if (menu->cursor > count - 1)  menu->cursor = 0;
     *     else if (menu->cursor < 0)     menu->cursor = count - 1;
     *     else                           menu->cursor += ddy[dir];
     *   }
     *
     * `is_valid_row` returns false for an out-of-range cursor, so the same loop
     * that steps over a disabled row is what makes down-at-the-bottom land on the
     * first row and up-at-the-top land on the last. The port stopped dead at both
     * ends, which on a list taller than the screen means the only way back to the
     * top is to hold a key down.
     *
     * Page movement does NOT wrap: it is a port addition (the scroll skin has no
     * page direction) and a page that wraps turns "show me the rest" into an
     * endless cycle.
     */
    const step = (from: number, dir: 1 | -1, wrap: boolean): number => {
      const n = items.length;
      let i = from;
      for (let tried = 0; tried < n; tried++) {
        i += dir;
        if (i >= n) {
          if (!wrap) return from;
          i = 0;
        } else if (i < 0) {
          if (!wrap) return from;
          i = n - 1;
        }
        if (!items[i]?.disabled) return i;
      }
      return from;
    };
    const moveUp = (): void => setCursor(step(cursor, -1, true));
    const moveDown = (): void => setCursor(step(cursor, 1, true));
    const pageBy = (dir: 1 | -1): void => {
      let i = cursor;
      for (let r = 0; r < paintedBodyRows; r++) {
        const next = step(i, dir, false);
        if (next === i) break;
        i = next;
      }
      setCursor(i);
    };
    const toHome = (): void => {
      for (let i = 0; i < items.length; i++) if (!items[i]?.disabled) { setCursor(i); return; }
    };
    const toEnd = (): void => {
      for (let i = items.length - 1; i >= 0; i--) if (!items[i]?.disabled) { setCursor(i); return; }
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (ev.key === "Escape") {
        finish(null);
        return;
      }
      // do_cmd_options_birth ('=', ui-birth.c:126): close the menu with the
      // MENU_OPTIONS sentinel so the caller opens the birth-options editor and
      // re-shows this same menu (a nested modal here would double-capture keys).
      if (extra?.optionsKey && ev.key === extra.optionsKey) {
        finish(MENU_OPTIONS);
        return;
      }
      if (toggleKey && ev.key === toggleKey) {
        detailShown = !detailShown;
        paint();
        return;
      }
      if (ev.key === "Enter") {
        pick(cursor);
        return;
      }
      // Command-key layer (store buy/sell/examine, ui-store.c:1097-1120) sits
      // above positional selection AND cursor nav, so a command letter beats
      // both meanings (upstream keeps the two key sets disjoint). Named keys
      // ("Delete", "Backspace") are matched too, so a screen can offer an action
      // that does not consume one of the a-z selection letters.
      // Control chords first: upstream compares the control CODE, so KTRL('X')
      // is 0x18 and never matches the 'x' in cmd_keys or a row tag
      // (ui-death.c:406-407 alongside the 'x' Examine row). The plain layer
      // below is therefore matched only when NO modifier is held, or Ctrl-X
      // would fire the Examine row on its way past.
      const ctrlCommands = extra?.ctrlCommands;
      if (ctrlCommands && ev.ctrlKey && !ev.altKey && !ev.metaKey && ev.key.length === 1) {
        const chord = ctrlCommands[ev.key.toLowerCase()];
        if (chord) {
          const res = chord(cursor);
          if (res === MENU_CLOSE) finish(MENU_CLOSE);
          else if (typeof res === "number") pick(res);
          return;
        }
      }
      if (commands && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        const cmd =
          ev.key.length === 1
            ? commands[ev.key] ?? commands[ev.key.toLowerCase()]
            : commands[ev.key];
        if (cmd) {
          const res = cmd(cursor);
          /* Checked BEFORE the `typeof res === "number"` branch, because the
           * sentinel is a number and pick() would silently treat it as a row
           * index that does not exist - a no-op the caller could not tell from a
           * key that never arrived. */
          if (res === MENU_REFRESH) finish(MENU_REFRESH);
          else if (typeof res === "number") pick(res);
          return;
        }
      }
      // `@`-inscription quick-select, for the object pickers that opt in via
      // inscripCmdKey. get_cursor_key (ui-menu.c:488-490) resolves the digit
      // before any tag match, and it must also come before menuNav below, which
      // would otherwise swallow the digit as a cursor move.
      if (extra?.inscripCmdKey !== undefined && ev.key >= "0" && ev.key <= "9") {
        const row = inscripTagRow(items, ev.key, extra.inscripCmdKey);
        if (row >= 0) {
          pick(row);
          return;
        }
      }
      if (ev.key.length === 1) {
        // get_cursor_key (ui-menu.c:480): an explicit per-item tag (see
        // MenuItem.tag) is matched before nav, so a tag letter/digit is honoured
        // rather than swallowed as a cursor move. The match is EXACT unless the
        // menu sets MN_CASELESS_TAGS (L485-509), which only three upstream menus
        // do - death, options and spell. It has to be exact by default because
        // several tables deliberately use both cases of a letter: the debug
        // command menu's Items rows are 'c' Create an object and 'C' Create an
        // artifact (ui-game.c:247-248), and a caseless match made every
        // upper-case row in that menu unreachable.
        const lower = ev.key.toLowerCase();
        const exact = items.findIndex((it) => it.tag === ev.key);
        const tagIdx =
          exact >= 0
            ? exact
            : extra?.caselessTags
              ? items.findIndex((it) => it.tag && it.tag.toLowerCase() === lower)
              : -1;
        if (tagIdx >= 0) {
          pick(tagIdx);
          return;
        }
      }
      // Cursor navigation: arrows AND numpad digits (menuNav), so the numpad
      // drives menus regardless of NumLock (the "controls dead in menus" bug).
      // j/k also drive it under the roguelike keyset (extra.roguelike).
      const nav = menuNav(ev, extra?.roguelike ?? false);
      if (nav) {
        if (nav === "up") moveUp();
        else if (nav === "down") moveDown();
        else if (nav === "pageup") pageBy(-1);
        else if (nav === "pagedown") pageBy(1);
        else if (nav === "home") toHome();
        else if (nav === "end") toEnd();
        paint();
        return;
      }
      if (ev.key.length === 1) {
        const idx = LETTERS.indexOf(ev.key);
        if (idx >= 0 && idx < items.length) pick(idx);
      }
    };
    inputEvents.addEventListener("keydown", onKey, true);
    // Tap-to-select (MN_DBL_TAP): the first tap on a row highlights it, a tap
    // on the already-highlighted row selects it; a tap on the footer row
    // cancels, exactly like ESC. Registered per-modal and torn down in finish
    // so it never leaks into the game underneath or a sibling modal.
    setActiveCellTap(term, (cell) => {
      const { rows } = term.size();
      /* Only where there IS a footer. In overlay mode the bottom row is the map,
       * and cancelling the picker because a finger landed on the dungeon floor
       * is a tap doing the opposite of what it looks like. */
      if (!boxed && cell.row === rows - 1) {
        finish(null);
        return;
      }
      const r = cell.row - listTop;
      if (r < 0 || r >= paintedBodyRows) return;
      const i = top + r;
      const it = items[i];
      if (!it || it.disabled) return;
      if (i === cursor) {
        pick(i);
        return;
      }
      setCursor(i);
      paint();
    });
    extra?.onHighlight?.(cursor);
    paint();
    });
  };

  if (currentMenuPresenter() === null) return askTerminal();
  return askThroughPresenter({
    question: buildMenuQuestion({
      id,
      title,
      ...(extra?.subtitle === undefined ? {} : { subtitle: extra.subtitle }),
      footer: extra?.footer ?? displayedFooter,
      rows: items,
      style: extra?.overlay === true ? "overlay" : "screen",
      cursor: initialMenuCursor(items, extra?.initialCursor),
      browseOnly: extra?.browseOnly === true,
      commandKeys: Object.keys(extra?.commands ?? {}),
      ctrlCommandKeys: Object.keys(extra?.ctrlCommands ?? {}),
      ...(extra?.optionsKey === undefined ? {} : { optionsKey: extra.optionsKey }),
      ...(extra?.detail === undefined ? {} : { detail: extra.detail }),
    }),
    items,
    originalIndex,
    extra,
    askTerminal,
  });
}

/**
 * Where the cursor starts: the caller's `initialCursor` if it names a row that
 * can be chosen, otherwise the first row that can.
 *
 * Shared between the terminal's own paint loop and the question handed to a
 * presenter, because those two disagreeing would put a reimagined menu's
 * highlight on a different row from the one the game thinks is selected - and
 * only on the menus where the first row is disabled, which is the worst kind of
 * bug to go looking for.
 */
function initialMenuCursor(
  items: readonly MenuItem[],
  wanted: number | undefined,
): number {
  if (wanted !== undefined && wanted >= 0 && wanted < items.length && !items[wanted]?.disabled) {
    return wanted;
  }
  const first = items.findIndex((it) => !it.disabled);
  return first < 0 ? 0 : first;
}

/**
 * Ask one question through the installed presenter, and translate its answer
 * into what `selectFromMenu`'s callers already understand.
 *
 * THE COMMAND LOOP IS THE INTERESTING PART. A presenter answering `command` is
 * doing what a player pressing that key does: the caller's own handler runs, and
 * unless it resolved the menu the question is asked AGAIN. That is why the store
 * can be reimagined without the presenter knowing what buying does. The handlers
 * and their sentinels are the caller's, unchanged - `menu-answer.test.ts` drives
 * the same command through this path and through the keydown path and asserts
 * the two agree, because a second copy of that rule drifting is exactly the bug
 * this shape invites.
 *
 * ANYTHING THE PRESENTER GETS WRONG COSTS IT THIS MENU AND NOTHING ELSE: a
 * choice id that does not exist, a choice on a browse-only question, a command
 * key the caller never offered. It is reported and the game asks the question
 * itself. A presenter that THREW is out for the session, which is
 * `askInstalledPresenter`'s business rather than this one's.
 */
async function askThroughPresenter(deps: {
  question: MenuQuestion;
  items: readonly MenuItem[];
  originalIndex: ReadonlyMap<string, number>;
  extra: SelectMenuOptions | undefined;
  askTerminal: () => Promise<number | null>;
}): Promise<number | null> {
  const { question, items, originalIndex, extra, askTerminal } = deps;
  const owner = currentMenuPresenter();
  if (!owner) return askTerminal();
  const refuse = (why: string): Promise<number | null> => {
    refuseMenuAnswer(owner.id, question, why, reportUiFault);
    return askTerminal();
  };
  /* Bounded only by the presenter answering `command` forever, which is the same
   * thing a player holding a command key down does. Every other answer leaves. */
  for (;;) {
    const answer = await askInstalledPresenter(question, reportUiFault);
    if (answer === undefined) return askTerminal();
    if (answer.kind === "cancel") return null;
    if (answer.kind === "options") {
      if (extra?.optionsKey === undefined) return refuse("an options answer for a menu that has no options key");
      return MENU_OPTIONS;
    }
    if (answer.kind === "choose") {
      if (question.browseOnly) return refuse("a choice for a browse-only menu");
      const row = items.find((it) => it.id === answer.choice);
      if (!row) return refuse(`the unknown choice "${answer.choice}"`);
      if (row.disabled) return refuse(`the disabled choice "${answer.choice}"`);
      const source = originalIndex.get(row.id ?? "");
      /* A row a transformer INVENTED has no caller-side action behind it. The
       * terminal path silently ignores a pick on one for the same reason; here
       * it is said out loud, because a presenter cannot see why nothing
       * happened. */
      if (source === undefined) return refuse(`"${answer.choice}", which no game action stands behind`);
      return source;
    }
    const resolved = runMenuCommand(answer, deps);
    if (resolved !== CONTINUE) return resolved === REFUSED ? refuse(`the unoffered command key "${answer.key}"`) : resolved;
  }
}

/** `runMenuCommand` ran the handler and the question should be asked again. */
const CONTINUE = Symbol("menu:continue");
/** The command key was never offered by this menu. */
const REFUSED = Symbol("menu:refused");

/**
 * Run one command answer exactly as the keydown path runs that key.
 *
 * The sentinel order matters and is upstream's own: MENU_REFRESH and MENU_CLOSE
 * are checked BEFORE the "it returned a row index" branch, because they ARE
 * numbers and treating one as a row index is a silent no-op the caller cannot
 * tell from a key that never arrived.
 */
function runMenuCommand(
  answer: Extract<MenuAnswer, { kind: "command" }>,
  deps: {
    question: MenuQuestion;
    items: readonly MenuItem[];
    originalIndex: ReadonlyMap<string, number>;
    extra: SelectMenuOptions | undefined;
  },
): number | null | typeof CONTINUE | typeof REFUSED {
  const { question, items, originalIndex, extra } = deps;
  /* The birth screen's '=' is offered to a presenter as a command, because from
   * its side it is one - a key that does something other than choose - even
   * though the host answers it with its own sentinel rather than a handler. */
  if (extra?.optionsKey !== undefined && answer.key === extra.optionsKey && answer.ctrl !== true) {
    return MENU_OPTIONS;
  }
  const handler = answer.ctrl === true
    ? extra?.ctrlCommands?.[answer.key.toLowerCase()]
    : extra?.commands?.[answer.key] ?? extra?.commands?.[answer.key.toLowerCase()];
  if (!handler) return REFUSED;
  const cursor = Math.min(Math.max(answer.cursor, 0), Math.max(0, items.length - 1));
  const result = handler(cursor);
  if (result === MENU_REFRESH || result === MENU_CLOSE) return result;
  if (typeof result !== "number") return CONTINUE;
  /* `pick` semantics: a handler naming a row resolves the menu with it, unless
   * the row cannot be chosen - in which case the keydown path does nothing and
   * the menu stays up, so this asks again rather than resolving with null. */
  const row = items[result];
  if (!row || row.disabled || question.browseOnly) return CONTINUE;
  const source = originalIndex.get(row.id ?? "");
  return source === undefined ? CONTINUE : source;
}

/** How a presenter's misbehaviour reaches the player: the shell's own reporter. */
let reportUiFault: (id: string, message: string, error: unknown) => void = () => {};

/**
 * Give the menus and the screens a way to report a mod, once the shell has one.
 *
 * ONE reporter for both, because there is one thing being reported: a mod that
 * took part of the interface and misbehaved with it. A second injection point
 * would be a second thing to forget to wire, and a seam that reaches no player is
 * the same as one that was never noticed.
 *
 * `overlay.ts` is imported by tests that boot no game and by the shell that
 * does, so the reporter is injected rather than imported - the alternative is
 * this module reaching into main.ts, which is the dependency that would make
 * every overlay test boot a canvas.
 */
export function setUiFaultReporter(
  report: (id: string, message: string, error: unknown) => void,
): void {
  reportUiFault = report;
}

/**
 * The one way a screen presenter's fault reaches the player.
 *
 * Exported because `showCharacterSheet` offers its own view to the presenter
 * rather than going through `showTextScreen` - the sheet is a modal with its own
 * keys - and a second reporter beside this one is a second policy about mods.
 */
export const screenFault = (id: string, message: string, error: unknown): void =>
  reportUiFault(id, message, error);


/** One source (command_wrk) of the get_item picker: its upstream label
 * ("Inven" | "Equip" | "Quiver" | "Floor") and the lettered rows it offers
 * (tags already assigned - a-z via all_letters_nohjkl, or 0-9 for the quiver). */
export interface ItemMenuSource {
  label: string;
  items: readonly MenuItem[];
  /**
   * Which gear list this tab is, so a caller can ask to OPEN on it
   * (upkeep->command_wrk) without depending on the display label or on the
   * order buildItemSources happens to emit enabled sources in.
   */
  kind?: "inven" | "equip" | "quiver" | "floor";
}

/** The effective selection tag for row `i` of a source (its explicit tag, or
 * the positional all-letters letter as a fallback). */
function sourceTag(src: ItemMenuSource, i: number): string {
  return src.items[i]?.tag ?? menuLetter(i);
}

/**
 * get_tag (ui-object.c:693-753): the row in `items` that the `@`-inscription
 * tag `digit` selects, or -1 for none. Scans the rows in list order and, within
 * each row's inscription, every '@' in turn; an '@' matches when the character
 * after it IS the digit (`@1`), or when it is `cmdKey` and the one after THAT is
 * the digit (`@q1` - the "@xn" form, where x is the command the tag is for, so
 * one object can carry a different slot per command). First row wins.
 *
 * `cmdKey` is the command's own keypress (cmd_lookup_key_unktrl, ui-game.c:461),
 * which differs between the two keysets - so the same `@z1` picks a different
 * command under rogue_like_commands, exactly as upstream.
 */
export function inscripTagRow(
  items: readonly MenuItem[],
  digit: string,
  cmdKey?: string,
): number {
  for (let i = 0; i < items.length; i++) {
    const note = items[i]?.inscrip;
    if (!note) continue;
    // strchr(quark_str(obj->note), '@'), then strchr(s + 1, '@') (L720, L747).
    for (let at = note.indexOf("@"); at >= 0; at = note.indexOf("@", at + 1)) {
      if (note[at + 1] === digit) return i;
      if (cmdKey && note[at + 1] === cmdKey && note[at + 2] === digit) return i;
    }
  }
  return -1;
}

/**
 * Build the get_item header (menu_header, ui-object.c L764-914): the current
 * source's "Label: a-c," range, then the legality legends for the OTHER
 * sources in upstream order (Equip/Inven via '/', Quiver via '|', floor via
 * '-'), then " ESC", all wrapped in "(...)".
 */
function itemMenuHeader(
  sources: readonly ItemMenuSource[],
  cur: number,
): string {
  const src = sources[cur];
  if (!src) return "()";
  const nonEmpty = (label: string): boolean =>
    sources.some((s, i) => i !== cur && s.label === label && s.items.length > 0);
  let out = `${src.label}:`;
  if (src.items.length > 0) {
    out += ` ${sourceTag(src, 0)}-${sourceTag(src, src.items.length - 1)},`;
  }
  // The "/" legend names the other main carry source (Inven <-> Equip).
  if (src.label === "Inven" && nonEmpty("Equip")) out += " / for Equip,";
  else if (src.label !== "Inven" && nonEmpty("Inven")) out += " / for Inven,";
  else if (src.label !== "Equip" && nonEmpty("Equip")) out += " / for Equip,";
  if (src.label !== "Quiver" && nonEmpty("Quiver")) out += " | for Quiver,";
  if (src.label !== "Floor" && nonEmpty("Floor")) out += " - for floor,";
  out += " ESC";
  return `(${out})`;
}

/**
 * The faithful get_item selection menu (textui_get_item / item_menu,
 * ui-object.c L1142-1315): draws the prompt and the "(Inven: a-c, / for Equip,
 * - for floor, ESC)" header (menu_header), the current source's lettered list,
 * and switches sources with '/', '|' and '-' (m->switch_keys "/|-", L1158).
 * Select by tag letter/digit, cursor + Enter, or tap; ESC cancels. Resolves the
 * chosen { source, index } as indices into the ORIGINAL `sources` array (so the
 * caller maps back to the right handle / floor ref), or null on ESC / empty.
 *
 * `cmdKey` is the invoking command's own key, enabling the `@`-inscription
 * quick-select (MN_INSCRIP_TAGS, item_menu L1160-1177): see inscripTagRow. It is
 * resolved against the CURRENTLY displayed source, which is where upstream reads
 * it too - item_menu rebuilds m->inscriptions from the current command_wrk list
 * on every re-entry and frees it on the way out (L1164, L1221), so a tag never
 * carries across a source switch.
 */
export function itemSelect(
  host: GridSurface & GridPointerInput,
  prompt: string,
  sources: readonly ItemMenuSource[],
  initialSource = 0,
  cmdKey?: string,
  /**
   * bell(): sounded when a tab-switch key is refused because the target source
   * holds nothing this command accepts (ui-object.c:975). Injected because this
   * module has no GameState to reach state.sound through. Omitted = silent, which
   * is what made a faithful refusal read as a dead key.
   */
  bell?: () => void,
  /** The live rogue_like_commands option; see menuNav. Defaults false. */
  roguelike = false,
): Promise<{ source: number; index: number } | null> {
  const handle = pushRegion(screenRegionSpec(), host.size());
  const term = regionSurface(host, handle.cells);
  return new Promise<{ source: number; index: number } | null>((resolve) => {
    const firstNonEmpty = (): number => sources.findIndex((s) => s.items.length > 0);
    let cur =
      sources[initialSource]?.items.length ? initialSource : firstNonEmpty();
    if (cur < 0) {
      resolve(null);
      return;
    }
    let cursor = 0;
    let top = 0;
    let paintedBodyRows = 1;
    const listTop = 1; // area.row = 1 (item_menu L1201).

    const src = (): ItemMenuSource => sources[cur]!;

    const paint = (): void => {
      const { cols, rows } = term.size();
      term.clear();
      // Prompt then header on the top line (show_prompt + menu header).
      const head = itemMenuHeader(sources, cur);
      term.print(0, HEADER_ROW, prompt.slice(0, cols - 1), TITLE);
      const hx = Math.min(prompt.length + 1, cols - 1);
      term.print(hx, HEADER_ROW, head.slice(0, cols - 1 - hx), DIM);
      const rowsList = src().items;
      const bodyRows = Math.max(1, rows - listTop - 1);
      paintedBodyRows = bodyRows;
      if (cursor < top) top = cursor;
      if (cursor >= top + bodyRows) top = cursor - bodyRows + 1;
      for (let r = 0; r < bodyRows; r++) {
        const i = top + r;
        const it = rowsList[i];
        if (!it) break;
        const tag = sourceTag(src(), i);
        const color = it.disabled ? DIM : i === cursor ? CURSOR : it.color ?? FG;
        term.print(0, listTop + r, `${tag}) ${it.label}`.slice(0, cols - 1), color);
      }
      if (cursor >= top && cursor < top + bodyRows) {
        term.setCursor?.(0, listTop + (cursor - top));
      }
      term.print(
        0,
        rows - 1,
        "[ a-z/0-9 to choose, / | - to switch, ESC to cancel ]".slice(0, cols - 1),
        DIM,
      );
    };

    const finish = (value: { source: number; index: number } | null): void => {
      inputEvents.removeEventListener("keydown", onKey, true);
      setActiveCellTap(term, null);
      resolve(value);
    };
    const pick = (i: number): void => {
      const it = src().items[i];
      if (!it || it.disabled) return;
      finish({ source: cur, index: i });
    };
    const switchTo = (label: string): void => {
      const next = sources.findIndex((s) => s.label === label && s.items.length > 0);
      if (next < 0 || next === cur) {
        /* bell() (ui-object.c:975, :981-982, :992-993). Upstream ANSWERS a refused
         * switch; this returned silently, and a silent refusal is indistinguishable
         * from a dead key - which is exactly how a faithful refusal came to be
         * reported as "'/' does not switch inventory". It is legitimately refused
         * whenever the other source holds nothing the command will accept: at an
         * Alchemist, get_item drops USE_EQUIP entirely (ui-object.c:1411-1414),
         * menu_header omits the "/ for Equip" legend, and '/' bells. */
        bell?.();
        return;
      }
      cur = next;
      cursor = 0;
      top = 0;
      paint();
    };
    // The switch key logic mirrors menu_header's legends: '/' toggles the main
    // carry sources, '|' jumps to the quiver, '-' to the floor.
    const doSwitchSlash = (): void => {
      if (src().label === "Inven") switchTo("Equip");
      else if (sources.some((s, i) => i !== cur && s.label === "Inven" && s.items.length > 0))
        switchTo("Inven");
      else switchTo("Equip");
    };

    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (ev.key === "Escape") {
        finish(null);
        return;
      }
      if (ev.key === "/") {
        doSwitchSlash();
        return;
      }
      if (ev.key === "|") {
        switchTo("Quiver");
        return;
      }
      if (ev.key === "-") {
        switchTo("Floor");
        return;
      }
      if (ev.key === "Enter") {
        pick(cursor);
        return;
      }
      if (ev.key.length === 1) {
        // `@`-inscription quick-select. get_cursor_key (ui-menu.c:488-490) does
        // this substitution BEFORE any tag match, so an inscribed digit beats a
        // literal digit tag (the quiver's own 0-9 lettering).
        if (ev.key >= "0" && ev.key <= "9") {
          const row = inscripTagRow(src().items, ev.key, cmdKey);
          if (row >= 0) {
            pick(row);
            return;
          }
        }
        // Tag letter/digit select (MN_PVT_TAGS), case-insensitive.
        const lower = ev.key.toLowerCase();
        const rowsList = src().items;
        for (let i = 0; i < rowsList.length; i++) {
          if (sourceTag(src(), i).toLowerCase() === lower) {
            pick(i);
            return;
          }
        }
      }
      const nav = menuNav(ev, roguelike);
      if (nav) {
        const n = src().items.length;
        if (n > 0) {
          if (nav === "up") cursor = (cursor + n - 1) % n;
          else if (nav === "down") cursor = (cursor + 1) % n;
          else if (nav === "pageup") cursor = Math.max(0, cursor - paintedBodyRows);
          else if (nav === "pagedown") cursor = Math.min(n - 1, cursor + paintedBodyRows);
          else if (nav === "home") cursor = 0;
          else if (nav === "end") cursor = n - 1;
        }
        paint();
      }
    };
    inputEvents.addEventListener("keydown", onKey, true);
    setActiveCellTap(term, (cell) => {
      const { rows } = term.size();
      if (cell.row === rows - 1) {
        finish(null);
        return;
      }
      const r = cell.row - listTop;
      if (r < 0 || r >= paintedBodyRows) return;
      const i = top + r;
      const it = src().items[i];
      if (!it || it.disabled) return;
      if (i === cursor) {
        pick(i);
        return;
      }
      cursor = i;
      paint();
    });
    paint();
  }).finally(() => {
    popRegion(handle);
  });
}
