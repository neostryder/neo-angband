/**
 * User preferences that used to live in a `.prf` file: visual overrides,
 * sound mappings, autoinscriptions and character-screen renderers.
 *
 * A file in the user folder is read once. Each kind of line is written into
 * its document when that document is not already stored, and the file is
 * removed only after those writes read back. A document that does not parse
 * is left alone, and the file stays so the next launch can try again.
 */

import {
  autoinscriptionFormat,
  colorTableFormat,
  entryRendererFormat,
  keymapFormat,
  parseDocument,
  serializeDocument,
  soundMappingFormat,
  subwindowLayoutFormat,
  visualOverrideFormat,
} from "@rpgm-tools/neo-angband-mod-sdk";
import {
  COLOR_TABLE,
  glyphTableSink,
  HostDir,
  host,
  objectShortName,
  processPrefText,
  tvalFindName,
  setColorChannel,
  type DumpDeps,
  type GlyphTable,
  type PrefDeps,
  type PrefSink,
} from "@rpgm-tools/neo-angband-core";
import { saveColorPrefs } from "./colors";
import { looksLikeEnvelope, readStoredDocument, writeStoredDocument } from "./json-storage";
import { encodeActionToken, installKeymapDocument, keymapAdd, keymapModeFor, saveKeymapPrefs } from "./keymap-store";
import {
  parseSubwindowDocument,
  saveLayoutWithBlocks,
  stateFromLayoutPayload,
  type SubwindowState,
} from "./subwindows";

export const VISUAL_PREF_KEY = "neo-angband:visual-overrides";
export const SOUND_PREF_KEY = "neo-angband:sound-mappings";
export const AUTOINSCRIPTION_PREF_KEY = "neo-angband:autoinscriptions";
export const ENTRY_RENDERER_PREF_KEY = "neo-angband:entry-renderers";

const LIGHTS = ["los", "torch", "lit", "dark"] as const;

type VisualData = {
  monsters?: { name: string; color: number; glyph: string }[];
  objects?: { tval: string; sval: string; color: number; glyph: string }[];
  features?: { code: string; lighting: "torch" | "los" | "lit" | "dark" | "all"; color: number; glyph: string }[];
  traps?: { trap: string; lighting: "torch" | "los" | "lit" | "dark" | "all"; color: number; glyph: string }[];
  flavors?: { index: number; color: number; glyph: string }[];
  projections?: { types: string[]; motion: "static" | "deg-0" | "deg-45" | "deg-90" | "deg-135"; color: number; glyph: string }[];
  messages?: { message: number; color: number }[];
};

interface Collected {
  visuals: VisualData;
  sounds: { message: string; samples: string[] }[];
  notes: { tval: string; sval: string; text: string }[];
  renderers: { name: string; colors: string; labelColors: string; symbols: string }[];
  colors: { index: number; kv: number; red: number; green: number; blue: number }[];
  keymaps: { mode: 0 | 1; trigger: string; action: string }[];
  layout: string | null;
  blocks: Record<string, string>;
}

function emptyCollected(): Collected {
  return {
    visuals: {},
    sounds: [],
    notes: [],
    renderers: [],
    colors: [],
    keymaps: [],
    layout: null,
    blocks: {},
  };
}

function glyphOf(code: number): string {
  if (!Number.isInteger(code) || code <= 0) return "";
  return String.fromCodePoint(code);
}

function byte(n: number): number {
  if (!Number.isInteger(n)) return 0;
  return Math.min(255, Math.max(0, n));
}

function lightingName(index: number): "torch" | "los" | "lit" | "dark" | "all" {
  return LIGHTS[index] ?? "all";
}

function motionName(index: number): "static" | "deg-0" | "deg-45" | "deg-90" | "deg-135" {
  return (["static", "deg-0", "deg-45", "deg-90", "deg-135"] as const)[index] ?? "static";
}

function push<T>(list: T[] | undefined, row: T): T[] {
  const next = list ?? [];
  next.push(row);
  return next;
}

