/**
 * The command wheel's icon set.
 *
 * WHY THESE ARE DRAWN RATHER THAN CUT FROM A TILESET. Shockbolt's 64x64 sheet
 * is the richest art this project ships, and it was surveyed first: it carries
 * a true, recognisable picture for the object NOUNS the wheel needs - potion,
 * scroll, wand, staff, rod, food, spell book, sword, bow, arrow, armour, helm,
 * boots, shield, lantern, torch, flask, pick, shovel, chest, gold, ring,
 * amulet, item pile - and for the map cells that stand in for stairs and
 * doors. It carries nothing at all for the VERBS and the interface concepts,
 * which are most of what a command wheel is made of: look, target, rest, run,
 * explore, repeat, inscribe, ignore, drop, examine, locate, recentre, options,
 * help, save, messages, redraw, character, knowledge. Roughly twenty of the
 * wheel's slots have a tile and the rest do not, so a sheet-backed wheel would
 * have been one third painted portraiture and two thirds flat marks: two
 * designs in one ring, and a wrong picture in every slot where an unrelated
 * tile got pressed into service.
 *
 * Three further facts pointed the same way. The wheel has to look the same for
 * a player rendering in ASCII, and the Shockbolt sheet is a 17.5 MB download
 * that is only fetched when that graphics mode is selected. The sheet's terms
 * withhold permission to modify it, and `public/tiles/CREDITS.md` records that
 * this repository holds the sheets while the cut-up, per-tile form belongs to
 * the linoleum mod - so crops and downscales baked into the game's own
 * furniture would cross a boundary this project has already written down. And
 * a mark that has to stay readable at 34 px over an arbitrary, high-contrast
 * game background wants a heavy silhouette and two flat tones, which is the
 * opposite of a 64 px painted render.
 *
 * So the set below is drawn, in one visual language, with the silhouettes
 * modelled on Angband's own objects. Every icon is a 24x24 viewBox, filled
 * shapes with no stroke thinner than 1.6 units, in two tones: the wedge's own
 * colour for the body and one accent for the part that names the icon.
 *
 * Built with `createElementNS` rather than assigned as markup, because nothing
 * else in this package assigns `innerHTML` and a static icon table is not a
 * reason to start.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * One drawn element. Exactly one of `d`, `circle` and `rect` is set; `stroke`
 * turns the shape into an outline of that width instead of a fill.
 */
export interface IconShape {
  /** Path data, in the 24x24 viewBox. */
  readonly d?: string;
  /** Circle as centre x, centre y, radius. */
  readonly circle?: readonly [number, number, number];
  /** Rectangle as x, y, width, height, corner radius. */
  readonly rect?: readonly [number, number, number, number, number];
  /** Stroke width. Absent means the shape is filled. */
  readonly stroke?: number;
  /** Draw in the accent colour rather than the wedge's own. */
  readonly accent?: true;
}

/* Marks reused across several icons, so the family reads as one set. */
const SLASH: IconShape = { d: "M3.6 20.4 20.4 3.6", stroke: 2.8, accent: true };
const QUESTION = "M12 6.2c2.4 0 4.1 1.5 4.1 3.6 0 1.6-.8 2.5-2 3.3-.9.6-1.2 1"
  + "-1.2 1.8v.5h-2.2v-.8c0-1.4.5-2.1 1.6-2.9.9-.6 1.3-1 1.3-1.8 0-.9-.6-1.5"
  + "-1.6-1.5-1.1 0-1.7.6-1.8 1.7H8c.1-2.2 1.7-3.9 4-3.9z";
const PAGE = "M5 2.6h9.4l4.6 4.6v14.2H5z";
const ARMOUR = "M12 6.2 6 8.5v4.9c0 3.7 2.4 6.7 6 8.2 3.6-1.5 6-4.5 6-8.2V8.5z";
const EYE = "M12 4.8c5.1 0 9 3.9 10.2 7.2-1.2 3.3-5.1 7.2-10.2 7.2S2.9 15.3 1.8"
  + " 12C2.9 8.7 6.9 4.8 12 4.8z";
