/**
 * The combat domain: shared to-hit / critical math (hit.ts), brand and slay
 * selection (brand-slay.ts), player melee (melee.ts), monster melee against
 * the player (mon-melee.ts), and player ranged attacks (ranged.ts). Ported
 * from Angband 4.2.6 (player-attack.c, mon-attack.c, mon-blows.c, obj-slays.c).
 *
 * Not wired into the package barrel (packages/core/src/index.ts) yet; import
 * directly from "./combat".
 */

export * from "./hit";
export * from "./brand-slay";
export * from "./melee";
export * from "./mon-melee";
export * from "./ranged";
