/**
 * Vitals Panel - a worked example of `ModPlugin.hud`.
 *
 * WHAT IT IS FOR. `samples/blueprint-view` is the same demonstration for the
 * MAP: a mod drawing the dungeon its own way from semantic data. This is the
 * other half of the screen, and it exists to prove the part that is easy to
 * claim and hard to show - that a mod can take ONE named region and leave the
 * rest of the game alone. With this enabled the vitals are a graphical panel and
 * the message line, the status line, the map and every menu are still core's,
 * still being drawn, still readable.
 *
 * WHAT IT READS, AND WHY THAT IS THE POINT. Two fields, both semantic:
 * `entry.key` - the engine's own handler name (`hp`, `sp`, `depth`, the
 * `side_handlers[]` name minus its `prt_` prefix) - and `run.color`, the
 * COLOUR_* attribute the engine assigned. It never reads `run.css` (the
 * terminal's resolved colour) or `entry.screen` (the cell the terminal would put
 * it in). Matching on the printed text or re-using the terminal's palette would
 * have been shorter and would have proved the opposite of the point: a front end
 * that has to reverse-engineer the faithful renderer is not free of it.
 *
 * WHAT IT CANNOT DO YET, said plainly because a sample is where a limit gets
 * discovered. The frame carries each field's TEXT, not its numbers: there is
 * `"HP 20/20"` and no `{current: 20, max: 20}`. So this panel can restyle,
 * recolour and re-lay-out the vitals, and it cannot draw a proportional health
 * bar without parsing the string - which is exactly the sin above. Adding values
 * to the frame is the next increment of this seam, not a workaround for here.
 *
 * WHERE IT DRAWS. `section.region.pixels` - the rectangle the host says the
 * vitals occupy, in CSS pixels, re-read every frame. That moves when the window
 * is resized and when the player changes sidebar mode ('=' -> (o)), and reading
 * it from the frame is how this stays right without listening for any of it.
 * Under the "none" layout there is no vitals region at all and this sink is
 * simply never called - the player turned the furniture off, and a mod putting
 * it back would be overriding a choice rather than styling one.
 *
 * NO IMPORTS, deliberately. A folder plugin gets the engine passed in through
 * `ctx` and nothing else is resolvable from a mods folder.
 */

const PANEL_BG = "#161a24";
const PANEL_EDGE = "#2f3a52";
const LABEL = "#7f8ca6";
const DEFAULT_INK = "#d7dde8";

/**
 * The engine's colour attributes, resolved by NAME through `ctx.core`.
 *
 * By code rather than by the numbers those codes currently have, for the same
 * reason blueprint-view resolves terrain that way: a number memorised here is a
 * number that silently means something else the day the table moves.
 */
const PALETTE = {
  COLOUR_RED: "#c8404a",
  COLOUR_L_RED: "#e8646e",
  COLOUR_ORANGE: "#d98b3a",
  COLOUR_YELLOW: "#e0c766",
  COLOUR_GREEN: "#4f9d63",
  COLOUR_L_GREEN: "#77c98c",
  COLOUR_BLUE: "#4a7fc1",
  COLOUR_L_BLUE: "#78add8",
  COLOUR_VIOLET: "#9b6fc4",
  COLOUR_SLATE: "#8c93a3",
  COLOUR_L_DARK: "#5b6272",
};

/** attr number -> this panel's own ink, built once from ctx.core. */
function inkTable(core) {
  const out = new Map();
  if (!core) return out;
  for (const code of Object.keys(PALETTE)) {
    const attr = core[code];
    if (typeof attr === "number") out.set(attr, PALETTE[code]);
  }
  return out;
}

/**
 * What this panel calls each field, keyed by the engine's own handler name.
 *
 * A key with no entry here is still drawn - it just keeps whatever the engine
 * printed. That matters: `side_handlers[]` is a table a content pack can add to,
 * and a panel that only drew the fields it had heard of would silently swallow
 * anything new.
 */
const LABELS = {
  race: "Race",
  class: "Class",
  title: "Title",
  level: "Level",
  exp: "Exp",
  gold: "Gold",
  equippy: "",
  str: "STR",
  int: "INT",
  wis: "WIS",
  dex: "DEX",
  con: "CON",
  ac: "Armour",
  hp: "Health",
  sp: "Spell",
  monhp: "Target",
  depth: "Depth",
};

