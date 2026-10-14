import { type GridSurface, type GridPointerInput } from "../term";
import { type ModManagerDeps } from "./classic-types";
import { showTextScreen } from "../overlay";
import { type ConflictReportLines } from "../mod-conflicts";
import { type ScreenView, type ScreenBlock, freezeView, SCREEN_FOOTER, type ScreenRow } from "../screen-view";
import { t } from "@rpgm-tools/neo-angband-core";
import { C_WARN, C_FG, C_DIM, C_ENABLED, C_DANGER } from "./classic-colors";
import { type ModHealthStats, DEFAULT_TURN_BUDGET_MS, FAULT_LIMIT, FAULT_WINDOW_TURNS } from "../mod-health";
import { type ContestedSlot, type RecordConflict } from "@rpgm-tools/neo-angband-mod-sdk";

/**
 * The conflicts viewer, over every composition layer.
 *
 * THREE GROUPS, because they need three different amounts of attention and a
 * flat list taught the player that none of them did:
 *
 *  - what an AUTHOR DECLARED. A human wrote a reason; it is the only group that
 *    might mean "do not run these together", and it still never blocks.
 *  - what is CONTESTED: somebody's contribution is being discarded. This is the
 *    group with a decision in it.
 *  - what COMBINES: several mods touching one thing and all of them taking
 *    effect. Listed so the picture is complete, kept last so it does not bury
 *    the group above.
 */
export async function viewConflicts(term: GridSurface & GridPointerInput, deps: ModManagerDeps): Promise<void> {
  await showTextScreen(term, modConflictsScreen(deps.conflictLines()));
}

/**
 * The conflicts viewer as a document: three groups, each a TABLE of records.
 *
 * WHAT CHANGED, AND WHERE. This screen was `lines` because its producer destroyed
 * the structure one module earlier - `conflictLines` mapped every `ContestedSlot`
 * through `describeContested` and handed over three `string[]`, so the slot, its
 * fold, the winner and the mods that lost were gone before any screen saw them. They
 * now travel beside the sentences (`ConflictRow`), and a group of one-row-per-record
 * is exactly what a table is for.
 *
 * ONE VISIBLE COLUMN, AND THAT IS NOT A COSTUME. The sentence stays whole in `what`
 * because it is the rendering that shipped and it must not move; everything a
 * presenter would act on - which layer, which fold, who won, who lost - rides on
 * `semantic.data` beside it, exactly as the update report carries `ModRefresh`. The
 * sentence is DERIVED from `describeContested` rather than re-worded here: six folds'
 * wording lives in the SDK and a second copy would rot.
 *
 * THE PROSE BETWEEN THE GROUPS STAYS `lines`, by the rule rather than for
 * convenience. Those are hand-broken constants the screen has already laid out, and
 * the blank rows between groups carry a colour that `gapAfter` does not emit.
 *
 * THE CONTENT LAYER NOW CARRIES ITS OWN RECORD. `modConflictLines` (pack.ts) used
 * to flatten `computeConflictReport`'s field-granular records into plain sentences
 * before this module ever ran, so every content row arrived here as `{ kind:
 * "content-record" }` with NO `ref` - the stopgap that told a presenter "the fields
 * were not published" apart from "this row has nothing to say". That producer now
 * carries the RecordConflict beside the sentence the same way every other layer
 * does, so a content row is `record-conflict` like any other and the stopgap kind
 * is retired.
 *
 * A ROW CAN STILL ARRIVE WITH NO RECORD AT ALL, and is still marked rather than
 * left with an absent `semantic`: `modConflictLines` returns one when
 * resolveLoadOrder throws before a single RecordConflict could be gathered (a
 * duplicate pack id, a missing dependency, an incompatible version range). There
 * is genuinely nothing to attach there, which `{ kind: "unresolved-load-order" }`
 * says plainly rather than reusing the retired content-record kind for a different
 * reason.
 */
