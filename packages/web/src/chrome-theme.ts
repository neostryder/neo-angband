/**
 * The window chrome's look: title bars, tabs, buttons, dividers and drop
 * guides around the panels. index.html draws it from `--chrome-*` custom
 * properties whose defaults are Angband's own palette and 8x13 dialog font. A
 * mod holding `display:filter` can repaint it through
 * `ctx.display.setChromeTheme`, and clearing the request puts the game's own
 * look back.
 */

/** Colours accept #rgb, #rrggbb, #rrggbbaa or rgb()/rgba(). */
export interface ChromeTheme {
  /** A font family already loaded in the page, for example with the FontFace API. */
  readonly font?: string;
  /** Font size in CSS pixels, 8 to 24. */
  readonly fontSize?: number;
  /** Behind every panel, and the dividers' ground. */
  readonly page?: string;
  readonly titleBackground?: string;
  readonly text?: string;
  readonly textStrong?: string;
  readonly muted?: string;
  readonly border?: string;
  readonly divider?: string;
  readonly dividerHover?: string;
  /** Selected tab, drop guides and hover outlines. */
  readonly accent?: string;
  readonly floatBorder?: string;
  /** Corner rounding in CSS pixels, 0 to 16. */
  readonly radius?: number;
  /** A drop shadow under floating panels. */
  readonly shadow?: boolean;
}

const COLOR_KEYS = {
  page: "--chrome-page",
  titleBackground: "--chrome-title-bg",
  text: "--chrome-text",
  textStrong: "--chrome-text-strong",
  muted: "--chrome-muted",
  border: "--chrome-border",
  divider: "--chrome-gutter",
  dividerHover: "--chrome-gutter-hover",
  accent: "--chrome-accent",
  floatBorder: "--chrome-float-border",
} as const satisfies Partial<Record<keyof ChromeTheme, string>>;

/** Every property a theme can set, so clearing one removes them all. */
export const CHROME_PROPERTIES: readonly string[] = [
  ...Object.values(COLOR_KEYS),
  "--chrome-accent-rgb",
  "--chrome-font",
  "--chrome-font-size",
  "--chrome-radius",
  "--chrome-shadow",
];

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i;
const FAMILY = /^[\w "'.,-]{1,120}$/;

/** The colour as "r, g, b" for rgba() use, or null when it is not a colour this accepts. */
export function colorChannels(color: string): string | null {
  const text = color.trim();
  if (HEX.test(text)) {
    const hex = text.slice(1);
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex.slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)).join(", ");
  }
  const rgb = RGB.exec(text);
  if (!rgb) return null;
  const channels = rgb.slice(1, 4).map(Number);
  return channels.every((n) => n <= 255) ? channels.join(", ") : null;
}

/** Check a theme a mod supplied, returning a frozen copy or throwing with the reason. */
export function validateChromeTheme(value: unknown): ChromeTheme {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("a chrome theme is an object");
  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(input)) {
    const item = input[key];
    if (item === undefined) continue;
    if (key in COLOR_KEYS) {
      if (typeof item !== "string" || colorChannels(item) === null) throw new TypeError(`chrome theme ${key} is not a colour`);
      out[key] = item.trim();
    } else if (key === "font") {
      if (typeof item !== "string" || !FAMILY.test(item)) throw new TypeError("chrome theme font is not a font family name");
      out[key] = item;
    } else if (key === "fontSize" || key === "radius") {
      const [min, max] = key === "fontSize" ? [8, 24] : [0, 16];
      if (typeof item !== "number" || !Number.isFinite(item) || item < min || item > max) {
        throw new TypeError(`chrome theme ${key} must be a number from ${min} to ${max}`);
      }
      out[key] = item;
    } else if (key === "shadow") {
      if (typeof item !== "boolean") throw new TypeError("chrome theme shadow is true or false");
      out[key] = item;
    } else {
      throw new TypeError(`chrome theme has no setting called ${key}`);
    }
  }
  return Object.freeze(out) as ChromeTheme;
}

/** Set the chrome's properties from a theme, or remove them all for the game's own look. */
export function applyChromeTheme(theme: ChromeTheme | null, root: HTMLElement = document.documentElement): void {
  for (const property of CHROME_PROPERTIES) root.style.removeProperty(property);
  if (!theme) return;
  for (const [key, property] of Object.entries(COLOR_KEYS)) {
    const color = theme[key as keyof typeof COLOR_KEYS];
    if (color) root.style.setProperty(property, color);
  }
  if (theme.accent) root.style.setProperty("--chrome-accent-rgb", colorChannels(theme.accent)!);
  if (theme.font) root.style.setProperty("--chrome-font", `${theme.font}, monospace`);
  if (theme.fontSize !== undefined) root.style.setProperty("--chrome-font-size", `${theme.fontSize}px`);
  if (theme.radius !== undefined) root.style.setProperty("--chrome-radius", `${theme.radius}px`);
  if (theme.shadow !== undefined) root.style.setProperty("--chrome-shadow", theme.shadow ? "0 4px 18px rgba(0, 0, 0, 0.6)" : "none");
}