/** Lines this port no longer parses, lifted out before the grammar runs. */
function takeRetiredLines(text: string, into: Collected): string {
  const kept: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("neo-subwindows:")) {
      into.layout = line.slice("neo-subwindows:".length);
      continue;
    }
    if (line.startsWith("mod-block:")) {
      const rest = line.slice("mod-block:".length);
      const split = rest.indexOf(":");
      if (split > 0) into.blocks[rest.slice(0, split)] = rest.slice(split + 1);
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

const LEGACY_DIRECTIVES = new Set([
  "?", "%", "feat", "trap", "monster", "monster-base", "object", "flavor",
  "GF", "inscribe", "message", "sound", "color", "window", "entry-renderer",
  "keymap-act", "keymap-input",
]);

function collectFile(text: string, deps: PrefDeps, glyphs: GlyphTable, into: Collected): boolean {
  let complete = true;
  const clean = (rawText: string): string => {
    const body = takeRetiredLines(rawText, into);
    for (const raw of body.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      if (!LEGACY_DIRECTIVES.has(line.split(":", 1)[0]!)) complete = false;
    }
    return body;
  };
  const body = clean(text);
  const races = glyphs.gamedata.races;
  const features = glyphs.gamedata.features;
  const kinds = glyphs.gamedata.kinds;
  const sink = glyphTableSink(glyphs, {
    keymapInput: (mode, trigger, action) => {
      if (mode === 0 || mode === 1) into.keymaps.push({ mode, trigger, action });
    },
    messageColor: (index, color) => {
      into.visuals.messages = push(into.visuals.messages, { message: index, color: byte(color) });
    },
    colorTable: (index, kv, red, green, blue) => {
      into.colors.push({ index, kv: byte(kv), red: byte(red), green: byte(green), blue: byte(blue) });
    },
    sound: (type, sounds) => {
      const samples = sounds.split(/\s+/u).filter((sample) => sample.length > 0);
      if (type.length > 0 && samples.length > 0) into.sounds.push({ message: type, samples });
    },
    addAutoinscription: (kidx, textNote) => {
      const kind = kinds.find((row) => row.kidx === kidx);
      if (!kind?.name || !kind.tval) return;
      into.notes.push({
        tval: tvalFindName(kind.tval),
        sval: objectShortName(kind.name),
        text: textNote,
      });
    },
    entryRenderer: (name, colors, labelColors, symbols) => {
      into.renderers.push({
        name,
        colors: colors ?? "*",
        labelColors: labelColors ?? "*",
        symbols: symbols ?? "",
      });
    },
  });
  const recording: PrefSink = {
    ...sink,
    loadFile: (name) => {
      const nested = host().read(HostDir.USER, name);
      if (nested === null) {
        complete = false;
        return null;
      }
      return clean(nested);
    },
    setMonster: (ridx, attr, char) => {
      const name = races.find((race) => race.ridx === ridx)?.name;
      if (!name) return;
      into.visuals.monsters = push(into.visuals.monsters, { name, color: byte(attr), glyph: glyphOf(char) });
    },
    setKind: (kidx, attr, char) => {
      const kind = kinds.find((row) => row.kidx === kidx);
      if (!kind?.name || !kind.tval) return;
      into.visuals.objects = push(into.visuals.objects, {
        tval: tvalFindName(kind.tval),
        sval: objectShortName(kind.name),
        color: byte(attr),
        glyph: glyphOf(char),
      });
    },
    setFeat: (lighting, fidx, attr, char) => {
      const feature = features.find((row) => row.fidx === fidx);
      if (!feature?.code) return;
      into.visuals.features = push(into.visuals.features, {
        code: feature.code,
        lighting: lightingName(lighting),
        color: byte(attr),
        glyph: glyphOf(char),
      });
    },
    setTrap: (lighting, tidx, attr, char) => {
      const trap = deps.traps?.[tidx];
      into.visuals.traps = push(into.visuals.traps, {
        trap: trap?.name ?? String(tidx),
        lighting: lightingName(lighting),
        color: byte(attr),
        glyph: glyphOf(char),
      });
    },
    setFlavor: (fidx, attr, char) => {
      into.visuals.flavors = push(into.visuals.flavors, { index: fidx, color: byte(attr), glyph: glyphOf(char) });
    },
    setProjection: (proj, motion, attr, char) => {
      into.visuals.projections = push(into.visuals.projections, {
        types: [String(proj)],
        motion: motionName(motion),
        color: byte(attr),
        glyph: glyphOf(char),
      });
    },
  };
  return processPrefText(body, deps, recording).length === 0 && complete;
}

function storedStatus(key: string, format: { format: string }): "absent" | "ready" | "blocked" {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return "blocked";
  }
  if (raw === null || !looksLikeEnvelope(raw)) return "absent";
  return parseDocument(raw, format.format).ok ? "ready" : "blocked";
}

