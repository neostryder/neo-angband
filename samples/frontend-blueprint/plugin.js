/**
 * Blueprint View - a worked example of `ModPlugin.frontend`.
 *
 * WHAT IT IS FOR. Every other proof that the front-end seam works is a test:
 * a fixture plugin pushes the frames it receives into a global and an assertion
 * reads them back. That proves the frame ARRIVES. It does not prove a mod can
 * put something on the screen with it, and "green tests on one side, nothing on
 * the shipped path" is the failure this repository keeps re-learning. So this
 * one draws, in the installed build, from a folder on disk.
 *
 * WHAT IT DRAWS. A drafting-table blueprint: walls as strokes, known floor as
 * hatch, remembered-but-unseen grids dimmed, and marks for what the player
 * knows is there. Every one of those decisions comes from `cell.visibility`,
 * `cell.terrain` and `cell.overlays[].kind` - the semantic layers. Nothing here
 * reads `cell.visual`, which is the terminal's own projection and the thing an
 * alternate front end is supposed to be free of. Reverse-parsing a `#` would
 * have been shorter and would have proved the opposite of the point.
 *
 * WHY IT OWNS THE WHOLE WINDOW. The seam hands a front end the frame and no way
 * to learn where the map's pixels are - the terminal keeps cell size, the
 * letterbox offset and the grid dimensions private, and there is no `ctx`
 * member that would tell a mod. Drawing INSIDE the terminal's map rectangle
 * would therefore mean guessing it. So this covers the window instead, which is
 * what the isometric and 3D front ends the seam exists for would do anyway. See
 * MOD_REACH gap 9 - the missing viewport geometry is recorded there rather than
 * papered over here.
 *
 * NO IMPORTS, deliberately. A folder plugin gets the engine passed in through
 * `ctx` and nothing else is resolvable from a mods folder.
 */

const PAPER = "#0d2137";
const INK = "#8fc6ff";
const INK_DIM = "#3f6c96";
const MARK_MONSTER = "#ff9d68";
const MARK_OBJECT = "#ffe07a";
const MARK_TRAP = "#ff6b8a";
const MARK_PLAYER = "#ffffff";

/** One mark per overlay kind. Absent kinds simply are not drawn. */
const MARKS = {
  monster: MARK_MONSTER,
  object: MARK_OBJECT,
  trap: MARK_TRAP,
  path: INK_DIM,
};

/**
 * The canvas this front end owns, created once and kept.
 *
 * `pointer-events: none` matters: input still belongs to the host's input door,
 * and a front end that swallowed clicks would be replacing more than the
 * display. The game's own canvas is left alone underneath - this covers it
 * rather than clearing it, so handing the map back after a fault (which the
 * host does by resuming its own sink) needs nothing undone here.
 */
function makeSurface(doc) {
  const canvas = doc.createElement("canvas");
  canvas.id = "blueprint-view";
  canvas.style.position = "fixed";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "50";
  doc.body.appendChild(canvas);
  return canvas;
}

/** The terrain codes a plan draws as solid. Names, resolved through core. */
const WALL_CODES = ["SECRET", "MAGMA", "QUARTZ", "MAGMA_K", "QUARTZ_K", "GRANITE", "PERM"];

/**
 * Resolve the wall set once, from `ctx.core.FEAT`.
 *
 * By CODE rather than by the numbers those codes currently have: `FEAT` is
 * generated from `list-terrain.h`, so a pack that adds terrain moves every
 * index after its insertion point, and a mod that had memorised 21 for GRANITE
 * would quietly start drawing something else as wall.
 */
function wallSet(core) {
  const feat = core && core.FEAT;
  const out = new Set();
  if (!feat) return out;
  for (const code of WALL_CODES) {
    const idx = feat[code];
    if (typeof idx === "number") out.add(idx);
  }
  return out;
}

export default {
  api: 1,

  frontend(ctx) {
    const doc = globalThis.document;
    /* No DOM at all is a legitimate host (a headless harness, a test). Decline
     * rather than throw: a throwing factory costs this mod the slot AND is
     * reported as its fault, when the honest answer is "not here". */
    if (!doc || !doc.body) return undefined;

    const canvas = makeSurface(doc);
    const g = canvas.getContext("2d");
    if (!g) return undefined;
    const walls = wallSet(ctx.core);

    ctx.log("blueprint-view: holding the map display");

    return {
      present(frame) {
        const dpr = globalThis.devicePixelRatio || 1;
        const w = canvas.clientWidth || 800;
        const h = canvas.clientHeight || 600;
        if (canvas.width !== Math.floor(w * dpr)) canvas.width = Math.floor(w * dpr);
        if (canvas.height !== Math.floor(h * dpr)) canvas.height = Math.floor(h * dpr);
        g.setTransform(dpr, 0, 0, dpr, 0, 0);

        g.fillStyle = PAPER;
        g.fillRect(0, 0, w, h);

        const cols = frame.viewport.size.width || 1;
        const rows = frame.viewport.size.height || 1;
        /* One square cell, letterboxed - the aspect ratio of the dungeon is a
         * fact about the dungeon, not about the window it is shown in. */
        const cell = Math.max(2, Math.min(w / cols, h / rows));
        const ox = (w - cell * cols) / 2;
        const oy = (h - cell * rows) / 2;
        const at = (c) => ({
          x: ox + (c.grid.x - frame.viewport.origin.x) * cell,
          y: oy + (c.grid.y - frame.viewport.origin.y) * cell,
        });

        for (const c of frame.cells) {
          if (c.visibility === "unknown") continue;
          const p = at(c);
          const dim = c.visibility === "remembered";
          if (c.terrain && walls.has(c.terrain.id)) {
            g.fillStyle = dim ? INK_DIM : INK;
            g.fillRect(p.x, p.y, cell, cell);
          } else {
            /* Hatch, not fill: known-and-open has to read differently from
             * known-and-solid at a glance, which is the whole job of a plan. */
            g.strokeStyle = dim ? INK_DIM : INK;
            g.lineWidth = 0.5;
            g.beginPath();
            g.moveTo(p.x, p.y + cell);
            g.lineTo(p.x + cell, p.y);
            g.stroke();
          }
        }

        for (const c of frame.cells) {
          if (c.visibility === "unknown") continue;
          const p = at(c);
          for (const layer of c.overlays) {
            const colour = MARKS[layer.kind];
            if (!colour) continue;
            g.fillStyle = colour;
            g.beginPath();
            g.arc(p.x + cell / 2, p.y + cell / 2, cell * 0.3, 0, Math.PI * 2);
            g.fill();
          }
        }

        if (frame.player) {
          const p = at(frame.player);
          g.strokeStyle = MARK_PLAYER;
          g.lineWidth = 2;
          g.strokeRect(p.x + 1, p.y + 1, cell - 2, cell - 2);
        }

        /* The label is not decoration. A screenshot of an unfamiliar renderer
         * is not self-evidently the mod's rather than a broken game frame, and
         * the frame's own numbers are the part that proves the data arrived. */
        g.fillStyle = INK;
        g.font = "14px monospace";
        g.fillText(
          `Blueprint View - ${cols}x${rows} from WorldFrame (${frame.cells.length} cells)`,
          12,
          22,
        );
      },
    };
  },
};
