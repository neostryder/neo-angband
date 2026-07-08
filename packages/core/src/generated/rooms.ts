// Generated from reference/src/list-rooms.h by scripts/codegen-lists.mjs. Do not edit.

/**
 * Dungeon room builders (generate.c room_builders; rows/cols are vault maxima).
 */

export const ROOM_ENTRIES = [
  { name: "staircase room", rows: 0, cols: 0, builder: "staircase" },
  { name: "simple room", rows: 0, cols: 0, builder: "simple" },
  { name: "moria room", rows: 0, cols: 0, builder: "moria" },
  { name: "large room", rows: 0, cols: 0, builder: "large" },
  { name: "crossed room", rows: 0, cols: 0, builder: "crossed" },
  { name: "circular room", rows: 0, cols: 0, builder: "circular" },
  { name: "overlap room", rows: 0, cols: 0, builder: "overlap" },
  { name: "room template", rows: 11, cols: 33, builder: "template" },
  { name: "Interesting room", rows: 40, cols: 50, builder: "interesting" },
  { name: "monster pit", rows: 0, cols: 0, builder: "pit" },
  { name: "monster nest", rows: 0, cols: 0, builder: "nest" },
  { name: "huge room", rows: 0, cols: 0, builder: "huge" },
  { name: "room of chambers", rows: 0, cols: 0, builder: "room_of_chambers" },
  { name: "Lesser vault", rows: 22, cols: 22, builder: "lesser_vault" },
  { name: "Medium vault", rows: 22, cols: 33, builder: "medium_vault" },
  { name: "Greater vault", rows: 44, cols: 66, builder: "greater_vault" },
  { name: "Lesser vault (new)", rows: 22, cols: 22, builder: "lesser_new_vault" },
  { name: "Medium vault (new)", rows: 22, cols: 33, builder: "medium_new_vault" },
  { name: "Greater vault (new)", rows: 44, cols: 66, builder: "greater_new_vault" },
] as const;

/** NAME -> upstream enum value (ROOM_ prefix upstream). */
export const ROOM = {
  "staircase room": 0,
  "simple room": 1,
  "moria room": 2,
  "large room": 3,
  "crossed room": 4,
  "circular room": 5,
  "overlap room": 6,
  "room template": 7,
  "Interesting room": 8,
  "monster pit": 9,
  "monster nest": 10,
  "huge room": 11,
  "room of chambers": 12,
  "Lesser vault": 13,
  "Medium vault": 14,
  "Greater vault": 15,
  "Lesser vault (new)": 16,
  "Medium vault (new)": 17,
  "Greater vault (new)": 18,
} as const;
