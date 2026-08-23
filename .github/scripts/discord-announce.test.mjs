import { describe, expect, it } from "vitest";
import { fitToLimit } from "./discord-announce.mjs";

const CHANGELOG_URL = "https://github.com/neostryder/neo-angband-mod-forge/releases/tag/v0.1.0";
const NOTICE_LENGTH = `\n\n*(cut short - [full changelog](${CHANGELOG_URL}))*`.length;

/** maxChars that leaves exactly `budget` chars for the body itself. */
function maxCharsFor(budget) {
  return NOTICE_LENGTH + budget;
}

describe("fitToLimit", () => {
  it("returns the body unchanged when it already fits", () => {
    const body = "Short changelog entry.";
    expect(fitToLimit(body, 4096, CHANGELOG_URL)).toBe(body);
  });

  it("truncates at the last \\n\\n-delimited block that fits", () => {
    const kept = "Intro paragraph.\n\n### Added";
    // Padded well past maxChars so the initial "already fits" short-circuit
    // doesn't apply and a real truncation is exercised.
    const overflow = "First item text. ".repeat(20).trim();
    const body = [kept, overflow, "Second item text."].join("\n\n");
    const result = fitToLimit(body, maxCharsFor(kept.length + 5), CHANGELOG_URL);
    expect(result.startsWith(kept)).toBe(true);
    expect(result).toContain("(cut short");
    expect(result).not.toContain("Second item text.");
  });

  it("truncates mid-list instead of dropping an oversized list block wholesale", () => {
    // Reflowed markdown never puts a blank line between list items, so a long
    // list is ONE \n\n-delimited block - reproduces the neo-angband-mod-forge
    // v0.1.0 changelog shape that silently dropped the entire list before the fix.
    const intro = "The first version.";
    const heading = "### Added";
    const items = Array.from({ length: 20 }, (_, i) => `- **Item ${i}** with enough body text to add real length to this bullet point.`);
    const body = [intro, heading, items.join("\n")].join("\n\n");

    const maxChars = maxCharsFor(200);
    const result = fitToLimit(body, maxChars, CHANGELOG_URL);

    expect(result).toContain(intro);
    expect(result).toContain(heading);
    // The old behaviour returned just intro + heading + notice, with none of
    // the list surviving. At least the first item must now come through.
    expect(result).toContain("- **Item 0**");
    expect(result).toContain("(cut short");
    expect(result.length).toBeLessThanOrEqual(maxChars);
  });

  it("stops before a single line that alone would overflow the remaining budget", () => {
    const body = ["Intro.", `- ${"x".repeat(500)}`].join("\n\n");
    const maxChars = maxCharsFor(20);
    const result = fitToLimit(body, maxChars, CHANGELOG_URL);
    expect(result.length).toBeLessThanOrEqual(maxChars);
    expect(result.startsWith("Intro.")).toBe(true);
    expect(result).not.toContain("x".repeat(500));
    expect(result).toContain("(cut short");
  });

  it("falls back to a hard slice when even the first block cannot fit at all", () => {
    const body = "x".repeat(5000);
    const maxChars = maxCharsFor(50);
    const result = fitToLimit(body, maxChars, CHANGELOG_URL);
    expect(result.length).toBeLessThanOrEqual(maxChars);
    expect(result.startsWith("x")).toBe(true);
  });
});
