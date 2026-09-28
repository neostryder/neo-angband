/**
 * `ctx.display.setTerminalGround`: the colour a text terminal clears to, for a
 * mod that paints the panels around it in another ground (#299 follow-up).
 */

import { colorChannels } from "./chrome-theme";

/** Which terminals take the ground: the text subwindows only, or the main terminal too. */
export type TerminalGroundScope = "subwindows" | "all";

export interface TerminalGround {
  /** #rgb, #rrggbb, #rrggbbaa or rgb(), the forms setChromeTheme accepts. */
  readonly color: string;
  readonly scope: TerminalGroundScope;
}

/** Check a request and fill in the default scope. Throws TypeError on a bad key or value. */
export function validateTerminalGround(value: unknown): TerminalGround {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("terminal ground must be an object with a color, or null");
  }
  const v = value as Record<string, unknown>;
  for (const key of Object.keys(v)) {
    if (key !== "color" && key !== "scope") throw new TypeError(`terminal ground has no "${key}" key`);
  }
  if (typeof v["color"] !== "string" || colorChannels(v["color"]) === null) {
    throw new TypeError("terminal ground color must be #rgb, #rrggbb, #rrggbbaa or rgb()");
  }
  const scope = v["scope"] ?? "subwindows";
  if (scope !== "subwindows" && scope !== "all") {
    throw new TypeError('terminal ground scope must be "subwindows" or "all"');
  }
  return Object.freeze({ color: v["color"].trim(), scope });
}
