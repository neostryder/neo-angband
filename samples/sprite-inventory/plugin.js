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
 * IT ALSO READS THE PROSE PAGES, and differently on purpose. `core:object-recall`
 * and its two siblings arrive as a `text` block - paragraphs of coloured runs,
 * UNWRAPPED - so this sample lays them out into a 360px panel by MEASURING them,
 * which is the one thing a pre-wrapped `ScreenLine[]` cannot be asked to do: a
 * row broken at 79 characters cannot be re-flowed to a different width without
 * first undoing the game's wrap and guessing which breaks were the game's and
 * which were the sentence's.
 *
 * AND IT DRAWS THE TOMBSTONE AS A STONE. `core:tombstone` arrives as an `art`
 * block whose `lines` are the picture and whose `fields` are the epitaph - the
 * name, class, level, gold and killing blow, each with its number beside its
 * text. Upstream burns those into columns 8-39 of the ASCII stone; published
 * apart, this sample draws its own stone and writes the character onto it, and
 * never touches `lines` at all. That is the difference between "swap the
 * picture" and "reimagine the screen".
 *
 * IT DECLINES THE REST. The character sheet, the knowledge browser and the
 * message history are still the game's own - and still work. That is the seam
 * working: this mod says what it has a better way to draw, and nothing else.
 *
 * NO IMPORTS, deliberately. A folder plugin gets the engine passed in through
 * `ctx` and nothing else is resolvable from a mods folder.
 */

/** The three listings this sample draws as cards. */
const TAKES = ["core:inventory", "core:equipment", "core:quiver"];

/* ------------------------------------------------------------------------- *
 * THE REGION: furniture of this mod's OWN, beside the live map.
 *
 * WHAT IS DIFFERENT FROM EVERYTHING ELSE IN THIS FILE, and it is the whole
 * point of `ModPlugin.regions`. `screen()` above takes screens the GAME already
 * shows and shows them better - the inventory was always there, and this mod
 * redraws it. A region is a rectangle that DID NOT EXIST until this mod asked
 * for one, and it is on screen while the player is walking around rather than
 * only while a screen is open. That is why it is a separate capability:
 * `ui:screen.replace` says "you may draw the inventory instead of the game" and
 * `ui:region.create` says "you may put something of your own on the player's
 * screen", and a player agreeing to the first has not agreed to the second.
 * `ui:*.replace` does not cover it either, for exactly that reason.
 *
 * WHAT IT DRAWS is the last listing this mod was shown - so after you have
 * opened your pack once, what you are carrying stays readable beside the map
 * instead of behind a keypress. Nothing here reaches into the game: the rows
 * are the ones `show(view)` was already handed.
 *
 * WHY IT IS RIGHT-ANCHORED, and it is not a taste decision. A region whose
 * right edge is not the terminal's needs a host that can bound an erase
 * (`eraseSpan`), because the alternative is erasing with SPACES - and a space
 * is a glyph that occludes, so a floating panel that erased with spaces would
 * punch a white hole in the map it is meant to be floating over. A host without
 * that call refuses such a region at the door rather than lying about what was
 * drawn. Anchoring to the right edge means the unbounded erase IS the bounded
 * one, so this panel works on every host. It is also what upstream's own
 * `show_obj_list` does with an item list (ui-object.c:418-422).
 *
 * IT IS IN THE `overlay` BAND, not `modal`. Overlay is furniture that sits over
 * the map and under anything that wants the player's attention; modal is for
 * something that has taken it. A panel that outranked the game's own screens
 * would still be sitting there over the middle of the knowledge browser.
 * `system` is not offered to mods at all - see the SDK's `ModRegionLayer` - so
 * that the mod manager can always be drawn above a mod that has gone wrong.
 * ------------------------------------------------------------------------- */

/** Widest the strip will ever be. Narrow enough to leave a usable map. */
const STRIP_W = 24;
/** Most rows of items it will show, before its own title row. */
const STRIP_ROWS = 8;

