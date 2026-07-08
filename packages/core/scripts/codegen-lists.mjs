#!/usr/bin/env node
/**
 * codegen-lists.mjs - generate packages/core/src/generated/*.ts from the
 * upstream X-macro list headers reference/src/list-*.h (Angband 4.2.6).
 *
 * Run manually from anywhere:
 *
 *   node packages/core/scripts/codegen-lists.mjs
 *
 * For every reference/src/list-<name>.h this emits src/generated/<name>.ts
 * with:
 *   - a const tuple of entries keeping every macro argument as a named
 *     field (true/false -> boolean, NULL -> null, integer literals ->
 *     number, C string literals -> string, other identifiers/expressions
 *     -> raw string), and
 *   - an enum-like const mapping NAME -> upstream enum value. Where the
 *     upstream consumer enum prepends values before including the header
 *     (e.g. OF_NONE, EF_NONE, the stats in front of OBJ_MOD_*, the
 *     elements in front of PROJ_*), those implicit entries are included so
 *     the numeric values match upstream exactly.
 *
 * Also emits src/generated/index.ts re-exporting every module.
 *
 * The parser handles multi-line entries, string arguments containing
 * commas/parens, escaped quotes, and #if/#endif sections (preprocessor
 * lines are dropped and everything is included).
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..", "..");
const referenceSrc = join(repoRoot, "reference", "src");
const outDir = join(scriptDir, "..", "src", "generated");

/**
 * Per-header descriptors. `fields` names each macro argument in order
 * (field 0 is always the entry name and is kept verbatim as a string).
 * `implicitPrepend` lists names the consumer enum places before the
 * header's entries; `implicitFromHeader` prepends every entry name of
 * another list header (mirroring cross-header enum composition upstream).
 * Field names follow the comment block in each header and the consuming
 * struct in reference/src (noted in `consumer`).
 */
