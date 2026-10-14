import type { KnownGrid, KnownItem, KnownPlayer, KnownToken } from "./known.js";
import type { Api2Call } from "./result.js";

export interface Api2Inspect {
  simulateLoadout(change: LoadoutChange): Api2Call<LoadoutSimulation>;
  item(ref: ItemRef): Api2Call<InspectResult | null>;
  itemRules(): Api2Call<ItemRulesResult>;
  itemTester(code: string): Api2Call<ItemTesterResult>;
  bookForItem(handle: number): Api2Call<BookItemResult | null>;
  spell(index: number): Api2Call<SpellInspectResult | null>;
  monsterRecall(raceIndex: number): Api2Call<InspectResult | null>;
  projectionPath(to: KnownGrid): Api2Call<GridInspectResult>;
  blastArea(to: KnownGrid, radius: number, arc?: number): Api2Call<BlastAreaResult>;
  travelPath(to: KnownGrid): Api2Call<TravelPathResult | null>;
  compareLoadoutSlots(ref: LoadoutItemRef): Api2Call<LoadoutSlotsResult>;
  tileActions(to: KnownGrid): Api2Call<TileActionsResult>;
}

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

export interface ObjectDamageLine {
  readonly kind: "brand" | "slay";
  readonly name: string;
  readonly damage: number;
}

export interface ObjectDamage {
  
  readonly normal: number;
  
  readonly vs: readonly ObjectDamageLine[];
  
  readonly offWeapon: boolean;
}

export interface ObjectCombatInfo {
  
  readonly tooHeavy: boolean;
  
  readonly blows: number | null;
  
  readonly damage: ObjectDamage | null;
  
  readonly thrownDamage: ObjectDamage | null;
  
  readonly multiplier: number | null;
  
  readonly range: number | null;
  
  readonly breakageChance: number | null;
}

export interface InspectResult {
  readonly token: KnownToken;
  readonly title: string;
  readonly text: string;
  readonly sections?: readonly { readonly kind: "title" | "description" | "info"; readonly text: string }[];
  
  readonly combat?: ObjectCombatInfo | null;
}

export interface SpellInspectResult {
  readonly token: KnownToken;
  readonly name: string;
  readonly description: string;
  readonly level: number;
  readonly mana: number;
  readonly failChance: number;
  readonly canCastNow: boolean;
}

export interface ItemTesterResult {
  readonly token: KnownToken;
  readonly items: readonly ({ readonly handle: number } | { readonly floor: { readonly x: number; readonly y: number; readonly index: number } })[];
}

export interface BookItemResult {
  readonly token: KnownToken;
  readonly bookIndex: number;
  readonly spells: readonly number[];
}

export interface LoadoutSlotsResult {
  readonly token: KnownToken;
  readonly slots: readonly { readonly slot: number; readonly name: string; readonly comparison: LoadoutSimulation }[];
}

export interface GridInspectResult {
  readonly token: KnownToken;
  readonly grids: readonly { readonly x: number; readonly y: number }[];
}

export interface BlastAreaResult extends GridInspectResult {
  readonly radius: number;
  
  readonly arc: number | null;
  readonly element: string | null;
  readonly wallsStop: boolean;
}

export interface TravelPathResult {
  readonly token: KnownToken;
  readonly grids: readonly { readonly x: number; readonly y: number }[];
}

export interface TileActionsResult {
  readonly token: KnownToken;
  readonly codes: readonly string[];
}

export interface ItemRulesResult {
  readonly token: KnownToken;
  readonly kinds: readonly { readonly kidx: number; readonly name: string; readonly ignoreAware: boolean; readonly ignoreUnaware: boolean; readonly noteAware: string | null; readonly noteUnaware: string | null }[];
  
  readonly quality: readonly { readonly itype: number; readonly name: string; readonly threshold: number; readonly thresholdName: string; readonly levels: readonly string[] }[];
  readonly egos: readonly { readonly eidx: number; readonly name: string; readonly itype: number; readonly ignored: boolean }[];
}