function visualLines(data: VisualData): string {
  const lines: string[] = [];
  for (const row of data.monsters ?? []) lines.push(`monster:${row.name}:${row.color}:${row.glyph.codePointAt(0) ?? 0}`);
  for (const row of data.objects ?? []) lines.push(`object:${row.tval}:${row.sval}:${row.color}:${row.glyph.codePointAt(0) ?? 0}`);
  for (const row of data.features ?? []) {
    const light = row.lighting === "all" ? "*" : row.lighting;
    lines.push(`feat:${row.code}:${light}:${row.color}:${row.glyph.codePointAt(0) ?? 0}`);
  }
  for (const row of data.traps ?? []) {
    const light = row.lighting === "all" ? "*" : row.lighting;
    lines.push(`trap:${row.trap}:${light}:${row.color}:${row.glyph.codePointAt(0) ?? 0}`);
  }
  for (const row of data.flavors ?? []) lines.push(`flavor:${row.index}:${row.color}:${row.glyph.codePointAt(0) ?? 0}`);
  for (const row of data.projections ?? []) {
    const motion = row.motion === "static" ? "static" : row.motion.slice(4);
    lines.push(`GF:${row.types.join("|")}:${motion}:${row.color}:${row.glyph.codePointAt(0) ?? 0}`);
  }
  return lines.join("\n");
}

/**
 * A mod's JSON preference resource as pref-grammar text (#288).
 *
 * A mod resource is transient: applied on every load, gone when the mod is off,
 * and never written into the player's own stored documents. Rendering the
 * document back into the directive lines its fields came from lets it run
 * through `applyPrefText` exactly as a `.prf` resource did, including the
 * replay of tile directives on a fresh graphics map. Returns null for a
 * document this path does not take (a subwindow layout, an unknown format) or
 * one that does not validate.
 */
export function modPreferenceText(text: string): string | null {
  let tag = "";
  try {
    const value = JSON.parse(text) as { format?: unknown };
    tag = typeof value.format === "string" ? value.format : "";
  } catch {
    return null;
  }
  const lines: string[] = [];
  if (tag === visualOverrideFormat.format) {
    const parsed = parseDocument(text, visualOverrideFormat);
    if (!parsed.ok) return null;
    const body = visualLines(parsed.data);
    if (body) lines.push(body);
    /* parse_message takes a numeric message name, and a colour by its name. */
    for (const row of parsed.data.messages ?? []) {
      lines.push(`message:${row.message}:${COLOR_TABLE[row.color]?.name ?? "White"}`);
    }
  } else if (tag === colorTableFormat.format) {
    const parsed = parseDocument(text, colorTableFormat);
    if (!parsed.ok) return null;
    parsed.data.colors.forEach((row, index) => {
      lines.push(`color:${index}:${row.kv}:${row.color.red}:${row.color.green}:${row.color.blue}`);
    });
  } else if (tag === soundMappingFormat.format) {
    const parsed = parseDocument(text, soundMappingFormat);
    if (!parsed.ok) return null;
    for (const row of parsed.data.mappings) lines.push(`sound:${row.message}:${row.samples.join(" ")}`);
  } else if (tag === autoinscriptionFormat.format) {
    const parsed = parseDocument(text, autoinscriptionFormat);
    if (!parsed.ok) return null;
    for (const row of parsed.data.notes) lines.push(`inscribe:${row.tval}:${row.sval}:${row.text}`);
  } else if (tag === entryRendererFormat.format) {
    const parsed = parseDocument(text, entryRendererFormat);
    if (!parsed.ok) return null;
    for (const row of parsed.data.renderers) {
      lines.push(`entry-renderer:${row.name}:${row.colors}:${row.labelColors}:${row.symbols}`);
    }
  } else if (tag === keymapFormat.format) {
    const parsed = parseDocument(text, keymapFormat);
    if (!parsed.ok) return null;
    /* keymap-act fills the parser's buffer and keymap-input consumes it, the
     * same pairing upstream's keymap dump writes. KEYMAP_MODE_ORIG is 0. */
    for (const row of parsed.data.bindings) {
      lines.push(`keymap-act:${row.action.map((step) => encodeActionToken(step.key)).join("")}`);
      lines.push(`keymap-input:${row.mode === "orig" ? 0 : 1}:${row.trigger.key}`);
    }
  } else {
    return null;
  }
  return lines.join("\n");
}