const STRIP_INK = "#d7dde8";
const STRIP_DIM = "#78829a";

/**
 * The last listing this mod was shown, as `{ tag, name, color }` rows.
 *
 * Module-level rather than passed between the two hooks, because `screen()` and
 * `regions()` are two calls on this one object and the host makes them
 * independently. Kept SMALL and already-formatted: `paint()` runs once a frame,
 * so anything it would have had to compute is computed here instead, once, when
 * the listing actually changed.
 */
let carried = [];
let carriedTitle = "Carried";

/** Remember a listing this mod was just handed, for the strip to draw. */
function rememberCarried(view) {
  const block = tableOf(view);
  if (!block) return;
  carriedTitle = view.title || "Carried";
  carried = block.rows.slice(0, STRIP_ROWS).map((row) => ({
    tag: row.tag || "",
    name: row.cells.name ? row.cells.name.text : "",
    color: row.color || STRIP_INK,
  }));
}

/**
 * The prose pages it draws as a panel, re-wrapped to its OWN width - the three
 * inspect pages plus the knowledge browser's seven recalls, which gave up their
 * model in step 5b-v. Nothing in the panel changed to take them: a `text` block
 * is a `text` block, which is the point of a model with a small vocabulary.
 */
const READS = [
  "core:object-recall",
  "core:object-comparison",
  "core:monster-recall",
  "core:rune-recall",
  "core:feature-recall",
  "core:trap-recall",
  "core:shape-recall",
  "core:artifact-recall",
  "core:ego-recall",
  "core:object-kind-recall",
];

/** The character sheet's two pages, which it draws as panels AND acts on. */
const SHEET = ["core:character", "core:character-flags"];

/**
 * The visible-monster list, drawn as a radar rather than as a list.
 *
 * It is here because it is the screen where reading NUMBERS instead of text pays
 * most obviously: `values.dy`/`values.dx` are the offset, so this draws an arrow
 * pointing at the monster, and no arrow can be recovered from the string "3 N 2
 * W" without parsing a compass back into a vector. `values.asleep` is a count
 * where the terminal has the sentence "(2 asleep)".
 *
 * It also has an ACTION - 'x' flips the sort between depth and experience - and a
 * presenter that took this screen without reaching it would quietly take the
 * command away from the player. The same `host.invoke` the character sheet uses.
 */
const WATCH = ["core:monster-list"];

/**
 * The four help pages, drawn as a legend rather than as a page of text.
 *
 * THE GLYPH IS A CELL, and that is why this page was worth taking. The symbols
 * legend publishes `cells.glyph.text` as ONE character, which is exactly the key
 * a tileset mod already indexes its atlas by for the map - so a mod with art
 * draws the same sprite here that the player sees on the floor, and the legend
 * stops being a list of letters. This sample ships no art, so it prints the
 * lookup key itself (`U+006B` for `k`), which is a string the game writes
 * nowhere and which nothing but a one-character cell could have produced.
 *
 * The commands page is the same shape with `cells.key`, so a keycap can be drawn
 * where the terminal pads a field eleven wide; the community page's three routes
 * are one-row tables whose `cells.address` a presenter with a browser would hang
 * a link on; and the playing guide is prose, so it reaches the same panel the
 * recall pages do.
 *
 * WHAT IT DOES NOT TAKE, on the same page. symbols.txt's opening paragraphs stay
 * on `lines` because upstream hand-wrapped that file and the port prints it
 * verbatim - so this sample skips them, which is precisely what a `lines` block
 * means. Nothing here can reimagine rows that arrived already broken at the
 * terminal's width.
 */
const HELP = [
  "core:help-commands",
  "core:help-symbols",
  "core:help-guide",
  "core:help-community",
];

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

/** The first `text` block of a view, or null. Same rule as `tableOf`. */
function textOf(view) {
  for (const block of view.blocks) if (block.kind === "text") return block;
  return null;
}

