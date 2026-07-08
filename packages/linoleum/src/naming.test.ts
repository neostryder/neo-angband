import { describe, expect, it } from "vitest";
import { deterministicAssetName, selectorKey, stableHashHex } from "./naming.js";

describe("deterministicAssetName", () => {
  it("lowercases and slugs type:selector, appending _0", () => {
    expect(deterministicAssetName("feat", "FLOOR:lit")).toBe("feat_floor_lit_0");
    expect(deterministicAssetName("monster", "Farmer Maggot")).toBe("monster_farmer_maggot_0");
  });

  it("collapses runs of non-alphanumerics and trims edge underscores", () => {
    // "feat:LESS:*" -> "feat_less_" -> trimmed
    expect(deterministicAssetName("feat", "LESS:*")).toBe("feat_less_0");
    expect(deterministicAssetName("GF", "DARK | DARK_WEAK | HOLY_ORB | MANA:0")).toBe(
      "gf_dark_dark_weak_holy_orb_mana_0_0",
    );
  });

  it("keeps slugs of exactly 61 characters unhashed", () => {
    // Real case from the bundled xtra pref corpus: 61-char slug, no hash.
    const name = deterministicAssetName(
      "monster",
      "<player>:when:[AND [EQU $CLASS Warrior] [EQU $RACE Half-Troll] ]",
    );
    expect(name).toBe("monster_player_when_and_equ_class_warrior_equ_race_half_troll_0");
  });

  it("caps slugs over 61 chars with a 4-byte md5 suffix", () => {
    // Cross-checked against New-DeterministicAssetName in the original ps1.
    const name = deterministicAssetName(
      "monster",
      "<player>:when:[AND [EQU $CLASS Blackguard] [EQU $RACE Half-Troll] ]",
    );
    expect(name).toBe("monster_player_when_and_equ_class_blackguard_equ_rac_b7f0ee32_0");
    // Structure: 52-char prefix + "_" + 8 hex chars + "_0".
    expect(name).toMatch(/^[a-z0-9_]{52}_[0-9a-f]{8}_0$/);
  });

  it("falls back to the lowercased type when the slug is empty", () => {
    expect(deterministicAssetName("GF", "***")).toBe("gf_0");
  });

  it("is deterministic", () => {
    const a = deterministicAssetName("monster", "Grip, Farmer Maggot's dog");
    const b = deterministicAssetName("monster", "Grip, Farmer Maggot's dog");
    expect(a).toBe(b);
    expect(a).toBe("monster_grip_farmer_maggot_s_dog_0");
  });
});

describe("stableHashHex", () => {
  it("returns the first 4 md5 bytes as 8 lowercase hex chars", () => {
    // md5("abc") = 900150983cd24fb0d6963f7d28e17f72
    expect(stableHashHex("abc")).toBe("90015098");
  });
});

describe("selectorKey", () => {
  it("is case-insensitive like a PowerShell hashtable key", () => {
    expect(selectorKey("feat", "FLOOR:lit")).toBe(selectorKey("FEAT", "floor:LIT"));
  });

  it("separates type and selector with a newline", () => {
    expect(selectorKey("feat", "FLOOR")).toBe("feat\nfloor");
  });
});
