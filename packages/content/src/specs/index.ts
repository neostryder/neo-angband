/**
 * The full set of compiled gamedata files, in compile (and manifest) order.
 *
 * Deferred (not compiled): ui_entry.txt, ui_entry_base.txt,
 * ui_entry_renderer.txt, ui_knowledge.txt, visuals.txt (front-end concerns)
 * and old_class.txt (retired data kept upstream for reference only).
 */

import type { FileSpec } from "../records.js";
import {
  bodySpec,
  classSpec,
  constantsSpec,
  flavorSpec,
  hintsSpec,
  historySpec,
  namesSpec,
  pRaceSpec,
  playerPropertySpec,
  realmSpec,
  shapeSpec,
  terrainSpec,
  trapSpec,
  worldSpec,
} from "./init.js";
import {
  activationSpec,
  artifactSpec,
  brandSpec,
  curseSpec,
  egoItemSpec,
  objectBaseSpec,
  objectPropertySpec,
  objectSpec,
  projectionSpec,
  slaySpec,
} from "./obj-init.js";
import {
  blowEffectsSpec,
  blowMethodsSpec,
  monsterBaseSpec,
  monsterSpec,
  monsterSpellSpec,
  painSpec,
  pitSpec,
} from "./mon-init.js";
import { dungeonProfileSpec, roomTemplateSpec, vaultSpec } from "./generate.js";
import { chestTrapSpec, playerTimedSpec, questSpec, storeSpec, summonSpec } from "./misc.js";

export const gamedataSpecs: readonly FileSpec[] = [
  constantsSpec,
  objectBaseSpec,
  objectPropertySpec,
  projectionSpec,
  terrainSpec,
  objectSpec,
  monsterBaseSpec,
  monsterSpellSpec,
  blowMethodsSpec,
  blowEffectsSpec,
  monsterSpec,
  egoItemSpec,
  artifactSpec,
  curseSpec,
  brandSpec,
  slaySpec,
  activationSpec,
  pRaceSpec,
  classSpec,
  playerPropertySpec,
  playerTimedSpec,
  shapeSpec,
  bodySpec,
  historySpec,
  namesSpec,
  flavorSpec,
  painSpec,
  pitSpec,
  roomTemplateSpec,
  vaultSpec,
  dungeonProfileSpec,
  storeSpec,
  questSpec,
  summonSpec,
  trapSpec,
  chestTrapSpec,
  realmSpec,
  worldSpec,
  hintsSpec,
];
