/**
 * effect_summarize_properties (effects-info.c L843-L1087): summarize the object
 * properties an activation's effect chain grants (or conflicts with), so
 * remove_contradictory_activation (obj-randart.c L2420) can drop a randart
 * activation that only duplicates an intrinsic property.
 *
 * Upstream indexes global tables (timed_effects[], brands[], slays[]) by the
 * integer subtype stored on each effect. The port keeps effect chains as raw
 * compiled records (EffectRecordJson) whose subtype is the TMD_ *name* (`type`)
 * and whose dice are a raw string, so this module resolves those names through a
 * small injected dependency set (makeActivationSummarizer's deps). That keeps it
 * free of the generated enums and the live registries; the session layer binds
 * them at the install site (gap 3.8 WIRING-NEEDED).
 *
 * The produced EffectObjectProperty list feeds the redundancy switch in
 * removeContradictoryActivation; its order is immaterial there (the consumer
 * treats an activation as redundant only when every summarized property is
 * redundant), so this port appends in chain order rather than mirroring the
 * upstream prepend.
 */

import { Dice } from "../dice";
import type {
  ActivationSummarizer,
  EffectObjectProperty,
} from "./randart-build";
import { EFPROP } from "./randart-build";
import type { EffectRecordJson } from "./types";

/**
 * TMD failure-condition codes (player-timed.h enum, mirrored in player/timed.ts
 * and the compiled player_timed records). Only OBJECT / RESIST / VULN map to an
 * object property; the rest (PLAYER, TIMED_EFFECT) are unsummarized.
 */
const TMD_FAIL_FLAG_OBJECT = 1;
const TMD_FAIL_FLAG_RESIST = 2;
const TMD_FAIL_FLAG_VULN = 3;

/** OF_NONE (list-object-flags.h): the "no flag" sentinel for oflag_dup. */
const OF_NONE = 0;

/** One compiled player_timed fail directive ("fail uint code str flag"). */
export interface RawTimedFail {
  /** TMD_FAIL_FLAG_* code. */
  code: number;
  /** OF_ name (OBJECT), ELEM_ name (RESIST/VULN), or otherwise (unused here). */
  flag: string;
}

/**
 * The subset of a compiled player_timed record (pack.player.timed entries) this
 * summarizer reads. Field names mirror the gamedata directives; every field is
 * optional because most timed effects carry none of them.
 */
export interface RawTimedRecord {
  /** TMD_ name; matches an activation effect's `type`. */
  name: string;
  /** temp_resist: ELEM_ name this effect grants a temporary resist against. */
  resist?: string;
  /** oflag_dup / oflag_syn: the flag-synonym directive (only [0] is used). */
  "flag-synonym"?: Array<{ code: string; exact: number }>;
  /** temp_brand: brand `code` this effect grants (only [0] is used). */
  brand?: string[];
  /** temp_slay: slay `code` this effect grants (only [0] is used). */
  slay?: string[];
  /** fail directives. */
  fail?: RawTimedFail[];
}

/**
 * Resolved, name-free form of a timed effect, mirroring the fields
 * effect_summarize_properties reads out of timed_effects[subtype].
 */
interface TimedSummaryData {
  /** oflag_dup: OF_ index, or OF_NONE (0). */
  oflagDup: number;
  /** oflag_syn: whether the flag synonym is an exact duplicate. */
  oflagSyn: boolean;
  /** temp_resist: ELEM_ index, or -1. */
  tempResist: number;
  /** temp_brand: brand index, or -1. */
  tempBrand: number;
  /** temp_slay: slay index, or -1. */
  tempSlay: number;
  /**
   * fail directives with the flag name resolved to an index: an OF_ index for
   * OBJECT, an ELEM_ index for RESIST/VULN, and -1 for codes with no object
   * property (matching how upstream stores every fail idx in one int field, then
   * only reads it for the OBJECT/RESIST/VULN cases).
   */
  fail: Array<{ code: number; idx: number }>;
}

/**
 * Dependencies makeActivationSummarizer binds once. All are trivially available
 * at the session install site: the raw player_timed records, the brand/slay
 * tables, and the generated OF_/ELEM_ name lookups.
 */
