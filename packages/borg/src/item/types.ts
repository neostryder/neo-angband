/**
 * Local type re-exports for the item subsystem, so modules import from one place
 * (the frozen contract lives in @rpgm-tools/neo-angband-core; BorgContext in ../context).
 */

export type { BorgContext } from "../context.js";
export type {
  ItemView,
  AgentCommand,
  SpellView,
  SpellbookView,
} from "@rpgm-tools/neo-angband-core";
