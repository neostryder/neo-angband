import type { KnownGrid, KnownItem, KnownPlayer } from "./known.js";

export type LoadoutItemRef =
  | { readonly from: "gear"; readonly handle: number }
  | { readonly from: "store"; readonly store: number; readonly index: number }
  | { readonly from: "floor"; readonly x: number; readonly y: number; readonly index: number };

export interface LoadoutChange {
  readonly wield?: readonly LoadoutItemRef[];
  readonly wieldAt?: readonly { readonly item: LoadoutItemRef; readonly slot: number }[];
  readonly carry?: readonly { readonly item: LoadoutItemRef; readonly number?: number }[];
  readonly remove?: readonly number[];
  readonly release?: readonly { readonly handle: number; readonly number?: number }[];
}

export interface DerivedStatsView {
  readonly speed: number;
  readonly baseAc: number;
  readonly toA: number;
  readonly ac: number;
  readonly toH: number;
  readonly toD: number;
  readonly blows: number;
  readonly shots: number;
  readonly moves: number;
  readonly ammoMult: number;
  readonly ammoTval: number;
  readonly damRed: number;
  readonly percDamRed: number;
  readonly seeInfra: number;
  readonly light: number;
  readonly hold: number;
  readonly heavyWield: boolean;
  readonly heavyShoot: boolean;
  readonly blessWield: boolean;
  readonly cumberArmor: boolean;
  readonly statAdd: readonly number[];
  readonly statUse: readonly number[];
  readonly statTop: readonly number[];
  readonly statInd: readonly number[];
  readonly skills: readonly number[];
  readonly resists: readonly number[];
  readonly resistElements: readonly string[];
  readonly objectFlags: readonly string[];
  readonly playerFlags: readonly string[];
  readonly maxHp: number;
  readonly maxSp: number;
  readonly totalWeight: number;
  readonly weightLimit: number;
}

export type LoadoutDelta = Pick<DerivedStatsView,
  "speed" | "baseAc" | "toA" | "ac" | "toH" | "toD" | "blows" | "shots" |
  "moves" | "ammoMult" | "damRed" | "percDamRed" | "seeInfra" | "light" |
  "hold" | "maxHp" | "maxSp" | "totalWeight" | "weightLimit" | "statAdd" |
  "statUse" | "statTop" | "statInd" | "skills" | "resists"
> & {
  readonly objectFlagsGained: readonly string[];
  readonly objectFlagsLost: readonly string[];
  readonly playerFlagsGained: readonly string[];
  readonly playerFlagsLost: readonly string[];
  readonly changed: boolean;
  readonly unknownRunes: boolean;
};

export interface LoadoutView {
  readonly player: KnownPlayer;
  readonly equipment: readonly (KnownItem | null)[];
  readonly inventory: readonly KnownItem[];
  readonly stats: DerivedStatsView;
}

export interface LoadoutSimulation {
  readonly before: LoadoutView;
  readonly after: LoadoutView;
  readonly delta: LoadoutDelta;
  readonly placements: readonly {
    readonly slot: number;
    readonly worn: KnownItem;
    readonly displaced: KnownItem | null;
  }[];
  readonly unresolved: readonly LoadoutItemRef[];
}

export type ItemRef = number | { readonly floor: KnownGrid & { readonly index: number } } |
  { readonly store: number; readonly index: number };
