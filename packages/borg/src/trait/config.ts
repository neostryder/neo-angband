/**
 * Configuration and seam inputs for the self-model port.
 *
 * The C borg reaches into engine internals the frozen AgentView deliberately
 * does not expose - the spell subsystem (borg_spell_legal/_fail, spell_chance),
 * the item-activation identity tables (act_*, borg_equips_item), the swap
 * subsystem (borg-trait-swap), the home inventory (borg_notice_home), and the
 * per-object sval/kind identity tables (borg-item-val). Rather than hack the
 * frozen contract, those are modelled here as explicit SEAMS with faithful,
 * inert defaults so the ported arithmetic is byte-for-byte the C when a seam is
 * supplied, and simply "the borg is unaware / has none" when it is not.
 *
 * borg_cfg[] values come from reference/src/borg/borg.txt (stock defaults).
 */

/** borg_cfg[] settings the trait/power/prepared code reads (borg.txt defaults). */
export interface BorgCfg {
  worshipsDamage: boolean;
  worshipsSpeed: boolean;
  worshipsHp: boolean;
  worshipsMana: boolean;
  worshipsAc: boolean;
  playsRisky: boolean;
  killsUniques: boolean;
  usesSwaps: boolean;
  usesDynamicCalcs: boolean;
  noDeeper: number;
  munchkinStart: boolean;
  munchkinLevel: number;
  enchantLimit: number;
}

/** Stock borg.txt defaults. */
export function defaultCfg(): BorgCfg {
  return {
    worshipsDamage: false,
    worshipsSpeed: false,
    worshipsHp: false,
    worshipsMana: false,
    worshipsAc: false,
    playsRisky: false,
    killsUniques: false,
    usesSwaps: true,
    usesDynamicCalcs: false,
    noDeeper: 127,
    munchkinStart: false,
    munchkinLevel: 12,
    enchantLimit: 12,
  };
}

/**
 * The spell/device seam. The C queries borg_spell_legal(_fail) and
 * borg_equips_item(act_*) to grant "infinite" amounts of detect/teleport/heal/
 * enchant/etc. These live in the magic + activation subsystems (P8.x). Default:
 * nothing legal, nothing equipped - the borg relies purely on carried items.
 */
export interface BorgSpellSeam {
  /** borg_spell_legal(spell): is the spell castable at all. */
  spellLegal(spell: string): boolean;
  /** borg_spell_legal_fail(spell, failPct): castable AND fail <= failPct. */
  spellLegalFail(spell: string, fail: number): boolean;
  /** borg_equips_item(act, useAsSwap): an equipped item grants this activation. */
  equipsItem(act: string): boolean;
  /** borg_equips_ring(sval): an equipped ring of this sval. */
  equipsRing(sval: number): boolean;
  /** spell_chance(0): live cast-failure percent of the first spell. */
  spellChance(): number;
  /** player_has(PF_*): a player-flag (class ability) query. */
  playerHas(flag: string): boolean;
}

/** Inert spell/device seam: nothing legal or equipped. */
export function defaultSpellSeam(): BorgSpellSeam {
  return {
    spellLegal: () => false,
    spellLegalFail: () => false,
    equipsItem: () => false,
    equipsRing: () => false,
    spellChance: () => 100,
    playerHas: () => false,
  };
}

/**
 * Home-inventory counts (borg_notice_home). Used only in the deep-endgame
 * power/prepared checks. Default: empty home.
 */
export interface BorgHomeSeam {
  numHealTrue: number;
  numEzhealTrue: number;
  numLifeTrue: number;
  numHeal: number;
  numEzheal: number;
  numLife: number;
  numSpeed: number;
}

/** Empty home. */
export function defaultHomeSeam(): BorgHomeSeam {
  return {
    numHealTrue: 0,
    numEzhealTrue: 0,
    numLifeTrue: 0,
    numHeal: 0,
    numEzheal: 0,
    numLife: 0,
    numSpeed: 0,
  };
}

/**
 * Frame inputs the C cheats from race/class/game internals that AgentView does
 * not surface. All optional; when omitted the borg falls back to AgentView's
 * already-derived aggregates (which are exactly what these tables build toward)
 * or to a neutral zero.
 */
export interface BorgFrame {
  /** race->r_adj + class->c_adj per stat (STAT order), for the used-stat calc. */
  statAdj?: readonly number[];
  /** player->obj_k->modifiers[OBJ_MOD_*+i] knowledge mask per stat (0/1). */
  statKnown?: readonly number[];
  /** player->player_hp[lev-1] - cumulative rolled HP at the current level. */
  playerHp?: number;
  /** class->magic.spell_first (level the class gets its first spell). */
  spellFirst?: number;
  /** class->magic.total_spells (0 for non-casters). */
  totalSpells?: number;
  /** class->magic.spell_weight (armor weight before mana penalty). */
  spellWeight?: number;
  /** stat_max[i] > stat_cur[i] per stat (drained) - for BI_ISFIX* flags. */
  statDrained?: readonly boolean[];
}

/** Neutral frame. */
export function defaultFrame(): BorgFrame {
  return {};
}

/**
 * Per-role sval identity, resolved by the engine at init (borg-item-val.c). The
 * inventory notice matches carried items by (tval, sval) against this to build
 * the consumable-ability traits (BI_AHEAL, BI_APHASE, ...) and the has[] map.
 * When absent those traits stay 0 - faithful to "the borg has not identified
 * any such items". Keyed by the sv_/kv_ role name (borg-item-val.h).
 */
export type BorgSvals = Partial<Record<string, number>>;

/** The full seam bundle threaded through notice/power/prepared. */
export interface BorgTraitOpts {
  cfg?: Partial<BorgCfg>;
  spells?: BorgSpellSeam;
  home?: BorgHomeSeam;
  frame?: BorgFrame;
  svals?: BorgSvals;
}

/** Resolve a partial opts bundle to a fully-populated one with defaults. */
export interface ResolvedOpts {
  cfg: BorgCfg;
  spells: BorgSpellSeam;
  home: BorgHomeSeam;
  frame: BorgFrame;
  svals: BorgSvals;
}

/** Fill in defaults for any unsupplied seam. */
export function resolveOpts(opts: BorgTraitOpts = {}): ResolvedOpts {
  return {
    cfg: { ...defaultCfg(), ...opts.cfg },
    spells: opts.spells ?? defaultSpellSeam(),
    home: opts.home ?? defaultHomeSeam(),
    frame: opts.frame ?? defaultFrame(),
    svals: opts.svals ?? {},
  };
}