export interface ActivationSummarizerDeps {
  /** pack.player.timed: compiled player_timed records, in TMD index order. */
  timedRecords: readonly RawTimedRecord[];
  /** reg.objects.brands: brand table (index 0 is the null pad). */
  brands: readonly ({ code: string } | null)[];
  /** reg.objects.slays: slay table (index 0 is the null pad). */
  slays: readonly ({ code: string } | null)[];
  /** OF[name]: object-flag index, or OF_NONE (0) when absent. */
  ofIndex: (name: string) => number;
  /** ELEM[name]: element index, or -1 when absent. */
  elemIndex: (name: string) => number;
}

/** dice_evaluate(dice, 0, MAXIMISE, NULL): base + dice*sides + m_bonus, no RNG. */
function diceMaximise(diceStr: string | undefined): number {
  if (!diceStr) return 0;
  const d = new Dice();
  if (!d.parseString(diceStr)) return 0;
  const v = d.randomValue();
  return v.base + v.dice * v.sides + v.mBonus;
}

/**
 * Resolve a raw player_timed record into the name-free TimedSummaryData the
 * summary loop consumes.
 */
function resolveTimed(
  rec: RawTimedRecord,
  deps: ActivationSummarizerDeps,
): TimedSummaryData {
  const syn = rec["flag-synonym"]?.[0];
  const brandCode = rec.brand?.[0];
  const slayCode = rec.slay?.[0];
  return {
    oflagDup: syn ? deps.ofIndex(syn.code) : OF_NONE,
    oflagSyn: syn ? syn.exact !== 0 : false,
    tempResist: rec.resist !== undefined ? deps.elemIndex(rec.resist) : -1,
    tempBrand: brandCode
      ? deps.brands.findIndex((b) => b !== null && b.code === brandCode)
      : -1,
    tempSlay: slayCode
      ? deps.slays.findIndex((s) => s !== null && s.code === slayCode)
      : -1,
    fail: (rec.fail ?? []).map((f) => {
      let idx = -1;
      if (f.code === TMD_FAIL_FLAG_OBJECT) idx = deps.ofIndex(f.flag);
      else if (
        f.code === TMD_FAIL_FLAG_RESIST ||
        f.code === TMD_FAIL_FLAG_VULN
      ) {
        idx = deps.elemIndex(f.flag);
      }
      return { code: f.code, idx };
    }),
  };
}

/**
 * Build the activation summarizer injected into remove_contradictory_activation.
 * The returned function is a faithful transcription of
 * effect_summarize_properties (effects-info.c L898).
 */