const MAP_PANELS = "M2.4 6 8.4 3.6v14.8L2.4 20.8zM9.6 3.6 14.4 6v14.8L9.6 18.4z"
  + "M15.6 6l6-2.4v14.8l-6 2.4z";
const BUBBLE = "M3.4 4.4h17.2a1.8 1.8 0 0 1 1.8 1.8v9a1.8 1.8 0 0 1-1.8 1.8H10"
  + "l-5 4v-4H3.4a1.8 1.8 0 0 1-1.8-1.8v-9a1.8 1.8 0 0 1 1.8-1.8z";
/** Steps rising to the right, and its mirror image about x = 12. */
const STEPS_UP = "M21 21.4H3v-3.2h4.5V15H12v-3.2h4.5V8.6H21z";
const STEPS_DOWN = "M3 21.4H21v-3.2h-4.5V15H12v-3.2H7.5V8.6H3z";
const SACK = "M9.2 2.6h5.6l-1.2 3.4c3.6 1.2 6 4.4 6 8.2 0 4.6-3.4 7.6-7.6 7.6"
  + "S4.4 18.8 4.4 14.2c0-3.8 2.4-7 6-8.2z";
const TAG = "M12.4 3.2h7a1.6 1.6 0 0 1 1.6 1.6v7a2 2 0 0 1-.6 1.4l-7.4 7.4a2 2 0"
  + " 0 1-2.8 0l-6.6-6.6a2 2 0 0 1 0-2.8L11 3.8a2 2 0 0 1 1.4-.6z";
const FLOOR: IconShape = { rect: [3, 19.8, 18, 2.4, 1.2] };
const SPARK = "M18.4 1.6l1.2 3.4 3.4 1.2-3.4 1.2-1.2 3.4-1.2-3.4-3.4-1.2 3.4"
  + "-1.2z";

/**
 * The set. Order within an icon is paint order: body shapes first, accents on
 * top.
 */