export function modConflictsScreen(report: ConflictReportLines): ScreenView {
  const { declaredRows, contestedRows, combinedRows } = report;
  const blocks: ScreenBlock[] = [];

  /* One unpadded column: `pad: false` and no declared `width`, so a row renders as
   * exactly the sentence it always was. A width would line the sentences up under
   * each other, which is a change to the player's screen and not this pass's to
   * make. */
  const oneColumn = [{ key: "what", pad: false }] as const;

  if (declaredRows.length > 0) {
    blocks.push(
      {
        kind: "table",
        key: "declared",
        tagged: false,
        caption: {
          text: t("modsScreen.conflictsScreen.declaredCaption", "The authors said so themselves"),
          color: C_WARN,
        },
        columns: [...oneColumn],
        rows: declaredRows.map(({ text, record }) => ({
          id: `${record.packId}->${record.with}`,
          /* The CLAIMANT is what a presenter acts on: it is the mod whose author
           * wrote this, and the one whose page a "tell me more" would open. */
          semantic: {
            kind: "mod-conflict",
            ref: record.packId,
            data: {
              with: record.with,
              because: record.because,
              scope: record.scope?.join(",") ?? null,
            },
          },
          color: C_FG,
          cells: { what: { text } },
        })),
      },
      {
        kind: "lines",
        lines: [
          { text: "", color: C_DIM },
          {
            text: t(
              "modsScreen.conflictsScreen.nothingBlocked",
              "Nothing here is blocked - you can play any combination you like.",
            ),
            color: C_DIM,
          },
          { text: "", color: C_DIM },
        ],
      },
    );
  }

  if (contestedRows.length > 0) {
    blocks.push(
      {
        kind: "table",
        key: "contested",
        tagged: false,
        caption: {
          text: t("modsScreen.conflictsScreen.contestedCaption", "One of these wins, the rest are ignored"),
          color: C_WARN,
        },
        columns: [...oneColumn],
        rows: contestedRows.map(({ text, record }) => slotRow(text, record, C_FG)),
      },
      { kind: "lines", lines: [{ text: "", color: C_DIM }] },
    );
  }

  if (combinedRows.length > 0) {
    blocks.push(
      {
        kind: "table",
        key: "combined",
        tagged: false,
        caption: {
          text: t("modsScreen.conflictsScreen.combinedCaption", "These stack, and need nothing from you"),
          color: C_ENABLED,
        },
        columns: [...oneColumn],
        rows: combinedRows.map(({ text, record }) => slotRow(text, record, C_DIM)),
      },
      { kind: "lines", lines: [{ text: "", color: C_DIM }] },
    );
  }

  if (blocks.length === 0) {
    blocks.push({
      kind: "lines",
      lines: [
        {
          text: t(
            "modsScreen.conflictsScreen.nothingContests",
            "Nothing among your enabled mods contests anything else.",
          ),
          color: C_ENABLED,
        },
      ],
    });
  }

  return freezeView({
    id: "core:mod-conflicts",
    title: t("modsScreen.conflictsScreen.title", "Mod conflicts"),
    footer: SCREEN_FOOTER,
    blocks,
  });
}