function makeSurface(doc) {
  const canvas = doc.createElement("canvas");
  canvas.id = "vitals-panel";
  canvas.style.position = "fixed";
  canvas.style.display = "none";
  /* Input still belongs to the host's one input door. A HUD region that
   * swallowed clicks would be replacing more than the drawing of it. */
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "50";
  doc.body.appendChild(canvas);
  return canvas;
}

/**
 * Put the canvas exactly on the region the host published for this section.
 *
 * Returns the rectangle, or null when there is no pixel geometry - a headless
 * harness, or a surface that has not been fitted. Null means DRAW NOTHING:
 * falling back to a guess would put this panel over the map, which is the defect
 * regions exist to end.
 */
function place(canvas, section) {
  const box = section.region && section.region.pixels;
  if (!box || box.width <= 0 || box.height <= 0) {
    canvas.style.display = "none";
    return null;
  }
  canvas.style.display = "block";
  canvas.style.left = `${box.x}px`;
  canvas.style.top = `${box.y}px`;
  canvas.style.width = `${box.width}px`;
  canvas.style.height = `${box.height}px`;
  return box;
}

/** The whole text of one entry, its runs joined. */
function textOf(entry) {
  let out = "";
  for (const run of entry.runs) out += run.text;
  return out.trim();
}

/** The entry's ink: the FIRST run that named a colour wins. */
function inkOf(entry, ink) {
  for (const run of entry.runs) {
    const hit = ink.get(run.color);
    if (hit) return hit;
  }
  return DEFAULT_INK;
}

export default {
  api: 1,

  hud(ctx) {
    const doc = globalThis.document;
    /* No DOM at all is a legitimate host (a headless harness, a test). Decline
     * rather than throw: a throwing factory costs this mod its region AND is
     * reported as its fault, when the honest answer is "not here". */
    if (!doc || !doc.body) return undefined;

    const canvas = makeSurface(doc);
    const g = canvas.getContext("2d");
    if (!g) return undefined;
    const ink = inkTable(ctx.core);

    ctx.log("vitals-panel: drawing the vitals region");

    return {
      /* One region, and only the one the manifest asked for. Returning a
       * `status` sink here as well would be refused and reported - the player
       * consented to the vitals changing hands, not the status line. */
      sidebar: {
        present(section) {
          const box = place(canvas, section);
          if (!box) return;
          const dpr = globalThis.devicePixelRatio || 1;
          const w = box.width;
          const h = box.height;
          if (canvas.width !== Math.floor(w * dpr)) canvas.width = Math.floor(w * dpr);
          if (canvas.height !== Math.floor(h * dpr)) canvas.height = Math.floor(h * dpr);
          g.setTransform(dpr, 0, 0, dpr, 0, 0);

          g.fillStyle = PANEL_BG;
          g.fillRect(0, 0, w, h);
          g.strokeStyle = PANEL_EDGE;
          g.lineWidth = 1;
          g.strokeRect(0.5, 0.5, w - 1, h - 1);

          /* Laid out by THIS panel, not by where the terminal would have put
           * each field: `entry.screen` is the faithful renderer's own answer and
           * is deliberately untouched here. Fields keep the frame's order, which
           * is side_handlers[] order and is the game's decision to make. */
          const rows = section.entries.length || 1;
          const step = Math.min(22, Math.max(10, (h - 12) / rows));
          const size = Math.max(8, Math.floor(step * 0.62));
          let y = 8 + size;

          for (const entry of section.entries) {
            const text = textOf(entry);
            if (text) {
              const label = LABELS[entry.key];
              if (label) {
                g.fillStyle = LABEL;
                g.font = `${Math.max(7, size - 3)}px sans-serif`;
                g.fillText(label, 8, y);
              }
              g.fillStyle = inkOf(entry, ink);
              g.font = `bold ${size}px sans-serif`;
              g.fillText(text, label ? 8 + Math.max(34, size * 3) : 8, y);
            }
            y += step;
            if (y > h - 4) break;
          }
        },
      },
    };
  },
};
