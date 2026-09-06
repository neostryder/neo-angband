/**
 * What a connected pad ACTUALLY reports, rather than what a layout is assumed
 * to be.
 *
 * The Gamepad API's "standard" mapping is a claim about button INDICES, not a
 * guarantee that the device has them: a browser reports `mapping: "standard"`
 * for pads with 11 buttons and for pads with 17, and reports `mapping: ""` for
 * anything it does not recognise while still exposing usable buttons and axes.
 * Both cases have to play. So every decision here is taken from the live
 * `buttons.length` / `axes.length` of the sample in hand, and the family is used
 * only to LABEL a button, never to assume one exists.
 *
 * Nothing in this module touches `navigator`; it takes a plain snapshot so the
 * whole classification is testable against synthesised pads.
 */

/** The structural subset of `Gamepad` this port reads. */
export interface PadSnapshot {
  readonly id: string;
  readonly index: number;
  readonly mapping: string;
  readonly connected: boolean;
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
  readonly axes: readonly number[];
}

/** Chosen for the button NAMES a player already reads on their own device. */
export type PadFamily = "xbox" | "playstation" | "nintendo" | "generic";

export interface PadCapabilities {
  readonly family: PadFamily;
  /** The browser recognised the layout, so indices below are trustworthy. */
  readonly standard: boolean;
  readonly buttonCount: number;
  readonly axisCount: number;
  /** Face buttons the standard layout places at indices 0-3. */
  readonly faceButtons: number;
  readonly shoulders: boolean;
  readonly triggers: boolean;
  /** Buttons 12-15 in the standard layout. A hat axis is not one of these. */
  readonly dpad: boolean;
  readonly sticks: 0 | 1 | 2;
  readonly stickButtons: boolean;
  /** Buttons 8/9: View/Back and Menu/Start, or their equivalents. */
  readonly systemButtons: boolean;
}

/** Standard-mapping indices, named. Present here only as documentation. */
export const STANDARD_BUTTON = {
  faceDown: 0, faceRight: 1, faceLeft: 2, faceUp: 3,
  leftShoulder: 4, rightShoulder: 5, leftTrigger: 6, rightTrigger: 7,
  view: 8, menu: 9, leftStick: 10, rightStick: 11,
  dpadUp: 12, dpadDown: 13, dpadLeft: 14, dpadRight: 15,
} as const;

export const STANDARD_AXIS = {
  leftX: 0, leftY: 1, rightX: 2, rightY: 3,
} as const;

/**
 * Vendor ids appear in every browser's `id` string, and the marketing name does
 * not always: Chrome writes `Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e
 * Product: 028e)` while Firefox writes `045e-028e-Xbox 360 Wired Controller`.
 * Match on both, vendor id first, because the id is the part that cannot be
 * localised or rebranded.
 *
 * This answers what to CALL a button and nothing else. It is not a layout
 * lookup, and it deliberately is not, because the answer is knowably wrong some
 * of the time: Steam Input re-presents every pad it handles under Valve's own
 * vendor id 28de, so a PlayStation pad played through Steam arrives claiming to
 * be something else entirely. It also presents an Xbox-shaped layout while
 * doing so, which is why 28de is grouped with Xbox rather than given a family
 * of its own. A player whose legend shows the wrong letters has a mapping
 * screen; a player whose LAYOUT was guessed from a rebranded id would have a
 * pad that does the wrong thing, which is why nothing but the labels depends on
 * this.
 */
function familyFromId(id: string): PadFamily {
  const text = id.toLowerCase();
  // Vendor id first, across every family, because it is the part that cannot be
  // localised or rebranded and it settles the case a name cannot.
  if (/\b057e\b/.test(text)) return "nintendo";
  if (/\b054c\b/.test(text)) return "playstation";
  if (/\b045e\b|\b28de\b/.test(text)) return "xbox";
  // Then names that only ever belong to one family.
  if (/nintendo|switch\s*pro|joy-?con|joycon/.test(text)) return "nintendo";
  if (/dualsense|dualshock|playstation|\bps[345]\b/.test(text)) return "playstation";
  if (/xbox|xinput|steam/.test(text)) return "xbox";
  /* Last, and last for a reason: "Wireless Controller" is the whole of the name
   * a PlayStation 4 pad reports through some drivers, and it is also a
   * substring of "Xbox Wireless Controller". Matched earlier it read a real
   * Xbox pad as a PlayStation one and printed R2 on a trigger stamped RT. */
  if (/wireless controller/.test(text)) return "playstation";
  return "generic";
}

/**
 * A hat switch is a NINTH axis, not a stick. Pads that report their d-pad this
 * way (older USB adapters, several 8BitDo modes) otherwise read as "no d-pad"
 * and lose four inputs, so count sticks from the first four axes only.
 */
function stickCount(axes: number): 0 | 1 | 2 {
  if (axes >= 4) return 2;
  if (axes >= 2) return 1;
  return 0;
}

