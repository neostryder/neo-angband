/**
 * The two copies of the SCREEN ABI must agree.
 *
 * There are two on purpose, and for the same reason `plugin-abi-agreement.test.ts`
 * gives for its pair. `ScreenShown` in `packages/web/src/screen-view.ts` is what
 * the HOST calls on a handle a presenter returned; `ScreenShown` in
 * `packages/mod-sdk/src/screen.ts` is what a mod AUTHOR compiles against. The web
 * copy cannot be the SDK's - it names host types (`ScreenLine`, core's
 * `MenuSemantics`) that a mod must not have to resolve - and the SDK's cannot be
 * the host's, because the SDK ships without the engine. The duplication is
 * deliberate and stays.
 *
 * WHAT IS NOT ALLOWED IS DISAGREEMENT, and they disagreed. `yieldTerminal` - the
 * member the game calls to tell a presenter that a prompt is about to take the
 * terminal underneath it - was on NEITHER published copy while
 * `screen-runtime.ts` called it through a private `YieldingScreen` interface. It
 * worked by coincidence: TypeScript accepts a handle with an extra member against
 * a `ScreenShown | undefined` return, so a presenter that implemented it happened
 * to be called. What that cost is everything a published member buys - an author
 * reading the SDK could not LEARN the member exists, and nothing checked the
 * signature of the one they wrote, so `yieldTerminal(request: string)` compiled
 * and was handed a `PromptRequest` at runtime.
 *
 * `PromptRequest` is checked here too, and it is the half that would rot
 * quietly: the member list is what a presenter implements, but the request's
 * FIELDS are what it reads, and a field added on one side is invisible on the
 * other until a mod reads `undefined` off a request the game filled in.
 *
 * This reads both FILES rather than importing both types, and that is the whole
 * technique: two structurally identical interfaces are, to the compiler, the same
 * type - so a check that imports them both is satisfied by whichever one it
 * resolved and can never see them part. Structural typing is precisely what hid
 * the defect; a test that relies on it would inherit the blindness.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sdkSrc = readFileSync(fileURLToPath(new URL("./screen.ts", import.meta.url)), "utf8");
const hostScreenSrc = readFileSync(
  fileURLToPath(new URL("../../web/src/screen-view.ts", import.meta.url)),
  "utf8",
);
/* The host's `PromptRequest` lives apart from its `ScreenShown`, because the
 * announcement is built by the game and the handle is built by the mod. The SDK
 * publishes both from one module - a mod imports the vocabulary of one sentence. */
const hostPromptSrc = readFileSync(
  fileURLToPath(new URL("../../web/src/prompt-view.ts", import.meta.url)),
  "utf8",
);

/** One interface's body, or "" when the file does not declare it. */
function body(src: string, name: string): string {
  return new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`, "u").exec(src)?.[1] ?? "";
}

/**
 * The members an interface declares, sorted.
 *
 * Two leading spaces are required, which is what keeps a member apart from the
 * `*` of a doc comment and from anything nested inside a member's own type.
 */
function members(src: string, name: string): string[] {
  return [...body(src, name).matchAll(/^ {2}(?:readonly )?(\w+)\??[(:]/gmu)]
    .map((m) => m[1]!)
    .sort();
}

/** One member's declaration line, whitespace-collapsed, for comparing signatures. */
function signature(src: string, name: string, member: string): string {
  const line = body(src, name)
    .split("\n")
    .find((l) => new RegExp(`^ {2}(?:readonly )?${member}\\??[(:]`, "u").test(l));
  return (line ?? "").trim().replace(/\s+/gu, " ");
}

describe("the host and the SDK publish the same ScreenShown", () => {
  it("finds both copies, so an empty scan cannot pass", () => {
    /* Two members today. Asserting a floor rather than the number keeps this from
     * failing for the good reason - a member being added - while still refusing a
     * regex that matched nothing, which is the failure that would make every
     * assertion below vacuously true. */
    expect(members(hostScreenSrc, "ScreenShown").length).toBeGreaterThan(1);
    expect(members(sdkSrc, "ScreenShown").length).toBeGreaterThan(1);
  });

  it("declares the same members", () => {
    expect(members(sdkSrc, "ScreenShown")).toEqual(members(hostScreenSrc, "ScreenShown"));
  });

  it("declares yieldTerminal with the same signature, character for character", () => {
    /* The signature is the half a member list cannot see. A copy that declared
     * `yieldTerminal?(request: string)` would have the same member list and would
     * be a different ABI - which is the exact shape this seam shipped in. */
    const sdk = signature(sdkSrc, "ScreenShown", "yieldTerminal");
    expect(sdk).toBe("yieldTerminal?(request: PromptRequest | null): void | Promise<void>;");
    expect(signature(hostScreenSrc, "ScreenShown", "yieldTerminal")).toBe(sdk);
  });

  it("says the same thing about it to the author, in the same words", () => {
    /* The sentence matters as much as the rule, for the reason the plugin ABI's
     * own agreement test gives: the doc comment is what a mod author reads, and
     * two tools disagreeing about what a member means is how these break. */
    const sentence =
      "stand aside for\n   * `request`, and take the screen back when `request` is null.";
    expect(sdkSrc).toContain(sentence);
    expect(hostScreenSrc).toContain(sentence);
    /* And the one fact a presenter cannot discover by reading the signature. */
    for (const src of [sdkSrc, hostScreenSrc]) {
      expect(src).toContain("AWAITED BEFORE ANYTHING IS DRAWN");
      expect(src).toContain("OPTIONAL, and leaving it out is not a fault");
    }
  });
});

describe("the host and the SDK publish the same PromptRequest", () => {
  it("finds both copies, so an empty scan cannot pass", () => {
    expect(members(hostPromptSrc, "PromptRequest").length).toBeGreaterThan(3);
    expect(members(sdkSrc, "PromptRequest").length).toBeGreaterThan(3);
  });

  it("carries the same fields", () => {
    expect(members(sdkSrc, "PromptRequest")).toEqual(members(hostPromptSrc, "PromptRequest"));
  });

  it("gives every field the same type", () => {
    for (const field of members(hostPromptSrc, "PromptRequest")) {
      expect(signature(sdkSrc, "PromptRequest", field)).toBe(
        signature(hostPromptSrc, "PromptRequest", field),
      );
    }
  });

  it("agrees on the two extents, which decide how much a presenter hides", () => {
    /* A third value on one side would be a shape a presenter has no branch for. */
    const extent = /export type PromptExtent = ([^;]+);/u;
    const sdk = extent.exec(sdkSrc)?.[1];
    expect(sdk).toBe('"line" | "screen"');
    expect(extent.exec(hostPromptSrc)?.[1]).toBe(sdk);
  });
});
