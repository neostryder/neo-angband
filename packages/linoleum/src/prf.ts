/**
 * Legacy .prf selector parsing for the Linoleum tile-pack converter.
 *
 * Faithful port of the selector-reading half of Aaron's
 * scripts/build-linoleum-packs.ps1 (upstream fork). PowerShell string
 * comparisons are case-insensitive by default, so type/variant matching
 * here is deliberately case-insensitive too.
 */

const HEX_BYTE_PATTERN = /^0x[0-9A-Fa-f]{2}$/;

/** One parsed legacy selector line from a .prf file. */
export interface LegacySelector {
  /** Selector type exactly as written in the source line (feat, trap, GF, ...). */
  type: string;
  /** Logical value without variant or condition suffixes. */
  logicalValue: string;
  /** Exact selector value including :variant and :when:<query> suffixes. */
  exactSelectorValue: string;
  /** Base selector value used for compatibility aliases. */
  compatibilitySelectorValue: string;
  /** Variant for feat/trap selectors; "*" when unstated. */
  variant: string;
  /** Condition from a preceding ?: line, or null. */
  condition: string | null;
  /** Base name of the .prf file the line came from. */
  sourceFile: string;
  /** Original (trimmed) source line text. */
  sourceLine: string;
  /** Monotonic order across all parsed pref files. */
  sourceOrder: number;
  /** Sheet row: attr byte masked with 0x7F. */
  row: number;
  /** Sheet column: char byte masked with 0x7F. */
  column: number;
}

/** A pref file's content ready for selector extraction. */
export interface PrefSource {
  /** Base file name (used for provenance in reports). */
  name: string;
  /** Raw lines of the file. */
  lines: readonly string[];
}

/**
 * Strip a legacy inline comment: whitespace followed by "#" to end of line.
 * Mirrors Remove-LegacyInlineComment (regex "\s+#.*$", then TrimEnd).
 */
export function removeLegacyInlineComment(lineText: string): string {
  return lineText.replace(/\s+#.*$/, "").trimEnd();
}

function isBlankOrWhitespace(text: string): boolean {
  return text.trim().length === 0;
}

function hexByteToInt(value: string): number {
  if (!HEX_BYTE_PATTERN.test(value)) {
    throw new Error(`Invalid tile byte '${value}'.`);
  }
  return Number.parseInt(value, 16);
}

/**
 * Parse one selector line. Returns null for lines that are not recognized
 * selector rules (mirrors Parse-LegacySelectorLine returning $null).
 */
export function parseLegacySelectorLine(
  lineText: string,
  condition: string | null,
  sourceFile: string,
  sourceOrder: number,
): LegacySelector | null {
  const sanitizedLine = removeLegacyInlineComment(lineText);
  if (isBlankOrWhitespace(sanitizedLine)) {
    return null;
  }

  const parts = sanitizedLine.split(":");
  if (parts.length < 4) {
    return null;
  }

  const attrText = parts[parts.length - 2];
  const charText = parts[parts.length - 1];
  if (
    attrText === undefined ||
    charText === undefined ||
    !HEX_BYTE_PATTERN.test(attrText) ||
    !HEX_BYTE_PATTERN.test(charText)
  ) {
    return null;
  }

  const type = parts[0] ?? "";
  const typeLower = type.toLowerCase();
  let logicalValue: string;
  let variant = "*";

  if (typeLower === "feat" || typeLower === "trap") {
    logicalValue = parts[1] ?? "";
    if (parts.length > 4) {
      variant = parts[2] ?? "";
    }
  } else if (
    typeLower === "gf" ||
    typeLower === "monster" ||
    typeLower === "object" ||
    typeLower === "flavor"
  ) {
    // The logical value may itself contain colons; join the middle parts.
    logicalValue = parts.slice(1, parts.length - 2).join(":");
  } else {
    return null;
  }

  if (isBlankOrWhitespace(logicalValue)) {
    return null;
  }

  let exactSelectorValue = logicalValue;
  if (typeLower === "feat" || typeLower === "trap") {
    exactSelectorValue = `${exactSelectorValue}:${variant}`;
  }
  if (condition !== null && !isBlankOrWhitespace(condition)) {
    exactSelectorValue = `${exactSelectorValue}:when:${condition}`;
  }

  return {
    type,
    logicalValue,
    exactSelectorValue,
    compatibilitySelectorValue: logicalValue,
    variant,
    condition,
    sourceFile,
    sourceLine: lineText,
    sourceOrder,
    row: hexByteToInt(attrText) & 0x7f,
    column: hexByteToInt(charText) & 0x7f,
  };
}

/**
 * Read selectors from a sequence of pref sources.
 *
 * Faithful quirks kept from the ps1:
 * - a ?: condition applies to the NEXT selector-candidate line only, and is
 *   consumed even when that line fails to parse;
 * - the pending condition and the source-order counter carry across file
 *   boundaries (they are not reset between pref files);
 * - the source-order counter increments for every candidate line, parsed or
 *   not.
 */
export function readLegacySelectors(sources: readonly PrefSource[]): LegacySelector[] {
  const result: LegacySelector[] = [];
  let currentCondition: string | null = null;
  let order = 0;

  for (const source of sources) {
    for (const line of source.lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith("#") || trimmed.startsWith("%:")) {
        continue;
      }
      if (trimmed.startsWith("?:")) {
        currentCondition = trimmed.slice(2).trim();
        continue;
      }

      const entry = parseLegacySelectorLine(trimmed, currentCondition, source.name, order);
      currentCondition = null;
      order += 1;

      if (entry !== null) {
        result.push(entry);
      }
    }
  }

  return result;
}
