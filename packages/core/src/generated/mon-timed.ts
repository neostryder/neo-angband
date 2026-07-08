// Generated from reference/src/list-mon-timed.h by scripts/codegen-lists.mjs. Do not edit.

/**
 * Monster timed effects (mon-timed.h MON_TMD_ enum; fields per header comment).
 */

export const MON_TIMED_ENTRIES = [
  { name: "SLEEP", save: true, stack: "NO", resistFlag: "RF_NO_SLEEP", time: 10000, messageBegin: "MON_MSG_FALL_ASLEEP", messageEnd: "MON_MSG_WAKES_UP", messageIncrease: 0 },
  { name: "STUN", save: false, stack: "MAX", resistFlag: "RF_NO_STUN", time: 50, messageBegin: "MON_MSG_DAZED", messageEnd: "MON_MSG_NOT_DAZED", messageIncrease: "MON_MSG_MORE_DAZED" },
  { name: "CONF", save: false, stack: "MAX", resistFlag: "RF_NO_CONF", time: 50, messageBegin: "MON_MSG_CONFUSED", messageEnd: "MON_MSG_NOT_CONFUSED", messageIncrease: "MON_MSG_MORE_CONFUSED" },
  { name: "FEAR", save: true, stack: "INCR", resistFlag: "RF_NO_FEAR", time: 10000, messageBegin: "MON_MSG_FLEE_IN_TERROR", messageEnd: "MON_MSG_NOT_AFRAID", messageIncrease: "MON_MSG_MORE_AFRAID" },
  { name: "SLOW", save: false, stack: "INCR", resistFlag: "RF_NO_SLOW", time: 50, messageBegin: "MON_MSG_SLOWED", messageEnd: "MON_MSG_NOT_SLOWED", messageIncrease: "MON_MSG_MORE_SLOWED" },
  { name: "FAST", save: false, stack: "INCR", resistFlag: 0, time: 50, messageBegin: "MON_MSG_HASTED", messageEnd: "MON_MSG_NOT_HASTED", messageIncrease: "MON_MSG_MORE_HASTED" },
  { name: "HOLD", save: false, stack: "MAX", resistFlag: "RF_NO_HOLD", time: 50, messageBegin: "MON_MSG_HELD", messageEnd: "MON_MSG_NOT_HELD", messageIncrease: 0 },
  { name: "DISEN", save: false, stack: "MAX", resistFlag: "RF_IM_DISEN", time: 50, messageBegin: "MON_MSG_DISEN", messageEnd: "MON_MSG_NOT_DISEN", messageIncrease: 0 },
  { name: "COMMAND", save: false, stack: "MAX", resistFlag: 0, time: 50, messageBegin: "MON_MSG_COMMAND", messageEnd: "MON_MSG_NOT_COMMAND", messageIncrease: 0 },
  { name: "CHANGED", save: false, stack: "MAX", resistFlag: 0, time: 50, messageBegin: 0, messageEnd: 0, messageIncrease: 0 },
  { name: "MAX", save: true, stack: "INCR", resistFlag: 0, time: 0, messageBegin: 0, messageEnd: 0, messageIncrease: 0 },
] as const;

/** NAME -> upstream enum value (MON_TMD_ prefix upstream). */
export const MON_TMD = {
  SLEEP: 0,
  STUN: 1,
  CONF: 2,
  FEAR: 3,
  SLOW: 4,
  FAST: 5,
  HOLD: 6,
  DISEN: 7,
  COMMAND: 8,
  CHANGED: 9,
  MAX: 10,
} as const;