/** Bytes as the profiler shows them: "-" where nothing was measured. */
export function profilerBytes(bytes: number | null): string {
  if (bytes === null) return "-";
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The Mod performance screen: one row per mod whose code has run this session,
 * busiest first, with its calls, CPU time, worst single call, faults, turns over
 * budget, Worker data sent, and whether it is still on.
 *
 * `nameOf` gives a mod's proper name; a mod with none is listed by its id, as
 * the mod list does.
 */
export function modProfilerScreen(
  stats: readonly ModHealthStats[],
  nameOf: (id: string) => string | undefined,
): ScreenView {
  const rows = [...stats]
    .sort((a, b) => b.cpuMs - a.cpuMs)
    .map((s) => {
      const off = s.switchedOff !== null;
      return {
        id: s.id,
        semantic: { kind: "mod", ref: s.id },
        color: off ? C_DANGER : s.faults > 0 || s.overBudget > 0 ? C_WARN : C_FG,
        cells: {
          mod: { text: nameOf(s.id) ?? s.id },
          calls: { text: String(s.calls) },
          cpu: { text: s.cpuMs.toFixed(1) },
          worst: { text: s.worstMs.toFixed(1) },
          reply: { text: s.replies === 0 ? "-" : (s.replyMs / s.replies).toFixed(1) },
          net: { text: s.netMs === null ? "-" : s.netMs.toFixed(0) },
          faults: { text: String(s.faults) },
          slow: { text: String(s.overBudget) },
          sent: { text: profilerBytes(s.payloadBytes) },
          status: {
            text: off
              ? t("modsScreen.profiler.off", "off")
              : t("modsScreen.profiler.on", "on"),
          },
        },
      };
    });
  const note = (text: string): { text: string; color: string }[] => [{ text, color: C_DIM }];
  return freezeView({
    id: "core:mod-profiler",
    title: t("modsScreen.profiler.title", "Mod performance"),
    footer: SCREEN_FOOTER,
    blocks: [
      {
        kind: "table",
        key: "mods",
        tagged: false,
        columns: [
          { key: "mod", label: t("modsScreen.profiler.mod", "Mod"), width: 14 },
          { key: "calls", label: t("modsScreen.profiler.calls", "Calls"), width: 6, align: "right" },
          { key: "cpu", label: t("modsScreen.profiler.cpu", "CPU ms"), width: 7, align: "right" },
          { key: "worst", label: t("modsScreen.profiler.worst", "Worst"), width: 6, align: "right" },
          { key: "reply", label: t("modsScreen.profiler.reply", "Reply"), width: 6, align: "right" },
          { key: "net", label: t("modsScreen.profiler.net", "Net ms"), width: 7, align: "right" },
          { key: "faults", label: t("modsScreen.profiler.faults", "Faults"), width: 6, align: "right" },
          { key: "slow", label: t("modsScreen.profiler.slow", "Slow"), width: 5, align: "right" },
          { key: "sent", label: t("modsScreen.profiler.sent", "Sent"), width: 8, align: "right" },
          { key: "status", label: t("modsScreen.profiler.status", "Status"), pad: false },
        ],
        rows,
        empty: { text: t("modsScreen.profiler.empty", "No mod code has run this session."), color: C_DIM },
        gapAfter: 1,
      },
      {
        kind: "text",
        color: C_DIM,
        paragraphs: [
          note(
            t(
              "modsScreen.profiler.cpuNote",
              "CPU ms is the time each mod's own code has taken this session. Worst is its longest single call.",
            ),
          ),
          note(
            t(
              "modsScreen.profiler.workerNote",
              "Reply is a Worker mod's average time to answer the game, and Net ms the time its network requests have waited. Neither counts as CPU time.",
            ),
          ),
          note(
            t(
              "modsScreen.profiler.slowNote",
              "Slow counts turns where a mod took more than its {ms} ms share. Sent is the data a Worker mod has passed to the game.",
              { ms: String(DEFAULT_TURN_BUDGET_MS) },
            ),
          ),
          note(
            t(
              "modsScreen.profiler.offNote",
              "A mod that fails {limit} times within {turns} turns is switched off until the game next starts.",
              { limit: String(FAULT_LIMIT), turns: String(FAULT_WINDOW_TURNS) },
            ),
          ),
        ],
      },
    ],
  });
}

/**
 * One contested or combining row.
 *
 * `losers` is published as well as `claims` because it is the question the screen
 * exists to answer - "whose work is being thrown away" - and deriving it from
 * `claims` minus `winner` is a rule about the fold that a presenter should not have
 * to know. Empty for a combining fold, where nobody loses.
 *
 * THREE SHAPES OF `record` NOW, not two: a `ContestedSlot` for the four layers
 * `layerSlots` derives, a `RecordConflict` for the content layer's own rows
 * (pack.ts's modConflictLines), and `null` for the one row that producer still
 * cannot attach anything to. Discriminated on a field unique to each - `file` is
 * on every `RecordConflict` and no `ContestedSlot` - rather than by which array the
 * row came from, so this stays correct regardless of how the caller assembled
 * `contestedRows`/`combinedRows`.
 */
export function slotRow(
  text: string,
  record: ContestedSlot | RecordConflict | null,
  color: string,
): ScreenRow {
  const cells = { what: { text } };
  if (record === null) {
    /* modConflictLines could not even attempt composition: resolveLoadOrder threw
     * (a duplicate pack id, a missing dependency, an incompatible version range)
     * before a single RecordConflict existed to gather. Marked rather than left
     * with no semantic at all, so a presenter can tell "the game could not compose
     * this set" from "this row has nothing to say". */
    return { semantic: { kind: "unresolved-load-order" }, color, cells };
  }
  if ("file" in record) {
    return {
      id: record.ref,
      semantic: {
        kind: "record-conflict",
        ref: record.ref,
        data: {
          file: record.file,
          contributingPacks: record.contributingPacks.join(","),
          /* Only the fields that actually COLLIDED - two packs writing the same
           * field with an order-dependent op - not every field any contributor
           * merely touched, which would bury the one question this row answers
           * under every additive field a mod added alongside it. */
          collidingFields: record.collisions.map((c) => c.path).join(","),
          overriddenBy: record.override?.pack ?? null,
          overrideKind: record.override?.kind ?? null,
        },
      },
      color,
      cells,
    };
  }
  const claims = record.claims.map((c) => c.packId);
  return {
    id: record.key,
    semantic: {
      kind: "contested-slot",
      ref: record.key,
      data: {
        layer: record.layer,
        fold: record.fold,
        what: record.what,
        winner: record.winner ?? null,
        claims: claims.join(","),
        /* Empty when the fold picks nobody. Filtering `claims` against an undefined
         * winner would keep every one of them and report a combining slot - where
         * every contribution runs - as a slot where everybody lost. */
        losers:
          record.winner === undefined
            ? ""
            : claims.filter((id) => id !== record.winner).join(","),
      },
    },
    color,
    cells,
  };
}
