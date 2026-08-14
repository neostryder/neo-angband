/**
 * The public, renderer-neutral data a replacement front end consumes.
 *
 * This module contains types only. A folder plugin may `import type` from the
 * SDK while its built JavaScript continues to have no bare engine import.
 */

export interface WorldGrid {
  readonly x: number;
  readonly y: number;
}

export type WorldVisibility = "seen" | "remembered" | "unknown";
export type WorldLayerKind = "terrain" | "trap" | "object" | "monster" | "player" | "path";

export interface WorldRenderAssetRef {
  readonly kind: string;
  readonly key?: string;
  readonly data: unknown;
}

export interface WorldVisual {
  readonly ch: string;
  readonly fg: string;
  readonly bg?: string;
  readonly asset?: WorldRenderAssetRef;
  readonly backgroundAsset?: WorldRenderAssetRef;
}

export interface WorldLayer {
  readonly kind: WorldLayerKind;
  readonly id?: number;
  readonly lighting?: number;
}

export interface WorldCell {
  readonly grid: WorldGrid;
  readonly screen: WorldGrid;
  readonly visibility: WorldVisibility;
  readonly terrain?: WorldLayer;
  readonly overlays: readonly WorldLayer[];
  readonly visual?: WorldVisual;
  readonly cursor: boolean;
}

export interface WorldPlayer {
  readonly grid: WorldGrid;
  readonly screen: WorldGrid;
  readonly layer: WorldLayer;
  readonly visual: WorldVisual;
  readonly cursor: boolean;
}

/** A rectangle of the game's character grid, in cells. */
export interface RegionCells {
  readonly col: number;
  readonly row: number;
  readonly cols: number;
  readonly rows: number;
}

/**
 * The same rectangle in CSS pixels, in the game window's coordinate space -
 * the space `getBoundingClientRect()` answers in and `position: fixed`
 * positions in. Put your canvas here and the rest of the game stays readable.
 */
