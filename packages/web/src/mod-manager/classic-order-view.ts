import { type SortResult } from "@rpgm-tools/neo-angband-mod-sdk";
import { type ScreenView, type ScreenBlock, freezeView, SCREEN_FOOTER } from "../screen-view";
import { t } from "@rpgm-tools/neo-angband-core";
import { C_TITLE, C_WARN, C_FG, C_DIM, C_DANGER } from "./classic-colors";

/**
 * The auto-sort proposal as a document: a RANKED LIST the player is being asked to
 * accept, plus what the sorter had to give up to produce it.
 *
 * THE ORDER IS THE SCREEN, and it was the part least reachable. A proposed load
 * order is the one listing in this manager a real mod-manager UI wants as rows it
 * can drag: the rank belongs in `values`, the mod belongs on `semantic.ref`, and
 * "this one moved" belongs beside them rather than inside a string that reads
 * `  3. Quality of Life   <- moved`. `rank`'s width is 5 because that is the field
 * the terminal writes - two columns of margin, two of number, and the point - which
 * is also why it does not clamp until a player has ten thousand mods enabled, where
 * the `padStart(2)` it replaces never clamped at all.
 *
 * THE MOVED FLAG IS A BOOLEAN ON `semantic.data`, NOT A NUMBER IN `values`, which is
 * the one place this disagrees with the brief it was built from. `ScreenValues` is
 * `Record<string, number>`, so a flag would have to go in as 0/1 - a boolean
 * pretending to be a quantity, in the field the HUD's proportion convention reads.
 * `semantic.data` takes booleans and is already where a presenter looks for what a
 * row IS, so the flag goes there and the visible marker stays a cell.
 *
 * THE DROPPED SUGGESTIONS ARE A TABLE NOW TOO, with `ScreenRow.detail`: the
 * author's reason is a cell, and the cycle that forced the drop - "A -> B -> A" -
 * is the row's paragraph rather than a second row at a deeper indent sharing the
 * first row's identity. The ids behind that cycle are on `semantic.data`, exactly
 * as the unresolvable table below already publishes them.
 */
export function autoSortScreen(
  result: SortResult,
  current: readonly string[],
  nameOf: (id: string) => string,
): ScreenView {
  const unchanged = result.order.every((id, i) => current[i] === id);
  const blocks: ScreenBlock[] = [
    {
      kind: "table",
      key: "order",
      tagged: false,
      caption: {
        text: unchanged
          ? t("modsScreen.autoSort.alreadyInOrder", "Already in order:")
          : t("modsScreen.autoSort.proposedOrder", "Proposed order:"),
        color: C_TITLE,
      },
      columns: [
        { key: "rank", width: 5, align: "right" },
        /* Unpadded: the names were never lined up under each other, and padding
         * them would move the "<- moved" markers into a column of their own. */
        { key: "name", pad: false },
        { key: "moved", gap: 3, pad: false },
      ],
      rows: result.order.map((id, i) => {
        const moved = current[i] !== id;
        return {
          id,
          semantic: { kind: "mod", ref: id, data: { moved } },
          color: moved ? C_WARN : C_FG,
          values: { rank: i + 1 },
          cells: {
            rank: { text: `${String(i + 1)}.` },
            name: { text: nameOf(id) },
            moved: { text: moved ? t("modsScreen.autoSort.movedMarker", "<- moved") : "" },
          },
        };
      }),
    },
    {
      kind: "lines",
      lines: [
        { text: "", color: C_DIM },
        { text: t("modsScreen.autoSort.laterWins", "Later mods win conflicts."), color: C_DIM },
      ],
    },
  ];

  if (result.dropped.length > 0) {
    blocks.push(
      {
        kind: "lines",
        lines: [
          { text: "", color: C_DIM },
          {
            text: t("modsScreen.autoSort.suggestionsDropped", "Suggestions it could not honour"),
            color: C_WARN,
          },
        ],
      },
      {
        kind: "table",
        key: "dropped",
        tagged: false,
        columns: [
          { key: "indent", width: 2 },
          /* gap:0 for the same reason the unresolvable table's `mods` column is:
           * the indent column already put two spaces in front, and a second gap
           * would put three. */
          { key: "reason", gap: 0, pad: false },
        ],
        rows: result.dropped.map((d, i) => ({
          id: `dropped:${String(i)}`,
          /* The ids a presenter would otherwise have to read out of "A -> B -> A" -
           * exactly as the unresolvable table already publishes them. */
          semantic: { kind: "mod-cycle-dropped", data: { ids: d.cycle.join(",") } },
          color: C_FG,
          /* The REASON, not just the pair: an author wrote it, and it is the only
           * thing that tells the player whether the drop matters to them. */
          cells: { reason: { text: d.reason } },
          detail: {
            indent: 4,
            paragraphs: [
              [
                {
                  text: t(
                    "modsScreen.autoSort.droppedReason",
                    "dropped - it would need {chain} -> {first}",
                    {
                      chain: d.cycle.map(nameOf).join(" -> "),
                      first: nameOf(d.cycle[0] ?? ""),
                    },
                  ),
                },
              ],
            ],
            color: C_DIM,
          },
        })),
      },
    );
  }

  if (result.unresolvable.length > 0) {
    blocks.push(
      { kind: "lines", lines: [{ text: "", color: C_DIM }] },
      {
        kind: "table",
        key: "unresolvable",
        tagged: false,
        caption: {
          text: t("modsScreen.autoSort.cannotAllLoad", "These mods cannot all load"),
          color: C_DANGER,
        },
        columns: [
          { key: "indent", width: 2 },
          { key: "mods", gap: 0, pad: false },
          /* The verdict is the same sentence on every row, and it is a cell rather
           * than the tail of the names so that the NAMES are addressable on their
           * own - a presenter listing an impossible set wants the mods, not a
           * sentence it has to cut in half to get at them. */
          { key: "note", pad: false },
        ],
        rows: result.unresolvable.map((cycle, i) => ({
          id: `cycle:${String(i)}`,
          semantic: { kind: "mod-cycle", data: { ids: cycle.join(",") } },
          color: C_FG,
          cells: {
            mods: { text: cycle.map(nameOf).join(" and ") },
            note: { text: t("modsScreen.autoSort.eachRequireOther", "each require the other.") },
          },
        })),
      },
      {
        kind: "lines",
        lines: [
          {
            text: t(
              "modsScreen.autoSort.turnOneOff",
              "  Turn one of them off; no order can satisfy both.",
            ),
            color: C_DIM,
          },
        ],
      },
    );
  }

  return freezeView({
    id: "core:mod-auto-sort",
    title: t("modsScreen.autoSort.title", "Auto-sort"),
    footer: SCREEN_FOOTER,
    blocks,
  });
}
