// Generated from reference/src/list-ui-entry-renderers.h by scripts/codegen-lists.mjs. Do not edit.

/**
 * Second character screen renderers (ui-entry-renderers.c struct backend_info).
 */

export const UI_ENTRY_RENDERER_ENTRIES = [
  { name: "COMPACT_RESIST_RENDERER_WITH_COMBINED_AUX", defaultCombinerName: "RESIST_0", defaultColors: "wwwwwwGGGrrGGGwGrGwwrwWWWWWWGGGrrGGGWGrGWWrW", defaultLabelColors: "swBrgwBrwBwBr", defaultSymbols: "?..+-*!^.=.%%%~!=%~+=~", defaultNDigit: 0, defaultSign: "NO_SIGN" },
  { name: "COMPACT_FLAG_RENDERER_WITH_COMBINED_AUX", defaultCombinerName: "LOGICAL_OR", defaultColors: "wwwwGWWWWG", defaultLabelColors: "swBw", defaultSymbols: "?..+!", defaultNDigit: 0, defaultSign: "NO_SIGN" },
  { name: "COMPACT_FLAG_WITH_CANCEL_RENDERER_WITH_COMBINED_AUX", defaultCombinerName: "LOGICAL_OR_WITH_CANCEL", defaultColors: "wwwwwGwwGGwWWWWWGWWGGW", defaultLabelColors: "swwwwBw", defaultSymbols: "?..+-!+-=.-", defaultNDigit: 0, defaultSign: "NO_SIGN" },
  { name: "NUMERIC_AS_SIGN_RENDERER_WITH_COMBINED_AUX", defaultCombinerName: "ADD", defaultColors: "wwwGowGowGoWWWGoWGoWGo", defaultLabelColors: "swwwBBBrrr", defaultSymbols: "?....+!+--=", defaultNDigit: 0, defaultSign: "NO_SIGN" },
  { name: "NUMERIC_RENDERER_WITH_COMBINED_AUX", defaultCombinerName: "ADD", defaultColors: "wwwboBbPrRowwwboBbPrRo", defaultLabelColors: "swwwBBBrrr", defaultSymbols: "?0000+-", defaultNDigit: 1, defaultSign: "NO_SIGN" },
  { name: "NUMERIC_RENDERER_WITH_BOOL_AUX", defaultCombinerName: "ADD", defaultColors: "wdsgGgrRwdsgGgrR", defaultLabelColors: "wwwwwww", defaultSymbols: "? .s*=", defaultNDigit: 1, defaultSign: "NO_SIGN" },
] as const;

/** NAME -> upstream enum value (UI_ENTRY_RENDERER_ prefix upstream). */
export const UI_ENTRY_RENDERER = {
  COMPACT_RESIST_RENDERER_WITH_COMBINED_AUX: 0,
  COMPACT_FLAG_RENDERER_WITH_COMBINED_AUX: 1,
  COMPACT_FLAG_WITH_CANCEL_RENDERER_WITH_COMBINED_AUX: 2,
  NUMERIC_AS_SIGN_RENDERER_WITH_COMBINED_AUX: 3,
  NUMERIC_RENDERER_WITH_COMBINED_AUX: 4,
  NUMERIC_RENDERER_WITH_BOOL_AUX: 5,
} as const;