/**
 * One paragraph laid out to a PIXEL width, carrying each run's colour.
 *
 * This is the thing `lines` could not give and `paragraphs` can. A `lines` block
 * arrives already broken at the terminal's width, so a panel of a different width
 * - or a proportional font, where "80 characters" is not a width at all - can
 * only re-flow it by undoing the game's wrap first and hoping no sentence
 * genuinely ended at a row boundary. Given the paragraph, there is nothing to
 * undo: measure and break.
 */
function layOut(g, paragraph, maxPx) {
  const out = [];
  let line = [];
  let used = 0;
  for (const run of paragraph) {
    for (const word of run.text.split(" ")) {
      if (word === "") continue;
      const piece = (line.length === 0 ? "" : " ") + word;
      const w = g.measureText(piece).width;
      if (line.length > 0 && used + w > maxPx) {
        out.push(line);
        line = [];
        used = 0;
        used += g.measureText(word).width;
        line.push({ text: word, color: run.color });
        continue;
      }
      used += w;
      const last = line[line.length - 1];
      if (last && last.color === run.color) last.text += piece;
      else line.push({ text: piece, color: run.color });
    }
  }
  if (line.length > 0) out.push(line);
  return out.length > 0 ? out : [[]];
}

function drawProse(g, block, x, y, maxPx, lineH) {
  let row = y;
  for (const paragraph of block.paragraphs) {
    for (const line of layOut(g, paragraph, maxPx)) {
      let px = x;
      for (const run of line) {
        g.fillStyle = run.color || block.color || INK;
        g.fillText(run.text, px, row);
        px += g.measureText(run.text).width;
      }
      row += lineH;
    }
  }
  return row;
}

/** The first `art` block of a view, or null. Same rule as `tableOf`. */
function artOf(view) {
  for (const block of view.blocks) if (block.kind === "art") return block;
  return null;
}

/**
 * The tombstone as a drawn stone with the epitaph written on it - none of the
 * ASCII, all of the character.
 *
 * The only reason this is possible is that `fields` arrives beside `lines`
 * rather than inside them. Upstream burns the name into columns 8-39 of row 7
 * of the picture; a mod handed the finished picture would have to know that,
 * and would break the first time the stone was redrawn one column wider.
 */