const ICONS = {
  /* ---- the eight primary groups ---- */
  sword: [
    { d: "M12 1.6l2.3 3.6v8.9h-4.6V5.2z" },
    { rect: [6.6, 14.1, 10.8, 2.3, 1] },
    { rect: [10.8, 16.4, 2.4, 3.4, 0] },
    { circle: [12, 20.9, 1.7], accent: true },
  ],
  book: [
    { d: "M6.2 2.4h11.4a2 2 0 0 1 2 2v15.2a2 2 0 0 1-2 2H6.2z" },
    { rect: [4.2, 2.4, 2.4, 19.2, 0.8], accent: true },
    { d: "M13.6 8.2l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z", accent: true },
  ],
  potion: [
    { rect: [10.2, 1.6, 3.6, 2.4, 0.8], accent: true },
    { d: "M10 4h4v3.2a7 7 0 1 1-4 0z" },
    { d: "M5.1 14.5a7 7 0 0 0 13.8 0z", accent: true },
  ],
  armour: [
    { d: "M12 1.8 4.6 4.6v6.6c0 4.9 3 8.8 7.4 10.9 4.4-2.1 7.4-6 7.4-10.9V4.6z" },
    { rect: [11.1, 6.4, 1.8, 11.6, 0.9], accent: true },
  ],
  pack: [
    { d: SACK },
    { rect: [8.6, 5.2, 6.8, 2.2, 1.1], accent: true },
  ],
  stairs: [{ d: STEPS_UP }],
  map: [
    { d: MAP_PANELS },
    { d: "M6 16.5c2.4-1 2-4.4 4.6-5.4s3.6.6 5.4-2", stroke: 1.8, accent: true },
  ],
  more: [
    { circle: [12, 12, 9.8], stroke: 2.2 },
    { circle: [7.6, 12, 1.6], accent: true },
    { circle: [12, 12, 1.6], accent: true },
    { circle: [16.4, 12, 1.6], accent: true },
  ],

  /* ---- fighting ---- */
  bow: [
    { d: "M17 3.2A13 13 0 0 1 17 20.8", stroke: 2.6 },
    { d: "M17 3.2 11 12l6 8.8", stroke: 1.8, accent: true },
    { d: "M4 12h11", stroke: 2 },
    { d: "M13.4 9.2 18.2 12l-4.8 2.8z" },
  ],
  snapshot: [
    { circle: [18.6, 12, 4.2], stroke: 1.8, accent: true },
    { circle: [18.6, 12, 1.4], accent: true },
    { d: "M1.8 12h11.4", stroke: 2.2 },
    { d: "M11.2 8.4 16 12l-4.8 3.6z" },
  ],
  throw: [
    { d: "M3 20.6C5.4 13.6 9.6 8.8 15.8 6.4", stroke: 1.8, accent: true },
    { d: "M17 3h2.6v1.6a4.4 4.4 0 1 1-2.6 0z" },
  ],
  crosshair: [
    { circle: [12, 12, 8], stroke: 2.2 },
    { d: "M12 1.4v4.2M12 18.4v4.2M1.4 12h4.2M18.4 12h4.2", stroke: 2.2 },
    { circle: [12, 12, 1.6], accent: true },
  ],
  "crosshair-lock": [
    { circle: [12, 12, 7.6], stroke: 2.2 },
    { d: "M12 2v3.2M12 18.8V22M2 12h3.2M18.8 12H22", stroke: 2.2 },
    { circle: [12, 12, 3.2], accent: true },
  ],
  eye: [
    { d: EYE },
    { circle: [12, 12, 3.6], accent: true },
    { circle: [12, 12, 1.5] },
  ],
  hand: [
    { d: "M7.4 10.2V4.6a1.6 1.6 0 0 1 3.2 0v4.8h.9V3.2a1.6 1.6 0 0 1 3.2 0v6.2h"
      + ".9V5.4a1.6 1.6 0 0 1 3.2 0v9.2c0 4-2.6 6.8-6.4 6.8-2.4 0-4-1-5.2-2.8"
      + "L3.6 14a1.6 1.6 0 0 1 2.6-1.8z" },
  ],

  /* ---- magic ---- */
  cast: [
    { d: "M8 21.4v-5.2l-2.6-2.6a1.5 1.5 0 0 1 2.2-2.1l1.4 1.4V11a1.4 1.4 0 0 1 2"
      + ".8 0v1.6a1.4 1.4 0 0 1 2.8 0v.9a1.4 1.4 0 0 1 2.8 0v3.4c0 2.6-1.6 4.5"
      + "-4.2 4.5z" },
    { d: "M12 1.4l1.3 3.5 3.5 1.3-3.5 1.3L12 11l-1.3-3.5L7.2 6.2l3.5-1.3z",
      accent: true },
  ],
  "book-open": [
    { d: "M2.4 5.6c3-1.4 6.2-1.6 9 .4v13.6c-2.8-2-6-1.8-9-.4z" },
    { d: "M21.6 5.6c-3-1.4-6.2-1.6-9 .4v13.6c2.8-2 6-1.8 9-.4z" },
    { rect: [11.2, 5.4, 1.6, 14.4, 0.6], accent: true },
  ],
  study: [
    { d: "M5.4 3h10.2a2 2 0 0 1 2 2v14.6a2 2 0 0 1-2 2H5.4z" },
    { rect: [3.4, 3, 2, 18.6, 0.7] },
    { d: "M17.6 12.4h2.4v3h3v2.4h-3v3h-2.4v-3h-3v-2.4h3z", accent: true },
  ],
  abilities: [
    { rect: [3.4, 13.4, 4.2, 7.2, 1.2] },
    { rect: [9.9, 9.2, 4.2, 11.4, 1.2] },
    { rect: [16.4, 4.4, 4.2, 16.2, 1.2], accent: true },
  ],

  /* ---- consumables and devices ---- */
  scroll: [
    { rect: [5.4, 4.4, 13.2, 15.2, 0.6] },
    { rect: [3.2, 2.4, 17.6, 3.4, 1.7], accent: true },
    { rect: [3.2, 18.2, 17.6, 3.4, 1.7], accent: true },
    { d: "M8 9h8M8 12.2h8M8 15.4h5", stroke: 1.7, accent: true },
  ],
  food: [
    { d: "M12 6.4c2-2 5.4-2.2 7 .4 1.8 3 .6 9.6-2.4 12.8-1.2 1.3-3 .8-4.6.8s-3"
      + ".4.5-4.6-.8C4.4 16.4 3.2 9.8 5 6.8c1.6-2.6 5-2.4 7-.4z" },
    { d: "M11.4 6.4c0-2.4.9-3.9 2.8-4.8.4 2.6-.6 4.1-2.8 4.8z", accent: true },
  ],
  wand: [
    { d: "M3.2 18.6l9-9 3.2 3.2-9 9z" },
    { d: "M17.6 2.6l1.3 3.6 3.6 1.3-3.6 1.3-1.3 3.6-1.3-3.6-3.6-1.3 3.6-1.3z",
      accent: true },
  ],
  rod: [
    { d: "M4.2 19.8l13-13a2 2 0 0 1 2.8 2.8l-13 13a2 2 0 0 1-2.8-2.8z" },
    { circle: [5.6, 18.4, 2.4], accent: true },
    { circle: [18.4, 5.6, 2.4], accent: true },
  ],
  staff: [
    { rect: [10.8, 7.4, 2.4, 14.4, 1.2] },
    { circle: [12, 5.2, 3.6], stroke: 2.2, accent: true },
  ],
  activate: [
    { circle: [10.4, 14.4, 6.4], stroke: 2.6 },
    { d: "M10.4 4.6l2 2.6-2 2.6-2-2.6z", accent: true },
    { d: SPARK, accent: true },
  ],
  use: [
    { rect: [3.6, 7.6, 12.8, 12.8, 1.8] },
    { d: SPARK, accent: true },
  ],

  /* ---- gear ---- */
  wear: [
    { d: ARMOUR },
    { d: "M10.4 0.8h3.2V4h2.8L12 8.4 7.6 4h2.8z", accent: true },
  ],
  remove: [
    { d: ARMOUR },
    { d: "M13.6 8.4h-3.2V5.2H7.6L12 0.8 16.4 5.2h-2.8z", accent: true },
  ],
  swap: [
    { d: "M3 6.2h13.6V3l4.6 4.6-4.6 4.6V9H3z" },
    { d: "M21 17.8H7.4V21l-4.6-4.6L7.4 11.8V15H21z", accent: true },
  ],
  examine: [
    { circle: [10.4, 10.4, 7], stroke: 2.6 },
    { d: "M15.6 15.6l5.4 5.4", stroke: 3 },
    { d: "M7.6 8.4a4.4 4.4 0 0 1 3.2-2.6", stroke: 1.8, accent: true },
  ],
  lantern: [
    { d: "M9 6.4a3 3 0 0 1 6 0", stroke: 1.8 },
    { rect: [6.2, 6.2, 11.6, 2.4, 0.8] },
    { d: "M7 8.6h10v9.8a1.6 1.6 0 0 1-1.6 1.6H8.6A1.6 1.6 0 0 1 7 18.4z" },
    { d: "M12 10.4c1.6 1.4 2.6 2.6 2.6 4.2a2.6 2.6 0 0 1-5.2 0c0-1.6 1-2.8 2.6"
      + "-4.2z", accent: true },
  ],
  /* A satchel with a flap and a clasp, not a bag with a handle: a handle over a
     rounded body reads as a padlock at 30px, which was measured rather than
     guessed. */
  inventory: [
    { rect: [2.8, 6.6, 18.4, 13.6, 2.4] },
    { d: "M5.2 6.6h13.6a2.4 2.4 0 0 1 2.4 2.4v2.8H2.8V9a2.4 2.4 0 0 1 2.4-2.4z",
      accent: true },
    { rect: [10.2, 12.8, 3.6, 4.2, 1.2], accent: true },
  ],
  equipment: [
    { d: "M12 10.6 6 12.8v3.2c0 2.8 2.4 4.8 6 5.8 3.6-1 6-3 6-5.8v-3.2z" },
    { d: "M12 2.2a4.6 4.6 0 0 1 4.6 4.6v2.4H7.4V6.8A4.6 4.6 0 0 1 12 2.2z",
      accent: true },
  ],
  quiver: [
    { d: "M9.4 8.4V3.2M12 8.4V1.8M14.6 8.4V3.2", stroke: 1.8, accent: true },
    { d: "M7.6 8.4h8.8v10.6a2.6 2.6 0 0 1-2.6 2.6h-3.6a2.6 2.6 0 0 1-2.6-2.6z" },
  ],

  /* ---- carrying ---- */
  pickup: [
    FLOOR,
    { d: "M12 10.8l4.2 4.6h-2.6v3h-3.2v-3H7.8z" },
    { rect: [8.4, 2.6, 7.2, 6.4, 1.4], accent: true },
  ],
  drop: [
    FLOOR,
    { d: "M12 17.6l-4.2-4.6h2.6v-3h3.2v3h2.6z" },
    { rect: [8.4, 1.8, 7.2, 6, 1.4], accent: true },
  ],
  ignore: [
    { rect: [5.6, 5.6, 12.8, 12.8, 2] },
    SLASH,
  ],
  ignoring: [
    { d: EYE },
    { circle: [12, 12, 3.6] },
    SLASH,
  ],
  inscribe: [
    { d: TAG },
    { circle: [17, 7, 1.7], accent: true },
    { d: "M8.6 13.4h5.2", stroke: 1.8, accent: true },
  ],
  uninscribe: [
    { d: TAG },
    { circle: [17, 7, 1.7], accent: true },
    SLASH,
  ],
  autopickup: [
    FLOOR,
    { d: "M12 8.6l4.4 4.8H7.6zM12 13.4l4.4 4.8H7.6z" },
    { rect: [8.8, 1.8, 6.4, 5.2, 1.2], accent: true },
  ],

  /* ---- moving about ---- */
  "stairs-up": [
    { d: STEPS_UP },
    { d: "M3.4 8 7.4 2.8 11.4 8z", accent: true },
  ],
  "stairs-down": [
    { d: STEPS_DOWN },
    { d: "M12.6 2.8 16.6 8 20.6 2.8z", accent: true },
  ],
  rest: [
    { d: "M13.6 1.6h8.4v2.4l-5 4.8h5v2.4h-8.4V8.8l5-4.8h-5z", accent: true },
    { d: "M8.2 9.6h6.6v2l-3.9 3.7h3.9v2H8.2v-2l3.9-3.7H8.2z" },
    { d: "M3 17.4h5v1.7l-2.9 2.8H8v1.7H3v-1.7l2.9-2.8H3z" },
  ],
  run: [
    { d: "M2 5.4 8.6 12 2 18.6z" },
    { d: "M9 5.4 15.6 12 9 18.6z" },
    { d: "M16 5.4 22.6 12 16 18.6z", accent: true },
  ],
  explore: [
    { circle: [12, 12, 9.6], stroke: 2.2 },
    { d: "M12 5.4l2.6 6-6 2.6z" },
    { d: "M12 18.6l-2.6-6 6-2.6z", accent: true },
  ],
  walk: [
    { d: "M12 3.4c3.4 0 5.6 2.8 5.6 6.2S15.4 15 12 15s-5.6-2-5.6-5.4S8.6 3.4 12"
      + " 3.4z" },
    { d: "M12 16.4c2.4 0 4 1.4 4 3.2s-1.6 3-4 3-4-1.2-4-3 1.6-3.2 4-3.2z",
      accent: true },
  ],
  stand: [
    { circle: [12, 12, 9.2], stroke: 2.4 },
    { circle: [12, 12, 3.6], accent: true },
  ],
  repeat: [
    { d: "M12 3.6a8.4 8.4 0 1 1-8.4 8.4", stroke: 2.6 },
    { d: "M11 1.2 15.8 4.2 11 7.2z", accent: true },
  ],

  /* ---- looking at the world ---- */
  monsters: [
    { d: "M12 6.2c4 0 7 2.8 7 6.6 0 4-3 7-7 7s-7-3-7-7c0-3.8 3-6.6 7-6.6z" },
    { d: "M5.6 7.4 3.4 2.2l5.4 2.6zM18.4 7.4l2.2-5.2-5.4 2.6z", accent: true },
    { circle: [9.6, 12.4, 1.6], accent: true },
    { circle: [14.4, 12.4, 1.6], accent: true },
  ],
  objects: [
    { circle: [7.6, 17, 3.8] },
    { circle: [15.4, 17, 3.8], accent: true },
    { circle: [11.6, 10.4, 3.8] },
    { d: "M11.6 1.6l3.4 3.6-3.4 3.6-3.4-3.6z", accent: true },
  ],
  locate: [
    { d: "M3.6 3.6h16.8v16.8H3.6z", stroke: 2.4 },
    { d: "M12 6.6a4 4 0 0 1 4 4c0 2.9-4 7.2-4 7.2s-4-4.3-4-7.2a4 4 0 0 1 4-4z",
      accent: true },
    { circle: [12, 10.6, 1.5] },
  ],
  center: [
    { d: "M2.6 8.4V4.2a1.6 1.6 0 0 1 1.6-1.6h4.2v2.6H5.2v3.2zM15.6 2.6h4.2a1.6 "
      + "1.6 0 0 1 1.6 1.6v4.2h-2.6V5.2h-3.2zM21.4 15.6v4.2a1.6 1.6 0 0 1-1.6 "
      + "1.6h-4.2v-2.6h3.2v-3.2zM8.4 21.4H4.2a1.6 1.6 0 0 1-1.6-1.6v-4.2h2.6v3."
      + "2h3.2z" },
    { circle: [12, 12, 3.2], accent: true },
  ],
  symbol: [
    { d: "M4 4h16v16H4z", stroke: 2.4 },
    { d: QUESTION, accent: true },
    { circle: [12, 17.6, 1.5], accent: true },
  ],
  character: [
    { circle: [12, 7.4, 4.2], accent: true },
    { d: "M3.8 21.4c0-4.4 3.7-7.4 8.2-7.4s8.2 3 8.2 7.4z" },
  ],
  knowledge: [
    { rect: [3.4, 5, 4.2, 14, 1] },
    { rect: [8.9, 3.6, 4.2, 15.4, 1], accent: true },
    { rect: [14.4, 5.6, 4.2, 13.4, 1] },
    { rect: [2.2, 19.4, 19.6, 2.4, 1.2] },
  ],

  /* ---- everything on the second level ---- */
  trap: [
    { rect: [3, 12, 18, 2.6, 0.8] },
    { d: "M4.4 11.4 6.6 6.2l2.2 5.2 2.2-5.2 2.2 5.2 2.2-5.2 2.2 5.2z",
      accent: true },
  ],
  disarm: [
    { rect: [3, 12, 18, 2.6, 0.8] },
    { d: "M4.4 11.4 6.6 6.2l2.2 5.2 2.2-5.2 2.2 5.2 2.2-5.2 2.2 5.2z" },
    SLASH,
  ],
  pick: [
    { d: "M2.6 8.2c4-4.4 14.8-4.4 18.8 0l-1.8 2c-3.4-3.2-11.8-3.2-15.2 0z" },
    { rect: [10.8, 7.6, 2.4, 14, 1], accent: true },
  ],
  "door-close": [
    { d: "M5.4 2.6h13.2v18.8H5.4z" },
    { circle: [15.6, 12, 1.6], accent: true },
  ],
  "door-open": [
    { d: "M5.4 2.6h13.2v18.8H5.4z", stroke: 2.2 },
    { d: "M8.2 4.6 15.4 2.6v18.8L8.2 19.4z", accent: true },
  ],
  options: [
    { d: "M12 1.6l1.4 2.6 2.9-.6.4 2.9 2.9.4-.6 2.9 2.6 1.4-2.6 1.4.6 2.9-2.9."
      + "4-.4 2.9-2.9-.6L12 22.4l-1.4-2.6-2.9.6-.4-2.9-2.9-.4.6-2.9L2.4 12l2.6"
      + "-1.4-.6-2.9 2.9-.4.4-2.9 2.9.6z" },
    { circle: [12, 12, 3.4], accent: true },
  ],
  retire: [
    { d: "M6 20.4V10a6 6 0 0 1 12 0v10.4z" },
    { rect: [3, 20.4, 18, 2.4, 1.2], accent: true },
    { d: "M10.8 6h2.4v3.2h3.2v2.4h-3.2v3.2h-2.4v-3.2H7.6V9.2h3.2z",
      accent: true },
  ],
  dump: [
    { d: PAGE },
    { d: "M10.8 9.4h2.4v4.4h2.6L12 18.4l-3.8-4.6h2.6z", accent: true },
  ],
  notes: [
    { d: PAGE },
    { d: "M8 11h8M8 14.4h8M8 17.8h5", stroke: 1.7, accent: true },
  ],
  info: [
    { circle: [12, 12, 9.6], stroke: 2.4 },
    { circle: [12, 6.8, 1.7], accent: true },
    { rect: [10.6, 10, 2.8, 7.4, 1.2], accent: true },
  ],
  pref: [
    { d: PAGE },
    { circle: [14.6, 15.8, 3.8], accent: true },
    { circle: [14.6, 15.8, 1.5] },
  ],
  alter: [
    { d: "M2.6 7.4h8.2v4.2H2.6zM11.8 7.4h9.6v4.2h-9.6zM2.6 12.6h4.6v4.2H2.6zM8."
      + "2 12.6h8.2v4.2H8.2zM17.4 12.6h4v4.2h-4z" },
    { d: SPARK, accent: true },
  ],
  debug: [
    { d: "M12 6.6c3.2 0 5.4 2.6 5.4 6.4 0 4-2.2 6.6-5.4 6.6S6.6 17 6.6 13c0-3.8"
      + " 2.2-6.4 5.4-6.4z" },
    { circle: [12, 5, 2.6], accent: true },
    { d: "M6.8 10 2.6 8M6.8 14H2.6M6.8 17.6 3 20M17.2 10l4.2-2M17.2 14h4.2M17.2"
      + " 17.6 21 20", stroke: 1.7, accent: true },
  ],
  borg: [
    { d: "M12 5.4V2.6", stroke: 2, accent: true },
    { circle: [12, 2, 1.6], accent: true },
    { rect: [4.4, 5.4, 15.2, 13.2, 2.6] },
    { circle: [9, 11, 1.9], accent: true },
    { circle: [15, 11, 1.9], accent: true },
    { rect: [8.6, 14.6, 6.8, 1.8, 0.9], accent: true },
  ],
  help: [
    { circle: [12, 12, 9.8], stroke: 2.4 },
    { d: QUESTION, accent: true },
    { circle: [12, 17.6, 1.5], accent: true },
  ],
  save: [
    { d: "M4.4 3.4h12.6l3.6 3.6v13.6H4.4z" },
    { rect: [8.2, 3.4, 7, 5.6, 0.4], accent: true },
    { rect: [7.4, 13, 9.2, 7.6, 0.6], accent: true },
  ],
  quit: [
    { d: "M4.6 3h8v18h-8z", stroke: 2.4 },
    { d: "M14 12h6.4M17.2 8.6 20.6 12l-3.4 3.4", stroke: 2.4, accent: true },
  ],
  messages: [
    { d: BUBBLE },
    { d: "M6 8.4h12M6 11.8h8", stroke: 1.8, accent: true },
  ],
  "prev-message": [
    { d: BUBBLE },
    { d: "M13.6 7.6 9.6 11.4l4 3.8", stroke: 2.4, accent: true },
  ],
  feeling: [
    { d: "M12 1.8 22.2 12 12 22.2 1.8 12z" },
    { rect: [10.7, 6.4, 2.6, 7.6, 1.3], accent: true },
    { circle: [12, 16.6, 1.6], accent: true },
  ],
  redraw: [
    { d: "M20.4 12a8.4 8.4 0 0 1-13.6 6.6", stroke: 2.4 },
    { d: "M3.6 12a8.4 8.4 0 0 1 13.6-6.6", stroke: 2.4 },
    { d: "M8.6 15.4 6 20.6l5.4-1z", accent: true },
    { d: "M15.4 8.6 18 3.4l-5.4 1z", accent: true },
  ],
  wizard: [
    { d: "M12 1.6 18.4 16H5.6z" },
    { d: "M12 6.8l.9 2.5 2.5.9-2.5.9-.9 2.5-.9-2.5-2.5-.9 2.5-.9z",
      accent: true },
    { rect: [3, 16, 18, 2.8, 1.4], accent: true },
  ],
  menu: [
    { rect: [3.4, 5, 17.2, 2.8, 1.4] },
    { rect: [3.4, 10.6, 17.2, 2.8, 1.4], accent: true },
    { rect: [3.4, 16.2, 17.2, 2.8, 1.4] },
  ],
  list: [
    { circle: [5, 6.6, 1.9], accent: true },
    { circle: [5, 12, 1.9], accent: true },
    { circle: [5, 17.4, 1.9], accent: true },
    { rect: [9.4, 5.2, 11.4, 2.8, 1.4] },
    { rect: [9.4, 10.6, 11.4, 2.8, 1.4] },
    { rect: [9.4, 16, 11.4, 2.8, 1.4] },
  ],

  /* ---- prompt replies, and the last-resort marks ---- */
  accept: [{ d: "M4.2 12.6 9.6 18 20 6.4", stroke: 3 }],
  cancel: [{ d: "M5.6 5.6 18.4 18.4M18.4 5.6 5.6 18.4", stroke: 3 }],
  next: [{ d: "M9 4.6 16.4 12 9 19.4", stroke: 3 }],
  prev: [{ d: "M15 4.6 7.6 12 15 19.4", stroke: 3 }],
  command: [
    { d: "M3.6 4.4h16.8a2 2 0 0 1 2 2v11.2a2 2 0 0 1-2 2H3.6a2 2 0 0 1-2-2V6.4a"
      + "2 2 0 0 1 2-2z", stroke: 2.2 },
    { circle: [12, 12, 2.6], accent: true },
  ],
  macro: [
    { d: "M3.6 4.4h16.8a2 2 0 0 1 2 2v11.2a2 2 0 0 1-2 2H3.6a2 2 0 0 1-2-2V6.4a"
      + "2 2 0 0 1 2-2z", stroke: 2.2 },
    { d: "M9.4 8.6 13.4 12l-4 3.4", stroke: 2.4, accent: true },
  ],
  reply: [
    { circle: [12, 12, 8.6], stroke: 2.2 },
    { circle: [12, 12, 3.4], accent: true },
  ],
} as const satisfies Record<string, readonly IconShape[]>;