export function makeActivationSummarizer(
  deps: ActivationSummarizerDeps,
): ActivationSummarizer {
  /* Precompute the resolved timed data keyed by TMD name (upstream indexes
   * timed_effects[] by the integer subtype; the port looks up by `type`). A
   * missing name is equivalent to upstream's `subtype < 0 || subtype >= TMD_MAX`
   * bounds failure. */
  const byName = new Map<string, TimedSummaryData>();
  for (const rec of deps.timedRecords) {
    byName.set(rec.name, resolveTimed(rec, deps));
  }
  const ofNoTeleport = deps.ofIndex("NO_TELEPORT");

  return (effect: readonly EffectRecordJson[]): {
    props: EffectObjectProperty[];
    unsummarizedCount: number;
  } => {
    const props: EffectObjectProperty[] = [];
    let unsummarized = 0;
    /* EF_SET_VALUE remembers a dice for later timed effects; EF_CLEAR_VALUE
     * forgets it (effects-info.c L920-L934). */
    let rememberedDice: string | undefined;

    const add = (
      idx: number,
      reslevelMin: number,
      reslevelMax: number,
      kind: number,
    ): void => {
      props.push({ kind, idx, reslevelMin, reslevelMax });
    };

    /* summarize_cure (effects-info.c L868): a cure grants the object flags /
     * resists that would have blocked the condition. */
    const summarizeCure = (td: TimedSummaryData | undefined): void => {
      if (!td) return;
      for (const f of td.fail) {
        if (f.code === TMD_FAIL_FLAG_OBJECT) {
          add(f.idx, 0, 0, EFPROP.CURE_FLAG);
        } else if (f.code === TMD_FAIL_FLAG_RESIST) {
          add(f.idx, -1, 0, EFPROP.CURE_RESIST);
        } else {
          ++unsummarized;
        }
      }
    };

    /* The value a timed effect is set/incremented to, maximised, preferring a
     * remembered SET_VALUE dice over the effect's own (effects-info.c L944). */
    const timedValue = (ef: EffectRecordJson): number =>
      rememberedDice !== undefined
        ? diceMaximise(rememberedDice)
        : diceMaximise(ef.dice);

    /* The EF_TIMED_INC body (effects-info.c L963-L1045): a positive-duration
     * timed effect grants its flag synonym, temp resist, temp brand/slay, and
     * flags the conditions it conflicts with. */
    const summarizeTimedInc = (td: TimedSummaryData): void => {
      let summarized = false;

      if (td.oflagDup !== OF_NONE) {
        add(
          td.oflagDup,
          0,
          0,
          td.oflagSyn ? EFPROP.OBJECT_FLAG_EXACT : EFPROP.OBJECT_FLAG,
        );
        summarized = true;
      }

      if (td.tempResist >= 0) {
        let rmin = -1;
        let rmax = 1;
        for (const f of td.fail) {
          if (f.idx === td.tempResist) {
            if (f.code === TMD_FAIL_FLAG_RESIST) rmax = Math.min(rmax, 0);
            else if (f.code === TMD_FAIL_FLAG_VULN) rmin = Math.max(rmin, 0);
          }
        }
        add(td.tempResist, rmin, rmax, EFPROP.RESIST);
        summarized = true;
      }

      for (const f of td.fail) {
        switch (f.code) {
          case TMD_FAIL_FLAG_OBJECT:
            add(f.idx, 0, 0, EFPROP.CONFLICT_FLAG);
            summarized = true;
            break;
          case TMD_FAIL_FLAG_RESIST:
            if (f.idx !== td.tempResist) {
              add(f.idx, -1, 0, EFPROP.CONFLICT_RESIST);
              summarized = true;
            }
            break;
          case TMD_FAIL_FLAG_VULN:
            if (f.idx !== td.tempResist) {
              add(f.idx, 0, 3, EFPROP.CONFLICT_VULN);
              summarized = true;
            }
            break;
          default:
            /* Nothing special is needed. */
            break;
        }
      }

      if (td.tempBrand >= 0) {
        add(td.tempBrand, 0, 0, EFPROP.BRAND);
        summarized = true;
      }
      if (td.tempSlay >= 0) {
        add(td.tempSlay, 0, 0, EFPROP.SLAY);
        summarized = true;
      }

      if (!summarized) ++unsummarized;
    };

    for (const ef of effect) {
      switch (ef.eff) {
        case "RANDOM":
        case "SELECT":
          /* Summarize all sub-effects (any is possible); that is the same as
           * stepping over the random/select effect. */
          break;

        case "SET_VALUE":
          rememberedDice = ef.dice;
          break;

        case "CLEAR_VALUE":
          rememberedDice = undefined;
          break;

        case "CURE":
          if (ef.type !== undefined) summarizeCure(byName.get(ef.type));
          break;

        case "TIMED_SET": {
          const value = timedValue(ef);
          if (value <= 0 && ef.type !== undefined && byName.has(ef.type)) {
            /* It's equivalent to a cure. */
            summarizeCure(byName.get(ef.type));
            break;
          }
          /* Fall through to the TIMED_INC handling. */
          if (value > 0 && ef.type !== undefined) {
            const td = byName.get(ef.type);
            if (td) summarizeTimedInc(td);
          }
          break;
        }

        case "TIMED_INC":
        case "TIMED_INC_NO_RES": {
          const value = timedValue(ef);
          if (value > 0 && ef.type !== undefined) {
            const td = byName.get(ef.type);
            if (td) summarizeTimedInc(td);
          }
          break;
        }

        case "TIMED_DEC": {
          const value = timedValue(ef);
          /* If it decreases the duration, it's a partial cure. */
          if (value > 0 && ef.type !== undefined) {
            summarizeCure(byName.get(ef.type));
          }
          break;
        }

        case "TELEPORT":
        case "TELEPORT_TO":
        case "TELEPORT_LEVEL":
          add(ofNoTeleport, 0, 0, EFPROP.CONFLICT_FLAG);
          break;

        default:
          /* Everything else isn't related to an object property. */
          ++unsummarized;
          break;
      }
    }

    return { props, unsummarizedCount: unsummarized };
  };
}
