/**
 * Sprite Inventory - a worked example of `ModPlugin.screen`.
 *
 * WHAT IT IS FOR. Its three siblings reimagine the map (`blueprint-view`), one
 * HUD region (`vitals-panel`) and one menu (`command-dial`). This one reimagines
 * the CONTENT of a full screen, which is the thing none of the other three could
 * reach: before `ScreenView` existed the inventory arrived as `ScreenLine[]`, and
 * a mod wanting to draw items as cards would have had to parse `"a) a Potion of
 * Cure Light Wounds       4.0 lb"` back into a name and a weight. This sample is
 * the proof that it no longer has to.
 *
 * WHAT IT READS, and nothing else:
 *   - `view.id` to recognise the screen (`core:inventory`, `core:equipment`,
 *     `core:quiver`).
 *   - the `table` block's `rows`, and each row's `cells.name.text` - addressed by
 *     COLUMN KEY. It never counts characters and never sees a padded field.
 *   - `row.cells.weight.values.total`, the number the weight column was formatted
 *     from, so the card can print "0.4 lb" its own way or sort by it.
 *   - `row.semantic` for what a row MEANS. An equipment slot with nothing in it
 *     is `{kind: "slot"}` rather than an item, which is how the empty cards get
 *     drawn as outlines instead of as gear.
 *   - `row.color`, the object's own attr as CSS, so a card keeps the colour the
 *     player's pref file chose.
 *   - `block.empty` for "(nothing carried)", rather than inventing wording the
 *     game would have used.
 *
 * A SCREEN IS DISMISSED, NOT ANSWERED, which is the shape difference from
 * `command-dial`. `show` declines by returning `undefined` synchronously and takes
 * the screen by returning `{ dismissed }` - a promise this sample resolves when
 * the player presses a key. There is no answer to give back, so there is nothing
 * to get wrong about ids here; what there IS to get right is resolving
 * `dismissed`, because a screen that never resolves is a game that never comes
 * back.
 *
 * IT TAKES THREE SCREENS AND DECLINES THE REST. The character sheet, the knowledge
 * browser, the message history and every prose page are still the game's own -
 * and still work. That is the seam working: a card grid is a good shape for
 * things you own and a poor one for a wall of text.
 *
 * NO IMPORTS, deliberately. A folder plugin gets the engine passed in through
 * `ctx` and nothing else is resolvable from a mods folder.
 */

/** The three screens this sample has a better way to show. */
const TAKES = ["core:inventory", "core:equipment", "core:quiver"];

const BACKDROP = "rgba(8, 10, 16, 0.94)";
const CARD = "#151a24";
const CARD_EDGE = "#39415a";
const EMPTY_EDGE = "#2a3042";
const INK = "#d7dde8";
const INK_DIM = "#78829a";

const CARD_W = 168;
const CARD_H = 84;
const GAP = 12;
const TOP = 64;

/**
 * The first `table` block of a view, or null.
 *
 * A view is a list of blocks and a presenter should look for the kind it can
 * draw rather than assume position - a screen that grows a caption or a note
 * block later must not silently start drawing the wrong thing.
 */
function tableOf(view) {
  for (const block of view.blocks) if (block.kind === "table") return block;
  return null;
}

/**
 * The stack weight in pounds, from the NUMBER rather than from the text.
 *
 * Checked on the CELL first and then on the ROW, because those are two different
 * statements: the inventory has a weight column and publishes the number behind
 * it, while the quiver has no weight column at all and publishes the number
 * anyway. A presenter that only looked at cells would silently lose the weight on
 * the one screen where the terminal cannot show it either.
 */
function poundsOf(row) {
  const cell = row.cells.weight ? row.cells.weight.values : undefined;
  const values = cell && typeof cell.total === "number" ? cell : row.values;
  if (!values || typeof values.total !== "number") return null;
  return values.total / 10;
}