/** Apply a visual document to the live glyph table. A bad document does nothing. */
export function applyVisualDocument(glyphs: GlyphTable, deps: PrefDeps, extra: Partial<PrefSink> = {}): boolean {
  const read = readStoredDocument(localStorage, VISUAL_PREF_KEY, visualOverrideFormat, () => null);
  if (!read.data) return false;
  processPrefText(visualLines(read.data), deps, glyphTableSink(glyphs, extra));
  for (const row of read.data.messages ?? []) extra.messageColor?.(row.message, row.color);
  return true;
}

export function saveVisualDocument(data: VisualData): boolean {
  return writeStoredDocument(localStorage, VISUAL_PREF_KEY, visualOverrideFormat, data) !== null;
}

export function clearVisualDocument(): void {
  try {
    const raw = localStorage.getItem(VISUAL_PREF_KEY);
    if (raw && looksLikeEnvelope(raw) && !parseDocument(raw, visualOverrideFormat).ok) return;
    localStorage.removeItem(VISUAL_PREF_KEY);
  } catch {
    /* Storage can be unavailable. The live table was still reset. */
  }
}

function sectionDocument(glyphs: GlyphTable, deps: DumpDeps, section: "monsters" | "objects" | "features" | "flavors"): VisualData {
  if (section === "monsters") {
    const monsters = [];
    for (const race of deps.monsters.races) {
      if (!race.name) continue;
      const painted = glyphs.monsterGlyph(race.ridx);
      monsters.push({ name: race.name, color: byte(painted?.attr ?? 0), glyph: painted?.char ?? "" });
    }
    return { monsters };
  }
  if (section === "objects") {
    const objects = [];
    for (const kind of deps.objects.kinds) {
      if (!kind.name || !kind.tval) continue;
      const painted = glyphs.kindGlyph(kind.kidx);
      objects.push({
        tval: tvalFindName(kind.tval),
        sval: objectShortName(kind.name),
        color: byte(painted?.attr ?? 0),
        glyph: painted?.char ?? "",
      });
    }
    return { objects };
  }
  if (section === "features") {
    const features = [];
    for (const feature of deps.features.allFeatures()) {
      if (!feature.name || feature.mimic !== null) continue;
      for (let light = 0; light < LIGHTS.length; light++) {
        const painted = glyphs.featGlyph(light, feature.fidx);
        features.push({
          code: feature.code,
          lighting: LIGHTS[light]!,
          color: byte(painted?.attr ?? 0),
          glyph: painted?.char ?? "",
        });
      }
    }
    return { features };
  }
  const flavors = [];
  for (const flavor of deps.objects.flavors) {
    const painted = glyphs.flavorGlyph(flavor.fidx);
    flavors.push({ index: flavor.fidx, color: byte(painted?.attr ?? 0), glyph: painted?.char ?? "" });
  }
  return { flavors };
}

export function exportVisualSection(
  glyphs: GlyphTable,
  deps: DumpDeps,
  section: "monsters" | "objects" | "features" | "flavors",
): string {
  return serializeDocument(visualOverrideFormat, sectionDocument(glyphs, deps, section));
}

export interface PreferenceImport {
  readonly glyphs: GlyphTable;
  readonly deps: PrefDeps;
  readonly extra?: Partial<PrefSink>;
  readonly applyLayout?: (state: SubwindowState, blocks: Record<string, string>) => void;
  readonly applyColors?: () => void;
  readonly applyKeymaps?: () => void;
  readonly applySounds?: () => void;
}