function drawTomb(g, block, x, y, w) {
  const at = (key) => {
    const f = (block.fields || []).find((each) => each.key === key);
    return f ? f.text : "";
  };
  const h = 260;
  g.fillStyle = CARD;
  g.beginPath();
  g.moveTo(x, y + h);
  g.lineTo(x, y + 70);
  g.arc(x + w / 2, y + 70, w / 2, Math.PI, 0);
  g.lineTo(x + w, y + h);
  g.closePath();
  g.fill();
  g.strokeStyle = CARD_EDGE;
  g.lineWidth = 2;
  g.stroke();

  const mid = x + w / 2;
  g.textAlign = "center";
  g.font = "17px monospace";
  g.fillStyle = INK;
  g.fillText(at("name"), mid, y + 78);
  g.font = "13px monospace";
  g.fillStyle = INK_DIM;
  g.fillText(at("title") + " " + at("class"), mid, y + 102);

  /* The numbers come from `values`, not from parsing "Level: 3" back apart. */
  const num = (key, name) => {
    const f = (block.fields || []).find((each) => each.key === key);
    return f && f.values && typeof f.values[name] === "number" ? f.values[name] : null;
  };
  g.font = "13px monospace";
  g.fillStyle = INK;
  g.fillText("lvl " + num("level", "level") + "  " + num("gold", "gold") + " au", mid, y + 134);
  g.fillStyle = INK_DIM;
  g.fillText(at("death"), mid, y + 162);
  if (at("killer")) g.fillText(at("killer"), mid, y + 182);
  g.fillText(at("date"), mid, y + 212);
  g.textAlign = "left";
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

/** Every `table` block of a view, in order. The monster list has two sections. */
function tablesOf(view) {
  const out = [];
  for (const block of view.blocks) if (block.kind === "table") out.push(block);
  return out;
}

/** The eight-point arrow for an offset, from the NUMBERS rather than "3 N 2 W". */
function arrowFor(dy, dx) {
  const v = Math.abs(dy) > Math.abs(dx) / 2 ? (dy <= 0 ? -1 : 1) : 0;
  const h = Math.abs(dx) > Math.abs(dy) / 2 ? (dx <= 0 ? -1 : 1) : 0;
  if (v === -1) return h === -1 ? "↖" : h === 1 ? "↗" : "↑";
  if (v === 1) return h === -1 ? "↙" : h === 1 ? "↘" : "↓";
  return h === -1 ? "←" : h === 1 ? "→" : "●";
}

/**
 * One monster as a card: the glyph in its own colour, the game's OWN pluralised
 * name, and the offset as an arrow with its range.
 *
 * The name comes from `semantic.data.name`, not from `cells.name.text`. The cell
 * is what the terminal draws - clipped to the column, right-justified into a
 * 3-wide count field and with "(2 asleep)" appended - and this panel is a
 * different width with a separate place to show the sleepers, so it wants the
 * label the game generated rather than the one the terminal cut down.
 * `semantic.ref` is the race, which is what a real tileset mod looks a sprite
 * up by, and the label still carries the game's own pluralisation.
 */
function drawMonsterCard(g, x, y, row) {
  const v = row.values || {};
  g.fillStyle = CARD;
  g.fillRect(x, y, CARD_W, CARD_H);
  g.strokeStyle = CARD_EDGE;
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, CARD_W - 1, CARD_H - 1);

  /* The glyph cell has a colour of its OWN - the race's attr, which is not the
   * row's line colour (that one encodes danger). Both survive the seam. */
  const glyph = row.cells.glyph;
  g.font = "22px monospace";
  g.fillStyle = (glyph && glyph.color) || row.color || INK;
  g.fillText(glyph ? glyph.text : "?", x + 12, y + 32);

  g.font = "12px monospace";
  g.fillStyle = row.color || INK;
  const name = (row.semantic && row.semantic.data && row.semantic.data.name) || "";
  g.fillText(String(name).slice(0, 20), x + 42, y + 26);

  g.fillStyle = INK_DIM;
  if (typeof v.dy === "number" && typeof v.dx === "number") {
    const range = Math.max(Math.abs(v.dy), Math.abs(v.dx));
    g.fillText(`${arrowFor(v.dy, v.dx)} ${range}`, x + 42, y + 46);
  }
  if (v.asleep) g.fillText(`${v.asleep} asleep`, x + 42, y + 64);
}

/** Both sections of the monster list, each captioned, as grids of cards. */
function drawMonsters(g, view, x, y, width) {
  let cy = y;
  for (const block of tablesOf(view)) {
    g.font = "13px monospace";
    if (block.rows.length === 0) {
      g.fillStyle = (block.empty && block.empty.color) || INK_DIM;
      g.fillText(block.empty ? block.empty.text : "", x, cy);
      cy += 28;
      continue;
    }
    if (block.caption) {
      g.fillStyle = block.caption.color || INK;
      g.fillText(block.caption.text, x, cy);
      cy += 20;
    }
    const perRow = Math.max(1, Math.floor((width - x) / (CARD_W + GAP)));
    block.rows.forEach((row, i) => {
      drawMonsterCard(
        g,
        x + (i % perRow) * (CARD_W + GAP),
        cy + Math.floor(i / perRow) * (CARD_H + GAP),
        row,
      );
    });
    cy += Math.ceil(block.rows.length / perRow) * (CARD_H + GAP) + 8;
  }
}

/**
 * The character sheet, as panels rather than as a page of columns.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE LISTINGS. A stat row is not a line of text
 * with a number somewhere in it: `cells.eb.values.bonus` is the equipment bonus
 * as an INTEGER, so this draws it as a bar whose length is the number - something
 * no amount of re-reading "STR!  18/100  +1  +0  +2" could have given. A panel row
 * answers to `row.id` (`level`, `hp`, `turns-used`), so the label and the value
 * arrive apart and this never looks for a colon.
 *
 * On the flag page the COLUMNS are the equipment slots, each carrying the worn
 * item's glyph in `column.glyph` - so the header of this grid is gear, and a mod
 * with real art would draw the item's icon there.
 */