export function describeCapabilities(pad: PadSnapshot): PadCapabilities {
  const buttonCount = pad.buttons.length;
  const axisCount = pad.axes.length;
  return {
    family: familyFromId(pad.id),
    standard: pad.mapping === "standard",
    buttonCount,
    axisCount,
    faceButtons: Math.min(4, buttonCount),
    shoulders: buttonCount > STANDARD_BUTTON.rightShoulder,
    triggers: buttonCount > STANDARD_BUTTON.rightTrigger,
    dpad: buttonCount > STANDARD_BUTTON.dpadRight,
    sticks: stickCount(axisCount),
    stickButtons: buttonCount > STANDARD_BUTTON.rightStick,
    systemButtons: buttonCount > STANDARD_BUTTON.menu,
  };
}

/**
 * Face-button names by family.
 *
 * Index 0 is the BOTTOM face button on every family, and index 1 is the right
 * one. Nintendo prints A on the right and B on the bottom, which is the mirror
 * of the Xbox arrangement, so the same index needs a different letter rather
 * than a different index: a legend that says "A to confirm" on a Switch Pro pad
 * while index 0 is the button marked B is worse than no legend.
 */
const FACE_NAMES: Record<PadFamily, readonly [string, string, string, string]> = {
  xbox: ["A", "B", "X", "Y"],
  playstation: ["Cross", "Circle", "Square", "Triangle"],
  nintendo: ["B", "A", "Y", "X"],
  generic: ["Button 1", "Button 2", "Button 3", "Button 4"],
};

const SHOULDER_NAMES: Record<PadFamily, readonly [string, string, string, string]> = {
  xbox: ["LB", "RB", "LT", "RT"],
  playstation: ["L1", "R1", "L2", "R2"],
  nintendo: ["L", "R", "ZL", "ZR"],
  generic: ["Left shoulder", "Right shoulder", "Left trigger", "Right trigger"],
};

const SYSTEM_NAMES: Record<PadFamily, readonly [string, string]> = {
  xbox: ["View", "Menu"],
  playstation: ["Create", "Options"],
  nintendo: ["Minus", "Plus"],
  generic: ["Select", "Start"],
};

/** The name printed on the device, for a legend and for the mapping screen. */
export function buttonName(family: PadFamily, index: number): string {
  if (index <= STANDARD_BUTTON.faceUp) return FACE_NAMES[family][index] ?? `Button ${index}`;
  if (index <= STANDARD_BUTTON.rightTrigger) {
    return SHOULDER_NAMES[family][index - STANDARD_BUTTON.leftShoulder] ?? `Button ${index}`;
  }
  if (index <= STANDARD_BUTTON.menu) {
    return SYSTEM_NAMES[family][index - STANDARD_BUTTON.view] ?? `Button ${index}`;
  }
  if (index === STANDARD_BUTTON.leftStick) return family === "playstation" ? "L3" : "Left stick";
  if (index === STANDARD_BUTTON.rightStick) return family === "playstation" ? "R3" : "Right stick";
  const dpad = ["D-pad up", "D-pad down", "D-pad left", "D-pad right"][index - STANDARD_BUTTON.dpadUp];
  return dpad ?? `Button ${index}`;
}

/**
 * A stable key for saved bindings.
 *
 * Not the raw `id`: the same physical pad produces different id text in Chrome,
 * Firefox and Safari, so keying on it silently loses a player's mapping when
 * they open the game in another browser. Family plus the counts that actually
 * constrain a layout survives that, and two genuinely different pads of the same
 * shape can share a mapping without either being wrong.
 */
export function padSignature(capabilities: PadCapabilities): string {
  return [
    capabilities.family,
    capabilities.standard ? "standard" : "raw",
    capabilities.buttonCount,
    capabilities.axisCount,
  ].join("/");
}

/** One line for the mapping screen and the connection notice. */
export function describePad(capabilities: PadCapabilities): string {
  const parts = [`${capabilities.buttonCount} buttons`];
  if (capabilities.sticks) parts.push(capabilities.sticks === 2 ? "two sticks" : "one stick");
  if (capabilities.dpad) parts.push("d-pad");
  if (capabilities.triggers) parts.push("triggers");
  else if (capabilities.shoulders) parts.push("shoulder buttons");
  if (!capabilities.standard) parts.push("unrecognised layout");
  return parts.join(", ");
}

/** The connected pads a browser exposes, newest sample each time it is called. */
export function readPads(source?: Pick<Navigator, "getGamepads">): readonly PadSnapshot[] {
  const navigatorLike = source ?? (typeof navigator === "undefined" ? undefined : navigator);
  if (!navigatorLike?.getGamepads) return [];
  const pads: PadSnapshot[] = [];
  for (const pad of navigatorLike.getGamepads()) {
    if (pad?.connected) pads.push(pad);
  }
  return pads;
}