export type IconName = keyof typeof ICONS;

/** True when `name` is one of the drawn icons. Used by the plan's own test. */
export function isIconName(name: string): name is IconName {
  return Object.hasOwn(ICONS, name);
}

/** Every icon's name, for the test that proves the plan references real art. */
export function iconNames(): readonly IconName[] {
  return Object.keys(ICONS) as IconName[];
}

/** One icon's shapes, so the drawing rules above can be checked rather than
 * asserted in a comment. */
export function iconShapes(name: IconName): readonly IconShape[] {
  return ICONS[name];
}

/**
 * One icon as a live `<svg>`.
 *
 * `aria-hidden`, because the wedge already carries the command's full name as
 * its accessible label and a second reading of the same thing is noise.
 */
export function buildIcon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("gamepad-icon");
  for (const shape of ICONS[name] as readonly IconShape[]) {
    let node: SVGElement;
    if (shape.circle) {
      node = document.createElementNS(SVG_NS, "circle");
      node.setAttribute("cx", String(shape.circle[0]));
      node.setAttribute("cy", String(shape.circle[1]));
      node.setAttribute("r", String(shape.circle[2]));
    } else if (shape.rect) {
      node = document.createElementNS(SVG_NS, "rect");
      node.setAttribute("x", String(shape.rect[0]));
      node.setAttribute("y", String(shape.rect[1]));
      node.setAttribute("width", String(shape.rect[2]));
      node.setAttribute("height", String(shape.rect[3]));
      node.setAttribute("rx", String(shape.rect[4]));
    } else {
      node = document.createElementNS(SVG_NS, "path");
      node.setAttribute("d", shape.d ?? "");
    }
    if (shape.stroke === undefined) {
      node.setAttribute("fill", shape.accent ? "var(--gp-accent)" : "currentColor");
    } else {
      node.setAttribute("fill", "none");
      node.setAttribute("stroke", shape.accent ? "var(--gp-accent)" : "currentColor");
      node.setAttribute("stroke-width", String(shape.stroke));
      node.setAttribute("stroke-linecap", "round");
      node.setAttribute("stroke-linejoin", "round");
    }
    svg.append(node);
  }
  return svg;
}