function drawSheet(g, view, x, y, w) {
  let cy = y;
  for (const block of view.blocks) {
    if (block.kind === "text") {
      g.font = "13px monospace";
      cy = drawProse(g, block, x, cy + 6, w, 17) + 10;
      continue;
    }
    if (block.kind !== "table") continue;

    if (block.caption) {
      g.font = "13px monospace";
      g.fillStyle = block.caption.color || INK;
      g.fillText(block.caption.text, x, cy);
      cy += 18;
    }
    /* The slot glyphs, drawn from the COLUMNS - the one place a presenter learns
     * what the character is wearing without being handed an equipment listing. */
    const glyphs = block.columns.filter((c) => c.glyph);
    if (glyphs.length > 0) {
      g.font = "12px monospace";
      glyphs.forEach((c, i) => {
        g.fillStyle = c.glyph.color || INK_DIM;
        g.fillText(c.glyph.text, x + 70 + i * 10, cy);
      });
      cy += 16;
    }
    g.font = "12px monospace";
    for (const row of block.rows) {
      const label = row.cells.label || row.cells.stat;
      if (label) {
        g.fillStyle = (label.color || row.color) || INK;
        g.fillText(label.text.trim(), x, cy);
      }
      const value = row.cells.value || row.cells.self;
      if (value && value.text) {
        g.fillStyle = row.color || INK;
        g.fillText(value.text, x + 100, cy);
      }
      /* A bar as long as the bonus IS the number. There is no way to draw this
       * from a rendered row, which is the whole argument for `values`. */
      const eb = row.cells.eb && row.cells.eb.values;
      if (eb && typeof eb.bonus === "number" && eb.bonus !== 0) {
        g.fillStyle = eb.bonus > 0 ? "#4f9d69" : "#a64b4b";
        g.fillRect(x + 170, cy - 8, Math.abs(eb.bonus) * 8, 8);
      }
      const num = row.cells.value && row.cells.value.values;
      if (num && typeof num.value === "number") {
        g.fillStyle = INK_DIM;
        g.fillText(String(num.value), x + 170, cy);
      }
      if (label || value) cy += 15;
    }
    cy += 6 + (block.gapAfter || 0) * 6;
  }
  return cy;
}

/** The key a tileset mod would look a symbol's sprite up by. */
function spriteKey(glyph) {
  return "U+" + glyph.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0");
}

/**
 * A help page: prose through the panel, every table as a legend.
 *
 * The caption carries a COUNT the terminal cannot show, because the terminal
 * never computed one - `block.rows.length` is a fact about the section that only
 * a table publishes. Rows are matched on which cell they carry rather than on
 * which page they came from, so all four pages take the same walk.
 */
function drawHelp(g, view, x, y, maxPx) {
  let cy = y;
  for (const block of view.blocks) {
    if (block.kind === "text") {
      g.font = "13px monospace";
      cy = drawProse(g, block, x, cy, maxPx, 17) + 12;
      continue;
    }
    if (block.kind !== "table") continue;
    if (block.caption) {
      g.font = "13px monospace";
      g.fillStyle = block.caption.color || INK;
      g.fillText(block.caption.text + " · " + block.rows.length, x, cy);
      cy += 20;
    }
    for (const row of block.rows) {
      const glyph = row.cells.glyph;
      const key = row.cells.key;
      const address = row.cells.address;
      if (glyph) {
        /* The sprite goes here in a mod that has one; the character and its
         * lookup key stand in, so the sample stays free of assets. */
        g.font = "16px monospace";
        g.fillStyle = INK;
        g.fillText(glyph.text, x, cy);
        g.font = "12px monospace";
        g.fillStyle = INK_DIM;
        g.fillText(spriteKey(glyph.text), x + 22, cy);
      } else if (key) {
        g.font = "12px monospace";
        g.fillStyle = INK_DIM;
        g.fillText("[" + key.text + "]", x, cy);
      } else if (address) {
        g.font = "12px monospace";
        g.fillStyle = INK;
        g.fillText(address.text, x, cy);
      }
      const desc = row.cells.desc || row.cells.what;
      if (desc && desc.text) {
        g.font = "12px monospace";
        g.fillStyle = INK;
        g.fillText(desc.text, x + 96, cy);
      }
      cy += 16;
    }
    cy += 8;
  }
  return cy;
}