/** Read one JSON preference file and apply the document it names. */
export function importPreferenceDocument(text: string, target: PreferenceImport): "applied" | "invalid" | "unknown" {
  let tag = "";
  try {
    const value = JSON.parse(text) as { format?: unknown };
    tag = typeof value.format === "string" ? value.format : "";
  } catch {
    return "unknown";
  }
  if (tag === visualOverrideFormat.format) {
    const parsed = parseDocument(text, visualOverrideFormat);
    if (!parsed.ok) return "invalid";
    const current = readStoredDocument(localStorage, VISUAL_PREF_KEY, visualOverrideFormat, () => null);
    const merged = { ...(current.data ?? {}), ...parsed.data };
    if (!saveVisualDocument(merged)) return "invalid";
    processPrefText(visualLines(parsed.data), target.deps, glyphTableSink(target.glyphs, target.extra));
    for (const row of parsed.data.messages ?? []) target.extra?.messageColor?.(row.message, row.color);
    return "applied";
  }
  if (tag === soundMappingFormat.format) {
    const parsed = parseDocument(text, soundMappingFormat);
    if (!parsed.ok) return "invalid";
    if (writeStoredDocument(localStorage, SOUND_PREF_KEY, soundMappingFormat, parsed.data) === null) return "invalid";
    target.applySounds?.();
    return "applied";
  }
  if (tag === autoinscriptionFormat.format) {
    const parsed = parseDocument(text, autoinscriptionFormat);
    if (!parsed.ok) return "invalid";
    if (writeStoredDocument(localStorage, AUTOINSCRIPTION_PREF_KEY, autoinscriptionFormat, parsed.data) === null) return "invalid";
    applyNotes(parsed.data.notes, target.glyphs, target.deps, target.extra);
    return "applied";
  }
  if (tag === entryRendererFormat.format) {
    const parsed = parseDocument(text, entryRendererFormat);
    if (!parsed.ok) return "invalid";
    if (writeStoredDocument(localStorage, ENTRY_RENDERER_PREF_KEY, entryRendererFormat, parsed.data) === null) return "invalid";
    applyRenderers(parsed.data.renderers, target.extra);
    return "applied";
  }
  if (tag === colorTableFormat.format) {
    const parsed = parseDocument(text, colorTableFormat);
    if (!parsed.ok) return "invalid";
    if (writeStoredDocument(localStorage, "neo-angband:colors", colorTableFormat, parsed.data) === null) return "invalid";
    target.applyColors?.();
    return "applied";
  }
  if (tag === keymapFormat.format) {
    if (!installKeymapDocument(text)) return "invalid";
    target.applyKeymaps?.();
    return "applied";
  }
  if (tag === subwindowLayoutFormat.format) {
    const parsed = parseSubwindowDocument(text);
    if (!parsed) return "invalid";
    const blocks = parsed.modBlocks ?? {};
    if (!saveLayoutWithBlocks(parsed, blocks)) return "invalid";
    target.applyLayout?.(parsed, blocks);
    return "applied";
  }
  return tag.length > 0 ? "invalid" : "unknown";
}

function applyNotes(
  notes: readonly { tval: string; sval: string; text: string }[],
  _glyphs: GlyphTable,
  deps: PrefDeps,
  extra: Partial<PrefSink> | undefined,
): void {
  if (!extra?.addAutoinscription) return;
  for (const note of notes) {
    const kind = deps.objects.kinds.find((row) => row.name && row.tval &&
      tvalFindName(row.tval) === note.tval && objectShortName(row.name) === note.sval);
    if (kind) extra.addAutoinscription(kind.kidx, note.text);
  }
}

function applyRenderers(
  renderers: readonly { name: string; colors: string; labelColors: string; symbols: string }[],
  extra: Partial<PrefSink> | undefined,
): void {
  if (!extra?.entryRenderer) return;
  for (const row of renderers) {
    extra.entryRenderer(
      row.name,
      row.colors === "*" ? null : row.colors,
      row.labelColors === "*" ? null : row.labelColors,
      row.symbols,
    );
  }
}

export interface ConvertPrefsInput {
  readonly glyphs: GlyphTable;
  readonly deps: PrefDeps;
  readonly extra?: Partial<PrefSink>;
  readonly applyLayout: (state: SubwindowState, blocks: Record<string, string>) => void;
}

/**
 * Read every user `.prf` once. Domains that already have a document keep it.
 * The file is deleted only when every domain it fed was stored or already
 * present. A blocked document keeps the file.
 */