const DESCRIPTORS = {
  "list-dun-profiles.h": {
    macro: "DUN",
    entriesExport: "DUN_PROFILE_ENTRIES",
    mapExport: "DUN",
    fields: ["name", "builder"],
    doc: "Dungeon profiles: name and builder function (generate.c cave_builders).",
  },
  "list-effects.h": {
    macro: "EFFECT",
    entriesExport: "EFFECT_ENTRIES",
    mapExport: "EF",
    fields: [
      "name",
      "aim",
      "info",
      "args",
      "infoFlags",
      "description",
      "menuName",
    ],
    implicitPrepend: ["NONE"],
    doc: "Effects (effects.h enum effect_index prepends EF_NONE; EF_<name> == entry index + 1).",
  },
  "list-elements.h": {
    macro: "ELEM",
    entriesExport: "ELEMENT_ENTRIES",
    mapExport: "ELEM",
    fields: ["name"],
    doc: "Elements used in spells and attacks (object.h ELEM_ enum; ACID is 0).",
  },
  "list-equip-slots.h": {
    macro: "EQUIP",
    entriesExport: "EQUIP_SLOT_ENTRIES",
    mapExport: "EQUIP",
    fields: [
      "name",
      "acidVuln",
      "named",
      "mention",
      "heavyDescribe",
      "describe",
    ],
    doc: "Equipment slot types (obj-gear.h EQUIP_ enum; fields per header comment: slot, acid_v, name, mention, heavy describe, describe).",
  },
  "list-history-types.h": {
    macro: "HIST",
    entriesExport: "HISTORY_TYPE_ENTRIES",
    mapExport: "HIST",
    fields: ["name", "description"],
    doc: "History message types (player-history.h HIST_ enum).",
  },
  "list-ignore-types.h": {
    macro: "ITYPE",
    entriesExport: "IGNORE_TYPE_ENTRIES",
    mapExport: "ITYPE",
    fields: ["name", "description"],
    doc: "Object kinds for quality/ego ignoring (obj-ignore.h ITYPE_ enum).",
  },
  "list-kind-flags.h": {
    macro: "KF",
    entriesExport: "KIND_FLAG_ENTRIES",
    mapExport: "KF",
    fields: ["name", "message"],
    doc: "Object kind flags (obj-properties.h KF_ enum).",
  },
  "list-message.h": {
    macro: "MSG",
    entriesExport: "MESSAGE_ENTRIES",
    mapExport: "MSG",
    fields: ["name", "sound"],
    doc: "Message types (message.h MSG_ enum; sound is the sound.prf entry name).",
  },
  "list-mon-message.h": {
    macro: "MON_MSG",
    entriesExport: "MON_MESSAGE_ENTRIES",
    mapExport: "MON_MSG",
    fields: ["name", "msgType", "omitSubject", "text"],
    doc: "Monster message types (mon-msg.h MON_MSG_ enum; fields per header comment: id, msg, omit_subject, text).",
  },
  "list-mon-race-flags.h": {
    macro: "RF",
    entriesExport: "MON_RACE_FLAG_ENTRIES",
    mapExport: "RF",
    fields: ["name", "type", "description"],
    doc: "Monster race flags (monster.h RF_ enum; type is an RFT_ category).",
  },
  "list-mon-spells.h": {
    macro: "RSF",
    entriesExport: "MON_SPELL_ENTRIES",
    mapExport: "RSF",
    fields: ["name", "type"],
    doc: "Monster spell flags (monster.h RSF_ enum; type is an RST_ bitmask expression kept as written).",
  },
  "list-mon-temp-flags.h": {
    macro: "MFLAG",
    entriesExport: "MON_TEMP_FLAG_ENTRIES",
    mapExport: "MFLAG",
    fields: ["name", "description"],
    doc: "Temporary monster flags (monster.h MFLAG_ enum).",
  },
  "list-mon-timed.h": {
    macro: "MON_TMD",
    entriesExport: "MON_TIMED_ENTRIES",
    mapExport: "MON_TMD",
    fields: [
      "name",
      "save",
      "stack",
      "resistFlag",
      "time",
      "messageBegin",
      "messageEnd",
      "messageIncrease",
    ],
    doc: "Monster timed effects (mon-timed.h MON_TMD_ enum; fields per header comment).",
  },
  "list-object-flags.h": {
    macro: "OF",
    entriesExport: "OBJECT_FLAG_ENTRIES",
    mapExport: "OF",
    fields: ["name", "debugLabel"],
    implicitPrepend: ["NONE"],
    doc: "Object flags (obj-properties.h enum prepends OF_NONE; OF_<name> == entry index + 1, so flags are 1-indexed for bitflag sets).",
  },
  "list-object-modifiers.h": {
    macro: "OBJ_MOD",
    entriesExport: "OBJECT_MODIFIER_ENTRIES",
    mapExport: "OBJ_MOD",
    fields: ["name"],
    implicitFromHeader: "list-stats.h",
    doc: "Object modifiers (obj-properties.h OBJ_MOD_ enum starts with the five stats from list-stats.h, so STEALTH is 5).",
  },
  "list-options.h": {
    macro: "OP",
    entriesExport: "OPTION_ENTRIES",
    mapExport: "OPT",
    fields: ["name", "description", "type", "normal"],
    doc: "Options (option.h OPT_ enum; type is an option page category, normal is the default value).",
  },
  "list-origins.h": {
    macro: "ORIGIN",
    entriesExport: "ORIGIN_ENTRIES",
    mapExport: "ORIGIN",
    fields: ["name", "args", "description"],
    doc: "Object origins (object.h ORIGIN_ enum; args is the format argument count per obj-info.c).",
  },
  "list-parser-errors.h": {
    macro: "PARSE_ERROR",
    entriesExport: "PARSER_ERROR_ENTRIES",
    mapExport: "PARSE_ERROR",
    fields: ["name", "description"],
    doc: "Parser errors (parser.h enum parser_error).",
  },
  "list-player-flags.h": {
    macro: "PF",
    entriesExport: "PLAYER_FLAG_ENTRIES",
    mapExport: "PF",
    fields: ["name"],
    doc: "Player race and class flags (player.h PF_ enum).",
  },
  "list-player-timed.h": {
    macro: "TMD",
    entriesExport: "PLAYER_TIMED_ENTRIES",
    mapExport: "TMD",
    fields: ["name", "flagRedraw", "flagUpdate"],
    doc: "Timed player properties (player-timed.h TMD_ enum; redraw/update are PR_/PU_ bitmask expressions kept as written).",
  },
  "list-projections.h": {
    macro: "PROJ",
    entriesExport: "PROJECTION_ENTRIES",
    mapExport: "PROJ",
    fields: ["name"],
    implicitFromHeader: "list-elements.h",
    doc: "Projection types (project.h PROJ_ enum lists the 25 elements first, so LIGHT_WEAK is 25).",
  },
  "list-randart-properties.h": {
    macro: "ART_IDX",
    entriesExport: "RANDART_PROPERTY_ENTRIES",
    mapExport: "ART_IDX",
    fields: ["name", "supercharge"],
    doc: "Randart generation properties (obj-randart.h ART_IDX_ enum).",
  },
  "list-room-flags.h": {
    macro: "ROOMF",
    entriesExport: "ROOM_FLAG_ENTRIES",
    mapExport: "ROOMF",
    fields: ["name", "help"],
    implicitPrepend: ["NONE"],
    doc: "Room type flags (generate.h enum prepends ROOMF_NONE; ROOMF_<name> == entry index + 1).",
  },
  "list-rooms.h": {
    macro: "ROOM",
    entriesExport: "ROOM_ENTRIES",
    mapExport: "ROOM",
    fields: ["name", "rows", "cols", "builder"],
    doc: "Dungeon room builders (generate.c room_builders; rows/cols are vault maxima).",
  },
  "list-square-flags.h": {
    macro: "SQUARE",
    entriesExport: "SQUARE_FLAG_ENTRIES",
    mapExport: "SQUARE",
    fields: ["name", "description"],
    doc: "Special grid flags (cave.h SQUARE_ enum).",
  },
  "list-stats.h": {
    macro: "STAT",
    entriesExport: "STAT_ENTRIES",
    mapExport: "STAT",
    fields: ["name"],
    doc: "Player stats (player.h STAT_ enum; order matches the sustains in list-object-flags.h).",
  },
  "list-terrain-flags.h": {
    macro: "TF",
    entriesExport: "TERRAIN_FLAG_ENTRIES",
    mapExport: "TF",
    fields: ["name", "description"],
    doc: "Terrain flags (cave.h TF_ enum).",
  },
  "list-terrain.h": {
    macro: "FEAT",
    entriesExport: "TERRAIN_ENTRIES",
    mapExport: "FEAT",
    fields: ["name"],
    doc: "Terrain (feature) types (cave.h FEAT_ enum; stored as uint8 upstream).",
  },
  "list-trap-flags.h": {
    macro: "TRF",
    entriesExport: "TRAP_FLAG_ENTRIES",
    mapExport: "TRF",
    fields: ["name", "description"],
    doc: "Trap properties (trap.h TRF_ enum).",
  },
  "list-tvals.h": {
    macro: "TV",
    entriesExport: "TVAL_ENTRIES",
    mapExport: "TV",
    fields: ["name", "textName"],
    doc: "Object base types (obj-properties.h/obj-tval TV_ enum; fields per header comment: code_name, string_name).",
  },
  "list-ui-entry-renderers.h": {
    macro: "UI_ENTRY_RENDERER",
    entriesExport: "UI_ENTRY_RENDERER_ENTRIES",
    mapExport: "UI_ENTRY_RENDERER",
    fields: [
      "name",
      "defaultCombinerName",
      "defaultColors",
      "defaultLabelColors",
      "defaultSymbols",
      "defaultNDigit",
      "defaultSign",
    ],
    doc: "Second character screen renderers (ui-entry-renderers.c struct backend_info).",
  },
};