export interface RegionPixels {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The parts of the screen that have a name. */
export type ScreenRegionName = "messages" | "sidebar" | "map" | "status";

export interface ScreenRegion {
  readonly name: ScreenRegionName;
  readonly cells: RegionCells;
  /** Absent when the host has no pixel projection - a headless harness, a test. */
  readonly pixels?: RegionPixels;
}

/**
 * Where the game is drawing, by name.
 *
 * `map` is YOURS while you hold the display: core has stopped drawing it. The
 * others are core's, still being drawn, and they are published so a front end
 * can stay off them - or deliberately cover them, knowing what it is covering.
 *
 * A name is absent when this layout has no such region: `sidebar` is undefined
 * when the player has turned the vitals furniture off ('=' -> (o) -> None).
 * The names are ROLES rather than places, so `sidebar` is the 13-column left
 * column in one layout and a one-line header under the messages in another.
 */
export interface ScreenRegions {
  readonly map: ScreenRegion;
  readonly messages?: ScreenRegion;
  readonly sidebar?: ScreenRegion;
  readonly status?: ScreenRegion;
}

/**
 * Which band a region sits in, bottom to top. Within a band the later-declared
 * region is on top, and for a mod that means load order.
 *
 * `system` is reserved to the game, so that whatever the player uses to REGAIN
 * CONTROL - the mod manager, a fault report - can always be drawn above a mod,
 * including above the mod that has gone wrong. Ask for `overlay` or `modal`.
 */
export type RegionLayer = "base" | "overlay" | "modal" | "system";

/**
 * One region as it exists on screen right now.
 *
 * `id` is a plain string, not a `ScreenRegionName`: a screen or a mod names
 * itself. The four base regions carry their own names as ids, so the one
 * question a front end actually asks - "is anything covering `map`?" - is asked
 * with the name it already knows.
 */
export interface LiveRegion {
  readonly id: string;
  readonly layer: RegionLayer;
  readonly cells: RegionCells;
  /** Absent for the same reason `ScreenRegion.pixels` is: no projection to give. */
  readonly pixels?: RegionPixels;
}

/**
 * The bands a MOD may declare a region in.
 *
 * `system` is not one of them, and the exclusion is TYPED rather than checked at
 * runtime only, so an author asking for the top band is told by the compiler
 * rather than by a fault report after the game shipped. See `RegionLayer` for
 * what `system` is reserved for: whatever the player uses to REGAIN CONTROL has
 * to be drawable above the mod that has gone wrong, including above a mod that
 * has covered everything else.
 */
export type ModRegionLayer = Exclude<RegionLayer, "system">;

/**
 * The character grid, clipped to your region's rectangle.
 *
 * COORDINATES ARE REGION-LOCAL. `size()` answers YOUR size, `(0, 0)` is your
 * top-left, and a write outside your rectangle is DROPPED rather than clamped -
 * so an off-by-one loses your own character where you are looking, instead of
 * corrupting a neighbour's cell that neither of you can see the cause of.
 *
 * TRANSPARENCY IS A CELL YOU DID NOT WRITE. There is no alpha and no
 * transparent flag: whatever is under your region shows through everywhere you
 * do not draw. If you want an opaque panel, call `clear()` first - which erases
 * YOUR rectangle and nothing else. A call cannot disagree with what was
 * painted; a flag can.
 *
 * `put` IS DELIBERATELY ABSENT and this is the one narrowing worth knowing. The
 * host's own surface has a glyph-level write that can carry a tile asset; this
 * published subset stops at text, because a tile reference is a host type and
 * publishing it here would tie a mod's build to the renderer's asset shape. One
 * character through `print` gives you `ch`, `fg` and `bg`; art in a region is
 * not reachable through this seam yet.
 */
export interface RegionSurface {
  /** YOUR rectangle's size in cells, not the terminal's. */
  size(): { readonly cols: number; readonly rows: number };
  /** Erase YOUR rectangle. The rest of the screen is untouched. */
  clear(): void;
  print(x: number, y: number, text: string, fg: string, bg?: string): void;
  /** Erase to the end of YOUR row, then print - upstream's `prt`. */
  prt(x: number, y: number, text: string, fg: string): void;
  /** Erase from here to the end of YOUR row. */
  eraseToEol(x: number, y: number): void;
  setCursor(x: number, y: number): void;
  hideCursor(): void;
}

/**
 * A rectangle of your own on the player's screen.
 *
 * `place()` RUNS ON EVERY LAYOUT CHANGE, so the contract on it is narrow on
 * purpose: RETURN A RECTANGLE AND DO NO WORK. It must not paint, must not read
 * the game, and must not throw. A resize can arrive between any two keystrokes,
 * and an exception here is not just your region's problem - it is caught, but
 * the cost is that your region is faulted out of the stack until the next
 * relayout, and the player sees furniture disappear with no idea why.
 *
 * `paint()` is where the drawing goes, and it is called once per frame with a
 * surface clipped to whatever `place()` last returned.
 *
 * THERE IS NO LIST OF KEYS YOU WANT, and its absence is a decision rather than
 * an omission. A region that declared the keys it wanted would be a second
 * answer to "what does this key do" standing beside `registry:command`, and the
 * result of two answers is a mod that silently takes `i` away from the player.
 * Commands are added as commands.
 *
 * ORDER IS BANDS, NOT A NUMBER. Within your band the later-loaded mod is on
 * top, which is the same last-in-load-order rule that already decides the front
 * end, the HUD, the menus and the screens. A free numeric z-index was
 * considered and declined: it is a coordination problem with no coordinator,
 * every mod picks a large number, and the first one to out-bid the mod manager
 * takes away the player's way to turn it off.
 *
 * Requires `ui:region.create`. Note that `ui:*.replace` does NOT grant it - the
 * wildcard ranges over which of the game's regions changes hands, and adding
 * one of your own is a different sentence for the player to agree to.
 */
export interface RegionDeclaration {
  /**
   * Your name for it, unique among YOUR regions. The host prefixes your mod id,
   * so the live stack shows `my-mod:carried` and you cannot collide with
   * another mod - or with `map`, which a front end asks about by name.
   */
  readonly id: string;
  readonly layer: ModRegionLayer;
  /** Cheap, total, pure. See this interface's note. */
  place(grid: { readonly cols: number; readonly rows: number }): RegionCells;
  /** Draw. Called once per frame, clipped to `place()`'s rectangle. */
  paint(surface: RegionSurface): void;
}

export interface WorldFrame {
  readonly viewport: {
    readonly origin: WorldGrid;
    readonly size: { readonly width: number; readonly height: number };
    readonly screenOrigin: WorldGrid;
  };
  readonly cells: readonly WorldCell[];
  readonly player?: WorldPlayer;
  /**
   * Optional because a host without a fitted surface has no geometry to give,
   * not because it is optional to respect. Read `regions.map.pixels` and draw
   * there; a front end that covers the window takes the sidebar, the messages
   * and every menu with it, and the player cannot turn it off again.
   */
  readonly regions?: ScreenRegions;
  /**
   * EVERYTHING ON SCREEN, bottom to top, including the four base tiles
   * `regions` names. A region later in this array is drawn OVER one earlier
   * in it.
   *
   * STAND YOUR DISPLAY DOWN WHEN SOMETHING IS OVER YOU. `regions.map` says where
   * the map is; it cannot say whether the inventory, the knowledge browser or
   * the Mods screen is currently on top of it. Those screens repaint the
   * terminal without producing a world frame, so a front end that keeps its
   * canvas up covers the middle of every screen the player opens - and the
   * player has no way to tell that your mod is what is in the way. Find the
   * entry whose `id` is `"map"`; if any entry AFTER it overlaps its `cells`,
   * hide.
   *
   * YOU WILL BE TOLD. When the stack changes with no repaint behind it, the host
   * presents your last frame again with this field updated - precisely so that
   * "something opened over me" is an event, rather than something you could only
   * discover on a dungeon repaint that was never coming.
   *
   * ABSENT IS NOT EMPTY. `[]` means the host published a stack and nothing is
   * over you; `undefined` means it published none. Treating the two alike is
   * deciding you are uncovered on the word of a host that never answered.
   */
  readonly stack?: readonly LiveRegion[];
}

export interface WorldFrameSink {
  present(frame: WorldFrame): void;
}