function drawCard(g, x, y, row) {
  const empty = row.semantic && row.semantic.kind === "slot";
  g.fillStyle = CARD;
  g.fillRect(x, y, CARD_W, CARD_H);
  g.strokeStyle = empty ? EMPTY_EDGE : CARD_EDGE;
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, CARD_W - 1, CARD_H - 1);

  /* The sprite a real tileset mod would draw goes here; a swatch in the object's
   * own colour stands in for it, so the sample stays free of assets while still
   * showing that the colour survives the seam. */
  g.fillStyle = row.color || INK_DIM;
  g.fillRect(x + 10, y + 10, 28, 28);

  g.font = "12px monospace";
  g.fillStyle = empty ? INK_DIM : INK;
  const slot = row.cells.slot ? row.cells.slot.text : "";
  if (slot) {
    g.fillStyle = INK_DIM;
    g.fillText(slot, x + 48, y + 22);
    g.fillStyle = empty ? INK_DIM : INK;
  }
  g.fillText(row.cells.name.text.slice(0, 22), x + 48, y + (slot ? 38 : 26));

  const pounds = poundsOf(row);
  if (pounds !== null) {
    g.fillStyle = INK_DIM;
    g.fillText(`${pounds.toFixed(1)} lb`, x + 48, y + 58);
  }
  if (row.tag) {
    g.fillStyle = INK_DIM;
    g.fillText(`${row.tag})`, x + 10, y + 58);
  }
}

export default {
  api: 1,

  screen(ctx) {
    /* No DOM means no cards. Declining is the right answer on a host this cannot
     * draw on; THROWING would cost the mod the seam for the whole session. */
    if (typeof document === "undefined" || !document) return undefined;

    let canvas = null;
    let g = null;

    const mount = () => {
      if (canvas) return true;
      canvas = document.createElement("canvas");
      canvas.id = "sprite-inventory";
      canvas.style.position = "fixed";
      canvas.style.inset = "0";
      canvas.style.zIndex = "45";
      g = canvas.getContext("2d");
      if (!g) return false;
      document.body.appendChild(canvas);
      return true;
    };

    return {
      show(view) {
        if (!TAKES.includes(view.id)) return undefined;
        const block = tableOf(view);
        if (!block) return undefined;
        if (!mount()) return undefined;

        const width = (typeof window !== "undefined" && window.innerWidth) || 960;
        const height = (typeof window !== "undefined" && window.innerHeight) || 600;
        canvas.width = width;
        canvas.height = height;
        canvas.style.display = "block";

        g.fillStyle = BACKDROP;
        g.fillRect(0, 0, width, height);
        g.font = "16px monospace";
        g.fillStyle = INK;
        g.fillText(view.title, 24, 32);

        if (block.rows.length === 0 && block.empty) {
          g.font = "13px monospace";
          g.fillStyle = block.empty.color || INK_DIM;
          g.fillText(block.empty.text, 24, TOP);
        } else {
          const perRow = Math.max(1, Math.floor((width - 24) / (CARD_W + GAP)));
          block.rows.forEach((row, i) => {
            const x = 24 + (i % perRow) * (CARD_W + GAP);
            const y = TOP + Math.floor(i / perRow) * (CARD_H + GAP);
            drawCard(g, x, y, row);
          });
        }

        g.font = "12px monospace";
        g.fillStyle = INK_DIM;
        g.fillText(view.footer, 24, height - 20);

        /* Resolving this is the whole contract. A presenter that forgets is a
         * game the player cannot get back to, which is worse than one that never
         * took the screen at all. */
        let done = () => {};
        const dismissed = new Promise((resolve) => (done = resolve));
        const onKey = (ev) => {
          if (ev.key !== "Escape" && ev.key !== "Enter" && ev.key !== " ") return;
          if (ev.preventDefault) ev.preventDefault();
          if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
          document.removeEventListener("keydown", onKey, true);
          canvas.style.display = "none";
          done();
        };
        document.addEventListener("keydown", onKey, true);
        ctx.log("showing " + view.id + " as cards");
        return { dismissed };
      },
    };
  },
};