/**
 * Strip C comments, respecting string and char literals. Comments are
 * replaced with a single space so tokens stay separated.
 */
function stripComments(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '"' || c === "'") {
      const quote = c;
      out += c;
      i++;
      while (i < text.length) {
        out += text[i];
        if (text[i] === "\\") {
          out += text[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (text[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
      out += " ";
      continue;
    }
    if (c === "/" && next === "/") {
      const end = text.indexOf("\n", i + 2);
      i = end === -1 ? text.length : end;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Drop preprocessor directive lines (keeping conditional bodies). */
function stripPreprocessor(text) {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

/**
 * Find every `MACRO( ... )` invocation and return its argument lists,
 * splitting on top-level commas and respecting nested parens and strings.
 */
function extractInvocations(text, macro) {
  const results = [];
  let i = 0;
  while (i < text.length) {
    const idx = text.indexOf(macro, i);
    if (idx === -1) break;
    const before = idx === 0 ? "" : text[idx - 1];
    if (before && /[A-Za-z0-9_]/.test(before)) {
      i = idx + macro.length;
      continue;
    }
    let j = idx + macro.length;
    while (j < text.length && /\s/.test(text[j])) j++;
    if (text[j] !== "(") {
      i = idx + macro.length;
      continue;
    }
    j++;
    const args = [];
    let current = "";
    let depth = 1;
    while (j < text.length && depth > 0) {
      const c = text[j];
      if (c === '"' || c === "'") {
        const quote = c;
        current += c;
        j++;
        while (j < text.length) {
          current += text[j];
          if (text[j] === "\\") {
            current += text[j + 1] ?? "";
            j += 2;
            continue;
          }
          if (text[j] === quote) {
            j++;
            break;
          }
          j++;
        }
        continue;
      }
      if (c === "(") depth++;
      if (c === ")") {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
      if (depth === 1 && c === ",") {
        args.push(current);
        current = "";
        j++;
        continue;
      }
      current += c;
      j++;
    }
    args.push(current);
    results.push(args.map((a) => a.trim()));
    i = j;
  }
  return results;
}

/** Decode a C string literal body (between the quotes). */
function decodeCString(body) {
  let out = "";
  let i = 0;
  const escapes = {
    n: "\n",
    t: "\t",
    r: "\r",
    "0": "\0",
    "\\": "\\",
    '"': '"',
    "'": "'",
  };
  while (i < body.length) {
    const c = body[i];
    if (c === "\\") {
      const e = body[i + 1];
      out += Object.hasOwn(escapes, e) ? escapes[e] : e;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Convert one raw C macro argument to a JS value: booleans, NULL -> null,
 * integer literals -> number, string literals (including adjacent literal
 * concatenation) -> string, anything else (identifiers, bitmask
 * expressions) -> the raw text.
 */
function convertValue(raw) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "NULL") return null;
  if (/^[+-]?\d+$/.test(raw)) return Number(raw);
  if (raw.startsWith('"')) {
    /* One or more adjacent string literals. */
    let out = "";
    let i = 0;
    while (i < raw.length) {
      if (raw[i] !== '"') {
        i++;
        continue;
      }
      i++;
      let body = "";
      while (i < raw.length && raw[i] !== '"') {
        if (raw[i] === "\\") {
          body += raw[i] + (raw[i + 1] ?? "");
          i += 2;
          continue;
        }
        body += raw[i];
        i++;
      }
      i++;
      out += decodeCString(body);
    }
    return out;
  }
  /* Identifier or expression: collapse multi-line whitespace runs. */
  return raw.replace(/\s+/g, " ");
}

/** Emit a JS value as ASCII-safe TypeScript source. */
function emitValue(value) {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

/** Emit a map key, quoting when not a valid identifier. */
function emitKey(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function moduleBaseName(header) {
  return header.replace(/^list-/, "").replace(/\.h$/, "");
}

function parseHeader(header) {
  const descriptor = DESCRIPTORS[header];
  if (!descriptor) {
    throw new Error(`No descriptor for ${header}; add one to codegen-lists.mjs`);
  }
  const text = stripPreprocessor(
    stripComments(readFileSync(join(referenceSrc, header), "utf8")),
  );
  const invocations = extractInvocations(text, descriptor.macro);
  if (invocations.length === 0) {
    throw new Error(`No ${descriptor.macro}() entries found in ${header}`);
  }
  const entries = invocations.map((args, n) => {
    if (args.length !== descriptor.fields.length) {
      throw new Error(
        `${header} entry ${n} has ${args.length} args, expected ` +
          `${descriptor.fields.length}: ${args.join(" | ")}`,
      );
    }
    const entry = {};
    descriptor.fields.forEach((field, k) => {
      if (k === 0) {
        /* The entry name: keep identifiers verbatim (even NULL, as in
         * TV(NULL, ...)); decode quoted names (list-rooms and friends). */
        entry[field] = args[0].startsWith('"')
          ? convertValue(args[0])
          : args[0];
      } else {
        entry[field] = convertValue(args[k]);
      }
    });
    return entry;
  });
  return { descriptor, entries };
}

function generate() {
  const headers = readdirSync(referenceSrc)
    .filter((f) => /^list-.*\.h$/.test(f))
    .sort();

  const parsed = new Map();
  for (const header of headers) parsed.set(header, parseHeader(header));

  mkdirSync(outDir, { recursive: true });

  const barrel = [];
  let totalEntries = 0;

  for (const header of headers) {
    const { descriptor, entries } = parsed.get(header);
    totalEntries += entries.length;

    /* Names the consumer enum places before this header's entries. */
    let implicit = [];
    if (descriptor.implicitPrepend) {
      implicit = [...descriptor.implicitPrepend];
    } else if (descriptor.implicitFromHeader) {
      const other = parsed.get(descriptor.implicitFromHeader);
      if (!other) {
        throw new Error(
          `${header}: implicitFromHeader ${descriptor.implicitFromHeader} not parsed`,
        );
      }
      implicit = other.entries.map((e) => e.name);
    }

    const mapNames = [...implicit, ...entries.map((e) => e.name)];
    const seen = new Set();
    for (const name of mapNames) {
      if (seen.has(name)) {
        throw new Error(`${header}: duplicate entry name ${name}`);
      }
      seen.add(name);
    }

    const lines = [];
    lines.push(
      `// Generated from reference/src/${header} by scripts/codegen-lists.mjs. Do not edit.`,
    );
    lines.push("");
    lines.push("/**");
    lines.push(` * ${descriptor.doc}`);
    if (implicit.length > 0) {
      lines.push(" *");
      lines.push(
        ` * The upstream enum places ${implicit.length} value(s) before this`,
      );
      lines.push(
        ` * header's entries, so ${descriptor.mapExport} values start at ` +
          `${implicit.length} while the`,
      );
      lines.push(" * entries tuple is indexed from 0.");
    }
    lines.push(" */");
    lines.push("");
    lines.push(`export const ${descriptor.entriesExport} = [`);
    for (const entry of entries) {
      const fields = descriptor.fields
        .map((f) => `${f}: ${emitValue(entry[f])}`)
        .join(", ");
      lines.push(`  { ${fields} },`);
    }
    lines.push("] as const;");
    lines.push("");
    lines.push(
      `/** NAME -> upstream enum value (${descriptor.mapExport}_ prefix upstream). */`,
    );
    lines.push(`export const ${descriptor.mapExport} = {`);
    mapNames.forEach((name, value) => {
      lines.push(`  ${emitKey(name)}: ${value},`);
    });
    lines.push("} as const;");
    lines.push("");

    const base = moduleBaseName(header);
    writeFileSync(join(outDir, `${base}.ts`), lines.join("\n"));
    barrel.push(`export * from "./${base}";`);
    console.log(
      `${header} -> generated/${base}.ts (${entries.length} entries)`,
    );
  }

  const indexLines = [
    "// Generated by scripts/codegen-lists.mjs from reference/src/list-*.h. Do not edit.",
    "",
    ...barrel,
    "",
  ];
  writeFileSync(join(outDir, "index.ts"), indexLines.join("\n"));
  console.log(
    `Wrote ${headers.length} modules (${totalEntries} entries) and index.ts`,
  );
}

generate();
