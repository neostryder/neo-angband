import { describe, expect, it } from "vitest";
import {
  COMPAT_CLAIMS,
  DEFAULT_PACK_GROUP,
  ManifestError,
  PACK_GROUPS,
  SECTION_BANDS,
  validateManifest,
} from "./manifest.js";

/** A minimal valid manifest, plus whatever the test is actually about. */
function manifest(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: "frost", name: "Frost", version: "1.0.0", shape: "content", ...extra };
}

/** The message of the ManifestError `fn` throws; fails the test if it does not throw. */
function refusal(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ManifestError);
    return (e as Error).message;
  }
  throw new Error("expected a ManifestError, got none");
}

describe("sections", () => {
  it("accepts a fully specified section", () => {
    expect(() =>
      validateManifest(
        manifest({
          sections: [
            {
              id: "kobold-rebalance",
              title: "Kobold rebalance",
              description: "Faster, weaker kobolds.",
              default: false,
              priority: "late",
              flag: "frost.kobolds",
            },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it("accepts a section that is only an id and a title", () => {
    expect(() =>
      validateManifest(manifest({ sections: [{ id: "tiles", title: "Tiles" }] })),
    ).not.toThrow();
  });

  it("accepts retired rule or section names on the current section", () => {
    expect(
      validateManifest(
        manifest({
          sections: [
            {
              id: "text-corrections",
              title: "Text corrections",
              flag: "bugfix.textAndHistory",
              /* The self-name is deliberate: this used to be a rule and is
               * now a section with the same hook flag. */
              renamedSectionFlags: ["bugfix.textAndHistory", "old-text-section"],
            },
          ],
        }),
      ).sections?.[0]?.renamedSectionFlags,
    ).toEqual(["bugfix.textAndHistory", "old-text-section"]);
  });

  it("refuses malformed or repeated retired section names", () => {
    const section = (renamedSectionFlags: unknown): Record<string, unknown> =>
      manifest({ sections: [{ id: "text", title: "Text", renamedSectionFlags }] });
    expect(() => validateManifest(section("old-text"))).toThrow(/must be an array/);
    expect(() => validateManifest(section([""]))).toThrow(/non-empty strings/);
    expect(() => validateManifest(section(["old-text", "old-text"]))).toThrow(
      /repeats old-text/,
    );
  });

  it("refuses a section id that is not kebab-case, naming what it got", () => {
    const why = refusal(() =>
      validateManifest(manifest({ sections: [{ id: "Kobold_Rebalance", title: "x" }] })),
    );
    expect(why).toContain("Kobold_Rebalance");
    expect(why).toContain("kebab-case");
  });

  it("refuses two sections with the same id", () => {
    const why = refusal(() =>
      validateManifest(
        manifest({
          sections: [
            { id: "tiles", title: "A" },
            { id: "tiles", title: "B" },
          ],
        }),
      ),
    );
    expect(why).toContain("duplicate section id tiles");
  });

  it("refuses a section with no title, because the toggle would have no label", () => {
    expect(() => validateManifest(manifest({ sections: [{ id: "tiles" }] }))).toThrow(
      ManifestError,
    );
  });

  it("refuses a priority that is not a band, listing the bands", () => {
    const why = refusal(() =>
      validateManifest(manifest({ sections: [{ id: "t", title: "T", priority: 3 }] })),
    );
    for (const band of SECTION_BANDS) expect(why).toContain(band);
  });

  it("accepts every band", () => {
    for (const band of SECTION_BANDS) {
      expect(() =>
        validateManifest(manifest({ sections: [{ id: "t", title: "T", priority: band }] })),
      ).not.toThrow();
    }
  });
});

describe("section flags vs rule flags", () => {
  it("refuses two sections exposing the same flag", () => {
    const why = refusal(() =>
      validateManifest(
        manifest({
          sections: [
            { id: "a", title: "A", flag: "frost.x" },
            { id: "b", title: "B", flag: "frost.x" },
          ],
        }),
      ),
    );
    expect(why).toContain("another section");
  });

  /* The cross-vocabulary case: both reach the mod's hooks.ts through ONE flag
   * map, so a clash silently gives one name two meanings inside the mod's code. */
  it("refuses a section whose flag a rule already declares, and says it was a rule", () => {
    const why = refusal(() =>
      validateManifest(
        manifest({
          rules: [{ flag: "frost.x", title: "X", description: "", default: true }],
          sections: [{ id: "b", title: "B", flag: "frost.x" }],
        }),
      ),
    );
    expect(why).toContain("a rule");
    expect(why).not.toContain("another section");
  });

  /* A section's flag DEFAULTS to its id, so the collision can happen without the
   * author writing `flag` at all - which is the shape that would slip through a
   * check that only compared explicit flags. */
  it("catches the collision when the section's flag is its implicit id", () => {
    expect(() =>
      validateManifest(
        manifest({
          rules: [{ flag: "tiles", title: "T", description: "", default: true }],
          sections: [{ id: "tiles", title: "Tiles" }],
        }),
      ),
    ).toThrow(ManifestError);
  });
});

describe("group", () => {
  it("accepts every shipped group and an absent one", () => {
    expect(() => validateManifest(manifest())).not.toThrow();
    for (const g of PACK_GROUPS) {
      expect(() => validateManifest(manifest({ group: g }))).not.toThrow();
    }
  });

  /* Refused, not coerced to the default: a typo that silently sorts as "content"
   * is a mod that orders wrong with no error anywhere - the tilePacks lesson. */
  it("refuses an unknown group instead of falling back to the default", () => {
    const why = refusal(() => validateManifest(manifest({ group: "cosmetics" })));
    expect(why).toContain("cosmetics");
    for (const g of PACK_GROUPS) expect(why).toContain(g);
  });

  it("has a default that is one of the groups", () => {
    expect(PACK_GROUPS).toContain(DEFAULT_PACK_GROUP);
  });
});

describe("compat", () => {
  const claim = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    with: "runes",
    claim: "prefer-theirs",
    because: "We both set kobold speed.",
    ...extra,
  });

  it("accepts a claim naming a version range", () => {
    expect(() =>
      validateManifest(manifest({ compat: [claim({ range: "<2.0.0" })] })),
    ).not.toThrow();
  });

  it("accepts every claim kind", () => {
    for (const c of COMPAT_CLAIMS) {
      const extra = c === "patches" ? { claim: c, scope: ["fix"] } : { claim: c };
      expect(() =>
        validateManifest(
          manifest({ sections: [{ id: "fix", title: "Fix" }], compat: [claim(extra)] }),
        ),
      ).not.toThrow();
    }
  });

  /* A claim with no reason becomes a warning that is always there and never
   * actionable, which is how a conflict list turns into wallpaper. */
  it("refuses a claim with no because", () => {
    const why = refusal(() =>
      validateManifest(manifest({ compat: [{ with: "runes", claim: "conflicts" }] })),
    );
    expect(why).toContain("because");
  });

  it("refuses an empty because as firmly as a missing one", () => {
    expect(() =>
      validateManifest(manifest({ compat: [claim({ because: "" })] })),
    ).toThrow(ManifestError);
  });

  it("refuses an unknown claim kind, listing the kinds", () => {
    const why = refusal(() =>
      validateManifest(manifest({ compat: [claim({ claim: "prefer-mine-please" })] })),
    );
    for (const c of COMPAT_CLAIMS) expect(why).toContain(c);
  });

  it("refuses a claim against itself", () => {
    const why = refusal(() => validateManifest(manifest({ compat: [claim({ with: "frost" })] })));
    expect(why).toContain("itself");
  });

  /* scope names the CLAIMANT's own sections. A typo would otherwise scope the
   * claim to nothing and silently never apply. */
  it("refuses a scope that is not one of this pack's sections", () => {
    const why = refusal(() =>
      validateManifest(
        manifest({
          sections: [{ id: "kobolds", title: "K" }],
          compat: [claim({ scope: ["koblods"] })],
        }),
      ),
    );
    expect(why).toContain("koblods");
    expect(why).toContain("not one of this pack's sections");
  });

  it("accepts a scope that names a declared section", () => {
    expect(() =>
      validateManifest(
        manifest({
          sections: [{ id: "kobolds", title: "K" }],
          compat: [claim({ scope: ["kobolds"] })],
        }),
      ),
    ).not.toThrow();
  });

  /* "patches" with no scope is the whole pack becoming conditional on another,
   * which `dependencies` already expresses - and with a version check. */
  it("refuses a patches claim that names no scope, pointing at dependencies", () => {
    const why = refusal(() =>
      validateManifest(manifest({ compat: [claim({ claim: "patches" })] })),
    );
    expect(why).toContain("dependencies");
  });

  it("allows the other claim kinds to omit scope, meaning the whole pack", () => {
    expect(() => validateManifest(manifest({ compat: [claim()] }))).not.toThrow();
  });
});

describe("the new fields are all optional", () => {
  /* Every shipped manifest predates them. If any became required, every mod in
   * the catalogue would stop loading - so this is the compatibility ratchet. */
  it("validates a manifest carrying none of sections, group or compat", () => {
    const m = validateManifest(manifest());
    expect(m.sections).toBeUndefined();
    expect(m.group).toBeUndefined();
    expect(m.compat).toBeUndefined();
  });
});