export function convertStoredUserPrefFiles(input: ConvertPrefsInput): void {
  let names: string[];
  try {
    names = host().list(HostDir.USER).filter((name) => name.toLowerCase().endsWith(".prf")).sort();
  } catch {
    return;
  }
  if (names.length === 0) return;
  const collected = emptyCollected();
  const readable: string[] = [];
  let complete = true;
  for (const name of names) {
    const text = host().read(HostDir.USER, name);
    if (text === null) {
      complete = false;
      continue;
    }
    readable.push(name);
    if (!collectFile(text, input.deps, input.glyphs, collected)) complete = false;
  }
  if (readable.length === 0 || !complete) return;
  let blocked = false;
  const visualStatus = storedStatus(VISUAL_PREF_KEY, visualOverrideFormat);
  if (visualStatus === "blocked") blocked = true;
  else if (visualStatus === "absent" && Object.keys(collected.visuals).length > 0) {
    if (!saveVisualDocument(collected.visuals)) blocked = true;
  }
  const soundStatus = storedStatus(SOUND_PREF_KEY, soundMappingFormat);
  if (soundStatus === "blocked") blocked = true;
  else if (soundStatus === "absent" && collected.sounds.length > 0) {
    if (writeStoredDocument(localStorage, SOUND_PREF_KEY, soundMappingFormat, { mappings: collected.sounds }) === null) {
      blocked = true;
    }
  }
  const noteStatus = storedStatus(AUTOINSCRIPTION_PREF_KEY, autoinscriptionFormat);
  if (noteStatus === "blocked") blocked = true;
  else if (noteStatus === "absent" && collected.notes.length > 0) {
    if (writeStoredDocument(localStorage, AUTOINSCRIPTION_PREF_KEY, autoinscriptionFormat, { notes: collected.notes }) === null) {
      blocked = true;
    }
  }
  const rendererStatus = storedStatus(ENTRY_RENDERER_PREF_KEY, entryRendererFormat);
  if (rendererStatus === "blocked") blocked = true;
  else if (rendererStatus === "absent" && collected.renderers.length > 0) {
    if (writeStoredDocument(localStorage, ENTRY_RENDERER_PREF_KEY, entryRendererFormat, { renderers: collected.renderers }) === null) {
      blocked = true;
    }
  }
  const colorStatus = storedStatus("neo-angband:colors", colorTableFormat);
  if (colorStatus === "blocked") blocked = true;
  else if (colorStatus === "absent" && collected.colors.length > 0) {
    for (const row of collected.colors) {
      setColorChannel(row.index, 0, row.kv);
      setColorChannel(row.index, 1, row.red);
      setColorChannel(row.index, 2, row.green);
      setColorChannel(row.index, 3, row.blue);
    }
    if (!saveColorPrefs()) blocked = true;
  }
  const keymapStatus = storedStatus("neo-angband:keymaps", keymapFormat);
  if (keymapStatus === "blocked") blocked = true;
  else if (keymapStatus === "absent" && collected.keymaps.length > 0) {
    for (const row of collected.keymaps) {
      keymapAdd(keymapModeFor(row.mode === 1), row.trigger, row.action);
    }
    if (!saveKeymapPrefs()) blocked = true;
  }
  const layoutStatus = storedStatus("neo-angband:subwindows", subwindowLayoutFormat);
  if (layoutStatus === "blocked") blocked = true;
  else if (layoutStatus === "absent" && (collected.layout !== null || Object.keys(collected.blocks).length > 0)) {
    const state = collected.layout !== null ? stateFromLayoutPayload(collected.layout) : null;
    if (collected.layout !== null && state === null) blocked = true;
    else if (!saveLayoutWithBlocks(state, collected.blocks)) blocked = true;
    else if (state) input.applyLayout(state, collected.blocks);
  }
  if (blocked) return;
  for (const name of readable) host().remove(HostDir.USER, name);
}

/** Play the stored sound document on top of the compiled map. */
export function storedSoundMappings(): { type: string; sounds: string }[] {
  try {
    const read = readStoredDocument(localStorage, SOUND_PREF_KEY, soundMappingFormat, () => null);
    if (!read.data) return [];
    return read.data.mappings.map((row) => ({ type: row.message, sounds: row.samples.join(" ") }));
  } catch {
    return [];
  }
}

export function applyStoredEntryRenderers(extra: Partial<PrefSink>): void {
  try {
    const read = readStoredDocument(localStorage, ENTRY_RENDERER_PREF_KEY, entryRendererFormat, () => null);
    if (read.data) applyRenderers(read.data.renderers, extra);
  } catch {
    /* A damaged document stays stored and this session keeps the defaults. */
  }
}

export function consumeStoredAutoinscriptions(glyphs: GlyphTable, deps: PrefDeps, extra: Partial<PrefSink>): void {
  try {
    if (!extra.addAutoinscription) return;
    const read = readStoredDocument(localStorage, AUTOINSCRIPTION_PREF_KEY, autoinscriptionFormat, () => null);
    if (read.blocked) return;
    if (read.data) applyNotes(read.data.notes, glyphs, deps, extra);
  } catch {
    /* Leave the document for the next launch. */
  }
}
