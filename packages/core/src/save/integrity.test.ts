import { describe, expect, it } from "vitest";
import {
  fnv1aIntegrity,
  stampSavefile,
  verifyStampedSavefile,
} from "./integrity";
import type { SaveIntegrity } from "./integrity";

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("fnv1a integrity digest", () => {
  it("is deterministic", () => {
    expect(fnv1aIntegrity.digest(bytes("hello"))).toBe(
      fnv1aIntegrity.digest(bytes("hello")),
    );
  });

  it("changes when a single byte changes", () => {
    const a = fnv1aIntegrity.digest(bytes("hello"));
    const b = fnv1aIntegrity.digest(bytes("hellp"));
    expect(a).not.toBe(b);
  });

  it("emits 16 hex chars (64-bit)", () => {
    expect(fnv1aIntegrity.digest(bytes("x"))).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("stamp / verify", () => {
  it("verifies an untouched stamped save and recovers the payload", () => {
    const save = bytes("SAVEFILE-CONTENTS");
    const stamped = stampSavefile(save);
    const res = verifyStampedSavefile(stamped);
    expect(res.verified).toBe(true);
    expect(res.unstamped).toBe(false);
    expect(new TextDecoder().decode(res.payload)).toBe("SAVEFILE-CONTENTS");
  });

  it("fails verification when the payload is edited after stamping", () => {
    const stamped = stampSavefile(bytes("gold=100"));
    const tampered = Uint8Array.from(stamped);
    tampered[0] = (tampered[0] as number) ^ 0xff; // edit a payload byte
    const res = verifyStampedSavefile(tampered);
    expect(res.verified).toBe(false);
  });

  it("reports an unstamped (legacy) save rather than throwing", () => {
    const res = verifyStampedSavefile(bytes("raw-no-trailer"));
    expect(res.unstamped).toBe(true);
    expect(res.verified).toBe(false);
  });
});

describe("moddable integrity provider", () => {
  // A mod could inject a stronger (or server-keyed) provider. Here a toy
  // provider stands in; the point is that the seam is honored.
  const modProvider: SaveIntegrity = {
    id: "mod-sum32",
    digest(b) {
      let s = 0;
      for (const x of b) s = (s * 31 + x) >>> 0;
      return s.toString(16).padStart(8, "0");
    },
  };

  it("uses the injected provider for both stamp and verify", () => {
    const stamped = stampSavefile(bytes("state"), modProvider);
    expect(verifyStampedSavefile(stamped, modProvider).verified).toBe(true);
  });

  it("does not verify across mismatched providers (id guard)", () => {
    const stamped = stampSavefile(bytes("state"), modProvider);
    // Default provider sees a different id in the trailer and refuses.
    const res = verifyStampedSavefile(stamped);
    expect(res.verified).toBe(false);
    expect(res.providerId).toBe("mod-sum32");
  });
});
