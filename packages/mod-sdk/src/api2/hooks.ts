/**
 * API 2 hooks: the points where a mod may restate text or take a small
 * decision inside the game, with plain data in and plain data out.
 *
 * Each hook mirrors one member of core's ModHooks
 * (packages/core/src/mod/hooks.ts) and keeps its call site and its fold, but
 * never passes a live object. A hook that needs the game state, a live level or
 * a live object has no API 2 form; docs/modding/API2.md lists them and what
 * replaces each one.
 *
 * Every hook is synchronous because it runs inside a turn. Hooks never draw
 * from the game's random number generator and never change game state; the
 * value they return is the whole of their effect.
 */

import type { KnownMonster } from "./known.js";

/** Where a piece of screen text sits (ModHooks.screenText). */
export interface Api2ScreenTextSite {
  /** The screen's stable id, such as `core:help-symbols`, or `core:prompt`. */
  readonly screen: string;
  readonly part:
    | "title"
    | "footer"
    | "action"
    | "caption"
    | "column"
    | "cell"
    | "empty"
    | "detail"
    | "prose"
    | "line"
    | "prompt";
  readonly column?: string;
  readonly row?: Readonly<Record<string, string>>;
}

/** The part of an item description that wrote a fragment (ModHooks.objectInfoText). */
export type Api2ObjectInfoSection =
  | "unknown"
  | "origin"
  | "flavor"
  | "unassessed"
  | "curses"
  | "stats"
  | "slays"
  | "brands"
  | "elements"
  | "protects"
  | "ignores"
  | "hates"
  | "sustains"
  | "misc"
  | "light"
  | "book"
  | "ego"
  | "effect"
  | "combat"
  | "digger"
  | "nothing"
  | "break";

/** Where a fragment of an item description sits. `kind` is the flavour until the player knows the kind. */
export interface Api2ObjectInfoTextSite {
  readonly section: Api2ObjectInfoSection;
  readonly tval: string;
  readonly kind: string;
  readonly aware: boolean;
}

/** The facts behind the opening words of an item's effect description (ModHooks.effectIntro). */
export interface Api2EffectIntro {
  readonly effect: "known" | "unknown";
  readonly itemClass: "food" | "potion" | "scroll" | "wand" | "staff" | "rod" | "other";
  readonly aimed: boolean;
  readonly activation: boolean;
  readonly describedActivation: boolean;
  readonly text: string;
}

/** A history entry about to be written (ModHooks.historyAdd). */
export interface Api2HistoryAdd {
  readonly what: string;
  readonly type: number;
  readonly duplicate: boolean;
  readonly rawUserInput?: string;
  readonly expandUserInput?: true;
}

/**
 * The answer to `historyAdd`. `keep: false` drops the entry; `what` replaces
 * its text for the contributors after this one and for the save.
 */
export interface Api2HistoryDecision {
  readonly keep: boolean;
  readonly what?: string;
  readonly expandUserInput?: true;
}

/** A saved history entry about to be shown (ModHooks.historyDisplay). */
export interface Api2HistoryDisplay {
  readonly what: string;
  readonly type: number;
  readonly expandUserInput?: true;
}

/** A newly available spell or activation (ModHooks.abilityGained). */
export type Api2AbilityGained =
  | {
      readonly kind: "spell";
      readonly spellIndex: number;
      readonly name: string;
      readonly realm: string;
      readonly command: "cast";
    }
  | {
      readonly kind: "activation";
      readonly kindIndex: number;
      readonly name: string;
      readonly command: "activate";
    };

/** An artifact the player has just identified (ModHooks.artifactIdentified). */
export interface Api2ArtifactFound {
  readonly name: string;
  readonly artifactIndex: number;
}

/** The game's options after a change (ModHooks.optionsChanged). */
export interface Api2Options {
  readonly values: Readonly<Record<string, boolean>>;
  readonly hitpointWarn: number;
  readonly delayFactor: number;
  readonly lazymoveDelay: number;
  readonly birth: Readonly<Record<string, boolean>>;
}

/** One floor-list entry's offset from the player (ModHooks.objectListTiebreak). */
export interface Api2ListOffset {
  readonly dy: number;
  readonly dx: number;
}

/**
 * The hooks an API 2 mod may declare. Every member is optional; a hook the mod
 * leaves out costs nothing and the game takes its own path.
 */
export interface Api2Hooks {
  /** Restate a message before it is shown. Chained in load order. */
  messageText?(raw: string): string;
  /** Restate one piece of a screen's text. Chained in load order. */
  screenText?(raw: string, site: Api2ScreenTextSite): string;
  /** Restate the character background text. Chained in load order. */
  characterBackground?(text: string): string;
  /** Restate one fragment of an item description. Chained in load order. */
  objectInfoText?(text: string, site: Api2ObjectInfoTextSite): string;
  /** Restate the opening words of an effect description. Chained in load order. */
  effectIntro?(intro: Api2EffectIntro): string;
  /** Keep, drop or rewrite a history entry. Every mod must agree to keep it. */
  historyAdd?(entry: Api2HistoryAdd): Api2HistoryDecision;
  /** Restate a saved history entry for display. Chained in load order. */
  historyDisplay?(entry: Api2HistoryDisplay, playerName: string): string;
  /** Order two floor-list entries that tie on everything else; 0 leaves them as they are. */
  objectListTiebreak?(a: Api2ListOffset, b: Api2ListOffset): number;
  /** True to keep monster noise and scent in the save. Any mod saying yes is enough. */
  saveNoiseScent?(): boolean;
  /** True to let a shapechange teach its obvious flags directly. Any mod saying yes is enough. */
  shapeLearnObviousFlagsDirectly?(): boolean;
  /** Told after the player changes an option. */
  optionsChanged?(options: Api2Options): void;
  /** Told when a spell or activation becomes available. */
  abilityGained?(ability: Api2AbilityGained): void;
  /** Told when a monster comes into the player's view. */
  monsterBecameVisible?(monster: KnownMonster): void;
  /** Told when the player identifies an artifact. */
  artifactIdentified?(found: Api2ArtifactFound): void;
}

/** The names of the API 2 hooks. */
export type Api2HookName = keyof Api2Hooks;

/** Every API 2 hook name, in the order ModHooks declares them. */
export const API2_HOOK_NAMES: readonly Api2HookName[] = Object.freeze([
  "messageText",
  "screenText",
  "characterBackground",
  "objectInfoText",
  "effectIntro",
  "historyAdd",
  "historyDisplay",
  "objectListTiebreak",
  "saveNoiseScent",
  "shapeLearnObviousFlagsDirectly",
  "optionsChanged",
  "abilityGained",
  "monsterBecameVisible",
  "artifactIdentified",
]);
