/**
 * Local type re-exports for the item subsystem, so modules import from one place
 * (the frozen contract lives in @neo-angband/core; BorgContext in ../context).
 */

export type { BorgContext } from "../context";
export type {
  ItemView,
  AgentCommand,
  SpellView,
  SpellbookView,
} from "@neo-angband/core";
