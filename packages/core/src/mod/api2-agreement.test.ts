/**
 * Core's known-world build and hook payloads must fit the API 2 contract the
 * mod SDK publishes.
 *
 * The SDK cannot import core (core depends on it), so packages/mod-sdk/src/api2
 * writes the shapes out again. These checks run in `tsc -b`, which compiles
 * every test file: a field added on one side and not the other, or a type that
 * no longer fits, fails the build before any test runs. The runtime test below
 * only reports that the table was compiled.
 *
 * Two kinds of check. `Fits` is assignability: what core builds can be handed
 * to a mod as the SDK type. `SameKeys` catches a field core grew that the SDK
 * never learned (a new field would otherwise pass `Fits` silently and never
 * reach mod authors' types) and a field the SDK names that core no longer
 * builds. The one deliberate difference is `actual` on a level cell: the real
 * grid is in core's type for trusted views and is never part of the known
 * world, so the SDK cell has no such field.
 */

import { describe, expect, it } from "vitest";
import type * as Sdk from "@rpgm-tools/neo-angband-mod-sdk";
import type { KnownMonster, KnownWorld } from "../agent/known-world.js";
import type { KnownLevelCell, KnownLevelView, RememberedCell, TrapView } from "../agent/known-level.js";
import type { InputToken } from "../agent/boundary.js";
import type {
  ItemView,
  MonsterView,
  PlayerStatusView,
  PlayerView,
  SpellbookView,
  SpellView,
  StoreItemView,
  StoreView,
  TargetView,
} from "../agent/types.js";
import type {
  CombatOutcomeEventData,
  DungeonLevelEventData,
  HealEventData,
  MessageEventData,
  MotionEventData,
} from "../events.js";
import type { OptionStateData } from "../player/options.js";
import type {
  AbilityGained,
  EffectIntro,
  HistoryAddEntry,
  HistoryDisplayEntry,
  KnownArtifactFind,
  ModHooks,
  ObjectInfoTextSite,
  ScreenTextSite,
} from "./hooks.js";
import type { InputDriver, PlayerIntent, PromptAnswer, PromptDescriptor } from "./host-abi.js";

type Fits<A, B> = [A] extends [B] ? true : false;
type SameKeys<A, B> = [Exclude<keyof A, keyof B>, Exclude<keyof B, keyof A>] extends [never, never] ? true : false;
type Both<A, B> = Fits<A, B> extends true ? SameKeys<A, B> : false;

/* Each entry must be `true`; a drift makes the literal fail to type-check. */
const agreement: Record<string, true> = {
  world: true satisfies Both<KnownWorld, Sdk.KnownWorldData>,
  token: true satisfies Both<InputToken, Sdk.KnownToken>,
  player: true satisfies Both<PlayerView, Sdk.KnownPlayer>,
  playerStatus: true satisfies Both<PlayerStatusView, Sdk.KnownPlayerStatus>,
  item: true satisfies Both<ItemView, Sdk.KnownItem>,
  storeItem: true satisfies Both<StoreItemView, Sdk.KnownStoreItem>,
  store: true satisfies Both<StoreView, Sdk.KnownStore>,
  spell: true satisfies Both<SpellView, Sdk.KnownSpell>,
  spellbook: true satisfies Both<SpellbookView, Sdk.KnownSpellbook>,
  target: true satisfies Both<TargetView, Sdk.KnownTarget>,
  monster: true satisfies Both<KnownMonster, Sdk.KnownMonster>,
  level: true satisfies Both<KnownLevelView, Sdk.KnownLevel>,
  rememberedCell: true satisfies Both<RememberedCell, Sdk.KnownRememberedCell>,
  trap: true satisfies Both<TrapView, Sdk.KnownTrap>,
  /* The real grid stays out of the known world: `actual` is the only extra key. */
  levelCell: true satisfies Fits<KnownLevelCell, Sdk.KnownLevelCell>,
  levelCellExtra: true satisfies Fits<Exclude<keyof KnownLevelCell, keyof Sdk.KnownLevelCell>, "actual">,
  levelCellMissing: true satisfies Fits<Exclude<keyof Sdk.KnownLevelCell, keyof KnownLevelCell>, never>,

  /* Hook payloads: what core passes must fit what API 2 promises. */
  screenTextSite: true satisfies Both<ScreenTextSite, Sdk.Api2ScreenTextSite>,
  objectInfoSite: true satisfies Both<ObjectInfoTextSite, Sdk.Api2ObjectInfoTextSite>,
  effectIntro: true satisfies Both<EffectIntro, Sdk.Api2EffectIntro>,
  historyAdd: true satisfies Both<HistoryAddEntry, Sdk.Api2HistoryAdd>,
  historyDisplay: true satisfies Both<HistoryDisplayEntry, Sdk.Api2HistoryDisplay>,
  abilityGained: true satisfies Fits<AbilityGained, Sdk.Api2AbilityGained>,
  artifactFound: true satisfies Both<KnownArtifactFind, Sdk.Api2ArtifactFound>,
  options: true satisfies Both<OptionStateData, Sdk.Api2Options>,
  /* Every API 2 hook is a ModHooks member of the same name. */
  hookNames: true satisfies Fits<Sdk.Api2HookName, keyof ModHooks>,

  /* Input: core's prompt fits API 2's, and API 2's intents and answers fit core's. */
  prompt: true satisfies Fits<PromptDescriptor, Sdk.Api2Prompt>,
  intent: true satisfies Fits<Sdk.Api2Intent, PlayerIntent>,
  answer: true satisfies Fits<Sdk.Api2PromptAnswer, PromptAnswer>,
  driver: true satisfies Fits<InputDriver, Sdk.Api2Driver>,

  /* Events the host translates from: the fields it reads exist with these types. */
  messageEvent: true satisfies Fits<Pick<MessageEventData, "type">, Pick<Sdk.Api2MessageEvent, "type">>,
  levelEvent: true satisfies Both<DungeonLevelEventData, Sdk.Api2LevelEvent>,
  combatEvent: true satisfies Fits<Pick<CombatOutcomeEventData, "kind" | "hit" | "died" | "grid">, Pick<Sdk.Api2CombatEvent, "kind" | "hit" | "died" | "grid">>,
  motionEvent: true satisfies Fits<Pick<MotionEventData, "from" | "to" | "kind">, Pick<Sdk.Api2MotionEvent, "from" | "to" | "kind">>,
  healEvent: true satisfies Fits<Pick<HealEventData, "grid">, Pick<Sdk.Api2HealEvent, "grid">>,

  /* The truth namespace's monster is the trusted MonsterView. */
  trueMonster: true satisfies Both<MonsterView, Sdk.Api2TrueMonster>,
};

describe("the API 2 contract agrees with core", () => {
  it("compiles every agreement check", () => {
    expect(Object.values(agreement).every((v) => v)).toBe(true);
    expect(Object.keys(agreement).length).toBeGreaterThan(30);
  });
});