/** The screen's own commands as buttons: `actions` is the game telling us. */
function drawActions(g, view, x, y) {
  if (!view.actions) return;
  g.font = "12px monospace";
  let cx = x;
  for (const action of view.actions) {
    g.fillStyle = INK_DIM;
    g.fillText(`[${action.key}] ${action.label}`, cx, y);
    cx += 150;
  }
}

export default {
  api: 1,

  /**
   * A rectangle of this mod's own, for as long as the mod is enabled.
   *
   * Returns a LIST, because a mod may have several and one bad entry must cost
   * only that entry. Returning `undefined` declines, which is the right answer
   * on a host this cannot draw on - and unlike `screen()` there is nothing to
   * check for here, because a region draws on the character grid rather than
   * into a canvas, so there is no `document` to be missing.
   */
  regions() {
    return [
      {
        id: "carried",
        layer: "overlay",
        /**
         * RETURN A RECTANGLE AND DO NO WORK. This runs on every layout change,
         * which in this shell means once per frame - so it is arithmetic on
         * three numbers and nothing else. No loop over the items, no reading of
         * anything that could have changed, no allocation beyond the object
         * itself. An author who put a measurement in here would be paying for it
         * on every step the player takes.
         *
         * TOTAL, which matters more than it looks: a rectangle that runs off the
         * grid is refused with a named fault, so every branch here is clamped
         * rather than assumed. The `rows > 2` guard is the one that earns its
         * keep - on a terminal too short for a message line and a status line
         * there is nowhere to be but the top.
         */
        place(grid) {
          const width = Math.min(STRIP_W, grid.cols);
          const top = grid.rows > 2 ? 1 : 0;
          const wanted = Math.min(carried.length, STRIP_ROWS) + 1;
          const rows = Math.max(1, Math.min(wanted, grid.rows - top));
          return { col: grid.cols - width, row: top, cols: width, rows };
        },
        /**
         * Draw. Coordinates are the REGION's, so (0, 0) is this panel's own
         * top-left and `size()` answers this panel's size rather than the
         * terminal's.
         *
         * IT CLEARS FIRST, and that is what makes it opaque. Transparency here
         * is not a flag and not an alpha - it is a cell that was not written -
         * so a panel that wants a background asks for one, and a panel that
         * wants the map showing through simply does not draw those cells. The
         * clear erases THIS RECTANGLE and nothing else; the map either side of
         * it is untouched and is still being drawn by the game underneath.
         */
        paint(surface) {
          const { cols, rows } = surface.size();
          surface.clear();
          surface.print(0, 0, carriedTitle.slice(0, cols), STRIP_DIM);
          for (let i = 0; i < carried.length && i + 1 < rows; i++) {
            const item = carried[i];
            const label = (item.tag ? item.tag + ") " : "") + item.name;
            surface.print(0, i + 1, label.slice(0, cols), item.color);
          }
        },
      },
    ];
  },

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
      show(view, host) {
        const takes = (v) =>
          READS.includes(v.id) ||
          SHEET.includes(v.id) ||
          WATCH.includes(v.id) ||
          HELP.includes(v.id) ||
          v.id === "core:tombstone" ||
          (TAKES.includes(v.id) && tableOf(v) !== null);
        if (!takes(view)) return undefined;
        /* The strip's data, taken from the listing this mod was ALREADY being
         * handed. Done before the mount check on purpose: a host with no canvas
         * declines the screen, and the region still works - it draws on the
         * character grid and needs no DOM at all. */
        if (TAKES.includes(view.id)) rememberCarried(view);
        if (!mount()) return undefined;

        const width = (typeof window !== "undefined" && window.innerWidth) || 960;
        const height = (typeof window !== "undefined" && window.innerHeight) || 600;

        const paint = (v) => {
          canvas.width = width;
          canvas.height = height;
          canvas.style.display = "block";

          g.fillStyle = BACKDROP;
          g.fillRect(0, 0, width, height);
          g.font = "16px monospace";
          g.fillStyle = INK;
          g.fillText(v.title, 24, 32);

          const prose = READS.includes(v.id) ? textOf(v) : null;
          const tomb = v.id === "core:tombstone" ? artOf(v) : null;
          const block = TAKES.includes(v.id) ? tableOf(v) : null;
          if (prose) {
            /* A panel, not the window - so the wrap is this mod's, at a width the
             * game never chose and could not have pre-wrapped for. */
            g.font = "13px monospace";
            drawProse(g, prose, 24, TOP, Math.min(360, width - 48), 17);
          } else if (tomb) {
            drawTomb(g, tomb, Math.max(24, width / 2 - 130), TOP, 260);
          } else if (HELP.includes(v.id)) {
            drawHelp(g, v, 24, TOP, Math.min(420, width - 48));
          } else if (SHEET.includes(v.id)) {
            drawSheet(g, v, 24, TOP, Math.min(420, width - 48));
            drawActions(g, v, 24, height - 44);
          } else if (WATCH.includes(v.id)) {
            /* Hallucination arrives as a `text` block and no table at all, so the
             * prose panel draws it - the same branch the recall pages use. */
            const raving = textOf(v);
            if (raving) drawProse(g, raving, 24, TOP, Math.min(360, width - 48), 17);
            else drawMonsters(g, v, 24, TOP, width);
            drawActions(g, v, 24, height - 44);
          } else if (block && block.rows.length === 0 && block.empty) {
            g.font = "13px monospace";
            g.fillStyle = block.empty.color || INK_DIM;
            g.fillText(block.empty.text, 24, TOP);
          } else if (block) {
            const perRow = Math.max(1, Math.floor((width - 24) / (CARD_W + GAP)));
            block.rows.forEach((row, i) => {
              const x = 24 + (i % perRow) * (CARD_W + GAP);
              const y = TOP + Math.floor(i / perRow) * (CARD_H + GAP);
              drawCard(g, x, y, row);
            });
          }

          g.font = "12px monospace";
          g.fillStyle = INK_DIM;
          g.fillText(v.footer, 24, height - 20);
        };

        let shown = view;
        paint(shown);

        /* Resolving this is the whole contract. A presenter that forgets is a
         * game the player cannot get back to, which is worse than one that never
         * took the screen at all. */
        let done = () => {};
        const dismissed = new Promise((resolve) => (done = resolve));
        const close = () => {
          document.removeEventListener("keydown", onKey, true);
          canvas.style.display = "none";
          done();
        };
        const onKey = (ev) => {
          /* A screen's own commands, run through the host: the rename still opens
           * the GAME's prompt and the dump still writes the game's file. Without
           * this a mod that took the character sheet would quietly take renaming
           * away from the player. `undefined` back means the game wants it. */
          const action =
            shown.actions && host
              ? shown.actions.find((a) => a.key === ev.key)
              : undefined;
          if (action) {
            if (ev.preventDefault) ev.preventDefault();
            if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
            host.invoke(action.id).then((next) => {
              if (!next) return close();
              shown = next;
              paint(shown);
            });
            return;
          }
          if (ev.key !== "Escape" && ev.key !== "Enter" && ev.key !== " ") return;
          if (ev.preventDefault) ev.preventDefault();
          if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
          close();
        };
        document.addEventListener("keydown", onKey, true);
        ctx.log("showing " + view.id + " as cards");
        return { dismissed };
      },
    };
  },
};
