/**
 * The declared-field rule, exercised through real composition rather than by
 * calling applyFieldPolicy directly wherever it is possible to do so - a policy
 * that works in isolation and is not reached by the loader is a feature unrun.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkUnqualified, declaredFields, isExtensionKey } from "./fields.js";
import type { FieldDecl } from "./fields.js";
import { composeContentPacks } from "./loader.js";
import type { LoadedPack } from "./loader.js";
import { ManifestError, validateManifest } from "./manifest.js";
import type { PackManifest } from "./manifest.js";

function manifest(id: string, fields?: FieldDecl[]): PackManifest {
  const m: PackManifest = { id, name: id, version: "1.0.0", shape: "content" };
  if (fields) m.fields = fields;
  return m;
}

/** Two daggers, so "the rule applied to every record" is distinguishable. */
function corePack(): LoadedPack {
  return {
    manifest: manifest("core"),
    files: {
      object: {
        records: [
          { name: "Dagger", type: "sword", attack: { hd: "1d4" } },
          { name: "Main Gauche", type: "sword", attack: { hd: "1d5" } },
        ],
      },
      monster: { records: [{ name: "Kobold", hp: 8 }] },
    },
  };
}

/** A mod that writes `key` onto the Dagger, declaring `decl` (or nothing). */
function modWriting(id: string, key: string, value: unknown, decl?: FieldDecl[]): LoadedPack {
  return {
    manifest: { ...manifest(id, decl), dependencies: { core: "*" } },
    files: {
      object: { fieldPatches: { "core:sword--dagger": [{ op: "set", path: key, value }] } },
    },
  } as unknown as LoadedPack;
}

function dagger(records: unknown[] | undefined): Record<string, unknown> {
  const found = (records as Record<string, unknown>[]).find((r) => r["name"] === "Dagger");
  expect(found, "the Dagger record survived composition").toBeDefined();
  return found as Record<string, unknown>;
}

describe("the separator the whole rule rests on", () => {
  it("appears in no key of core's own gamedata", () => {
    /* If core ever ships a key with a colon in it, "contains a colon" stops
     * meaning "a mod added this" and the policy starts stripping core's own
     * fields. This is the assumption; here it is, measured, next to the code
     * that depends on it. */
    const table = readFileSync(
      new URL("../../core/src/mod/record-keys.ts", import.meta.url),
      "utf8",
    );
    /* The TABLE only - the prose above and below it now mentions the separator
     * by name, and a match against the whole file would read that as data. */
    const body = table.slice(table.indexOf("CORE_RECORD_KEYS"), table.indexOf("};"));
    const keys = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
    expect(keys.length).toBeGreaterThan(200);
    expect(keys.filter(isExtensionKey)).toEqual([]);
  });
});

describe("a declared field", () => {
  it("survives composition and reaches the record", () => {
    const bleed = { dice: "1d3", turns: 5 };
    const composed = composeContentPacks([
      corePack(),
      modWriting("gore", "gore:bleed", bleed, [
        { name: "bleed", files: ["object"], type: "object" },
      ]),
    ]);
    expect(composed.problems).toEqual([]);
    expect(dagger(composed.records["object"])["gore:bleed"]).toEqual(bleed);
  });

  it("is reported in declaredFields, so a host can show the vocabulary", () => {
    const composed = composeContentPacks([
      corePack(),
      modWriting("gore", "gore:bleed", 1, [
        { name: "bleed", files: ["object"], type: "number", label: "Bleed" },
      ]),
    ]);
    expect(composed.declaredFields).toEqual([
      {
        name: "bleed",
        files: ["object"],
        type: "number",
        label: "Bleed",
        owner: "gore",
        qualified: "gore:bleed",
      },
    ]);
  });

  it("leaves core's own unqualified fields untouched", () => {
    /* The control on the whole policy: if it reached unqualified keys it would
     * be stripping the game. */
    const composed = composeContentPacks([
      corePack(),
      modWriting("gore", "gore:bleed", 1, [{ name: "bleed", files: ["object"], type: "number" }]),
    ]);
    const d = dagger(composed.records["object"]);
    expect(d["attack"]).toEqual({ hd: "1d4" });
    expect(d["type"]).toBe("sword");
  });
});

describe("the namespace-trespass gate", () => {
  it("drops a declared field a pack writes without declaring its owner", () => {
    const owner: LoadedPack = {
      manifest: manifest("wounds", [{ name: "bleed", files: ["object"], type: "number" }]),
      files: {},
    };
    const trespasser: LoadedPack = {
      manifest: { ...manifest("sneaky"), dependencies: { core: "*" } },
      files: {
        object: {
          fieldPatches: {
            "core:sword--dagger": [{ op: "set", path: "wounds:bleed", value: 7 }],
          },
        },
      },
    } as unknown as LoadedPack;

    const composed = composeContentPacks([corePack(), owner, trespasser]);

    expect(dagger(composed.records["object"])["wounds:bleed"]).toBeUndefined();
    expect(composed.faults.map((fault) => fault.packId)).toContain("sneaky");
  });

  it("drops only the trespassing field and keeps the writer's other changes", () => {
    const owner: LoadedPack = {
      manifest: manifest("wounds", [{ name: "bleed", files: ["object"], type: "number" }]),
      files: {},
    };
    const trespasser: LoadedPack = {
      manifest: { ...manifest("sneaky"), dependencies: { core: "*" } },
      files: {
        object: {
          fieldPatches: {
            "core:sword--dagger": [
              { op: "set", path: "wounds:bleed", value: 7 },
              { op: "set", path: "attack.hd", value: "1d9" },
            ],
          },
        },
      },
    } as unknown as LoadedPack;

    const composed = composeContentPacks([corePack(), owner, trespasser]);
    const record = dagger(composed.records["object"]);
    expect(record["wounds:bleed"]).toBeUndefined();
    expect(record["attack"]).toEqual({ hd: "1d9" });
    expect(composed.faults.map((fault) => fault.packId)).toContain("sneaky");
  });

  it("refuses a trespassing deletion and restores the namespace owner's value", () => {
    const owner: LoadedPack = {
      manifest: {
        ...manifest("wounds", [{ name: "bleed", files: ["object"], type: "number" }]),
        dependencies: { core: "*" },
      },
      files: {
        object: {
          patches: { "core:sword--dagger": { "wounds:bleed": 5 } },
        },
      },
    } as unknown as LoadedPack;
    const trespasser: LoadedPack = {
      manifest: { ...manifest("sneaky"), dependencies: { core: "*" } },
      files: {
        object: {
          patches: { "core:sword--dagger": { "wounds:bleed": null } },
        },
      },
    } as unknown as LoadedPack;

    const composed = composeContentPacks([corePack(), owner, trespasser]);
    expect(dagger(composed.records["object"])["wounds:bleed"]).toBe(5);
    expect(composed.faults.map((fault) => fault.packId)).toContain("sneaky");
  });

  it("allows a namespace owner to write its own declared field", () => {
    const owner: LoadedPack = {
      manifest: {
        ...manifest("wounds", [{ name: "bleed", files: ["object"], type: "number" }]),
        dependencies: { core: "*" },
      },
      files: {
        object: {
          fieldPatches: {
            "core:sword--dagger": [{ op: "set", path: "wounds:bleed", value: 7 }],
          },
        },
      },
    } as unknown as LoadedPack;

    const composed = composeContentPacks([corePack(), owner]);
    expect(dagger(composed.records["object"])["wounds:bleed"]).toBe(7);
    expect(composed.faults).toEqual([]);
  });

  it("allows an integration that declares the namespace owner as a dependency", () => {
    const owner: LoadedPack = {
      manifest: manifest("wounds", [{ name: "bleed", files: ["object"], type: "number" }]),
      files: {},
    };
    const integration: LoadedPack = {
      manifest: { ...manifest("healing"), dependencies: { core: "*", wounds: "*" } },
      files: {
        object: {
          fieldPatches: {
            "core:sword--dagger": [{ op: "set", path: "wounds:bleed", value: 7 }],
          },
        },
      },
    } as unknown as LoadedPack;

    const composed = composeContentPacks([corePack(), owner, integration]);
    expect(dagger(composed.records["object"])["wounds:bleed"]).toBe(7);
    expect(composed.faults).toEqual([]);
  });

  it("allows an integration that declares the namespace owner as an optional dependency", () => {
    const owner: LoadedPack = {
      manifest: {
        ...manifest("wounds", [{ name: "bleed", files: ["object"], type: "number" }]),
        dependencies: { core: "*" },
      },
      files: {
        object: {
          records: [{ name: "Wounded Dagger", type: "sword", "wounds:bleed": 1 }],
        },
      },
    };
    const integration: LoadedPack = {
      manifest: {
        ...manifest("healing"),
        dependencies: { core: "*" },
        optionalDependencies: { wounds: "*" },
      },
      files: {
        object: {
          fieldPatches: {
            "wounds:sword--wounded-dagger": [
              { op: "set", path: "wounds:bleed", value: 7 },
            ],
          },
        },
      },
    } as unknown as LoadedPack;

    /* Input order puts the integration first, proving optionalDependencies
     * supply both the permitted namespace reach and the required ordering. */
    const composed = composeContentPacks([corePack(), integration, owner]);
    const wounded = (composed.records["object"] as Record<string, unknown>[]).find(
      (record) => record["name"] === "Wounded Dagger",
    );
    expect(wounded?.["wounds:bleed"]).toBe(7);
    expect(composed.faults).toEqual([]);
  });

  it("rolls back later allowed nested edits computed from a trespasser's value", () => {
    const owner: LoadedPack = {
      manifest: {
        ...manifest("wounds", [{ name: "bleed", files: ["object"], type: "object" }]),
        dependencies: { core: "*" },
      },
      files: {
        object: {
          fieldPatches: {
            "core:sword--dagger": [{ op: "set", path: "wounds:bleed", value: { a: 1 } }],
          },
        },
      },
    } as unknown as LoadedPack;
    const trespasser: LoadedPack = {
      manifest: { ...manifest("sneaky"), dependencies: { core: "*" } },
      files: {
        object: {
          fieldPatches: {
            "core:sword--dagger": [{ op: "set", path: "wounds:bleed.a", value: 9 }],
          },
        },
      },
    } as unknown as LoadedPack;
    const integration: LoadedPack = {
      manifest: { ...manifest("healing"), dependencies: { core: "*", wounds: "*" } },
      files: {
        object: {
          fieldPatches: {
            "core:sword--dagger": [{ op: "set", path: "wounds:bleed.b", value: 2 }],
          },
        },
      },
    } as unknown as LoadedPack;

    const composed = composeContentPacks([corePack(), owner, trespasser, integration]);

    expect(dagger(composed.records["object"])["wounds:bleed"]).toEqual({ a: 1 });
    expect(composed.faults).toContainEqual(
      expect.objectContaining({
        packId: "sneaky",
        why: expect.stringContaining("Later edits to the same field were rolled back too"),
      }),
    );
  });

  it("rolls back later allowed arithmetic computed from a trespasser's value", () => {
    const owner: LoadedPack = {
      manifest: {
        ...manifest("wounds", [{ name: "bleed", files: ["object"], type: "number" }]),
        dependencies: { core: "*" },
      },
      files: { object: { patches: { "core:sword--dagger": { "wounds:bleed": 10 } } } },
    } as unknown as LoadedPack;
    const trespasser: LoadedPack = {
      manifest: { ...manifest("sneaky"), dependencies: { core: "*" } },
      files: {
        object: {
          fieldPatches: {
            "core:sword--dagger": [{ op: "add", path: "wounds:bleed", value: 5 }],
          },
        },
      },
    } as unknown as LoadedPack;
    const integration: LoadedPack = {
      manifest: { ...manifest("healing"), dependencies: { core: "*", wounds: "*" } },
      files: {
        object: {
          fieldPatches: {
            "core:sword--dagger": [{ op: "add", path: "wounds:bleed", value: 1 }],
          },
        },
      },
    } as unknown as LoadedPack;

    const composed = composeContentPacks([corePack(), owner, trespasser, integration]);

    expect(dagger(composed.records["object"])["wounds:bleed"]).toBe(10);
  });

  it("rolls back later allowed coarse merges containing a trespasser's sibling", () => {
    const owner: LoadedPack = {
      manifest: {
        ...manifest("wounds", [{ name: "bleed", files: ["object"], type: "object" }]),
        dependencies: { core: "*" },
      },
      files: {
        object: {
          patches: { "core:sword--dagger": { "wounds:bleed": { owner: 1 } } },
        },
      },
    } as unknown as LoadedPack;
    const trespasser: LoadedPack = {
      manifest: { ...manifest("sneaky"), dependencies: { core: "*" } },
      files: {
        object: {
          patches: { "core:sword--dagger": { "wounds:bleed": { sneaky: 9 } } },
        },
      },
    } as unknown as LoadedPack;
    const integration: LoadedPack = {
      manifest: { ...manifest("healing"), dependencies: { core: "*", wounds: "*" } },
      files: {
        object: {
          patches: { "core:sword--dagger": { "wounds:bleed": { healing: 2 } } },
        },
      },
    } as unknown as LoadedPack;

    const composed = composeContentPacks([corePack(), owner, trespasser, integration]);

    expect(dagger(composed.records["object"])["wounds:bleed"]).toEqual({ owner: 1 });
  });

  it("drops a full-key trespass that loads before the namespace owner", () => {
    const trespasser: LoadedPack = {
      manifest: { ...manifest("sneaky"), dependencies: { core: "*" } },
      files: {
        object: {
          fieldPatches: {
            "core:sword--dagger": [{ op: "set", path: "wounds:bleed", value: 9 }],
          },
        },
      },
    } as unknown as LoadedPack;
    const owner: LoadedPack = {
      manifest: {
        ...manifest("wounds", [{ name: "bleed", files: ["object"], type: "number" }]),
        dependencies: { core: "*" },
      },
      files: {
        object: {
          fieldPatches: {
            "core:sword--dagger": [{ op: "set", path: "wounds:bleed", value: 1 }],
          },
        },
      },
    } as unknown as LoadedPack;

    const composed = composeContentPacks([corePack(), trespasser, owner]);

    expect(dagger(composed.records["object"])["wounds:bleed"]).toBeUndefined();
    expect(composed.faults.map((fault) => fault.packId)).toContain("sneaky");
  });

  it("treats an optional dependency that is not installed as an undeclared field", () => {
    const integration: LoadedPack = {
      manifest: {
        ...manifest("healing"),
        dependencies: { core: "*" },
        optionalDependencies: { wounds: "*" },
      },
      files: {
        object: {
          fieldPatches: {
            "core:sword--dagger": [{ op: "set", path: "wounds:bleed", value: 7 }],
          },
        },
      },
    } as unknown as LoadedPack;

    const composed = composeContentPacks([corePack(), integration]);

    expect(dagger(composed.records["object"])["wounds:bleed"]).toBeUndefined();
    expect(composed.faults).toContainEqual(
      expect.objectContaining({
        packId: "healing",
        why: expect.stringContaining("no loaded mod declares it"),
      }),
    );
    expect(composed.problems.join("\n")).not.toContain("without declaring wounds");
  });

  for (const [name, contribution, target] of [
    [
      "a newly added record",
      { records: [{ name: "Foreign Dagger", type: "sword", "wounds:bleed": 7 }] },
      "Foreign Dagger",
    ],
    [
      "a coarse patch",
      { patches: { "core:sword--dagger": { "wounds:bleed": 7 } } },
      "Dagger",
    ],
    [
      "a replacement",
      {
        replaces: {
          "core:sword--dagger": { name: "Dagger", type: "sword", "wounds:bleed": 7 },
        },
      },
      "Dagger",
    ],
  ] as const) {
    it(`catches trespass through ${name}`, () => {
      const owner: LoadedPack = {
        manifest: manifest("wounds", [{ name: "bleed", files: ["object"], type: "number" }]),
        files: {},
      };
      const trespasser: LoadedPack = {
        manifest: { ...manifest("sneaky"), dependencies: { core: "*" } },
        files: { object: contribution },
      } as unknown as LoadedPack;

      const composed = composeContentPacks([corePack(), owner, trespasser]);
      const record = (composed.records["object"] as Record<string, unknown>[]).find(
        (candidate) => candidate["name"] === target,
      );
      expect(record?.["wounds:bleed"]).toBeUndefined();
      expect(composed.faults.map((fault) => fault.packId)).toContain("sneaky");
    });
  }

  it("catches trespass through a passthrough file's whole-file contributor", () => {
    const core: LoadedPack = {
      manifest: manifest("core"),
      files: { constants: { records: [{ version: 1 }] } },
    } as unknown as LoadedPack;
    const owner: LoadedPack = {
      manifest: manifest("wounds", [{ name: "bleed", files: ["constants"], type: "number" }]),
      files: {},
    };
    const trespasser: LoadedPack = {
      manifest: { ...manifest("sneaky"), dependencies: { core: "*" } },
      files: { constants: { records: [{ version: 2, "wounds:bleed": 7 }] } },
    } as unknown as LoadedPack;

    const composed = composeContentPacks([core, owner, trespasser]);
    expect((composed.records["constants"]?.[0] as Record<string, unknown>)["wounds:bleed"]).toBeUndefined();
    expect(composed.faults.map((fault) => fault.packId)).toContain("sneaky");
  });

  it("catches trespass through a passthrough file's field patch", () => {
    const core: LoadedPack = {
      manifest: manifest("core"),
      files: {
        object: {
          records: [
            { name: "Dagger", type: "sword" },
            { name: "Main Gauche", type: "sword" },
            { name: "Deep Descent", type: "scroll" },
            { name: "Deep Descent", type: "scroll" },
          ],
        },
      },
    } as unknown as LoadedPack;
    const owner: LoadedPack = {
      manifest: manifest("wounds", [{ name: "bleed", files: ["object"], type: "number" }]),
      files: {},
    };
    const trespasser: LoadedPack = {
      manifest: { ...manifest("sneaky"), dependencies: { core: "*" } },
      files: {
        object: {
          fieldPatches: {
            "core:sword--dagger": [{ op: "set", path: "wounds:bleed", value: 7 }],
          },
        },
      },
    } as unknown as LoadedPack;

    const composed = composeContentPacks([core, owner, trespasser]);
    expect(dagger(composed.records["object"])["wounds:bleed"]).toBeUndefined();
    expect(composed.faults.map((fault) => fault.packId)).toContain("sneaky");
  });
});

describe("an undeclared field", () => {
  it("is stripped, and the problem names the mod, the file and the key", () => {
    const composed = composeContentPacks([corePack(), modWriting("gore", "gore:bleed", 1)]);
    expect(dagger(composed.records["object"])["gore:bleed"]).toBeUndefined();
    expect(composed.problems).toHaveLength(1);
    expect(composed.problems[0]).toContain('object: dropped "gore:bleed"');
    expect(composed.problems[0]).toContain("no loaded mod declares it");
    expect(composed.faults[0]?.packId).toBe("gore");
  });

  it("costs the field and not the mod: everything else that mod did survives", () => {
    const mod: LoadedPack = {
      manifest: { ...manifest("gore"), dependencies: { core: "*" } },
      files: {
        object: {
          fieldPatches: {
            "core:sword--dagger": [
              { op: "set", path: "gore:bleed", value: 1 },
              { op: "set", path: "attack.hd", value: "1d9" },
            ],
          },
        },
      },
    } as unknown as LoadedPack;
    const composed = composeContentPacks([corePack(), mod]);
    const d = dagger(composed.records["object"]);
    expect(d["gore:bleed"]).toBeUndefined();
    expect(d["attack"]).toEqual({ hd: "1d9" });
  });

  it("produces ONE problem however many records carry it", () => {
    /* Four hundred objects with the same undeclared field must not bury the
     * other problems under four hundred identical lines. */
    const mod: LoadedPack = {
      manifest: { ...manifest("gore"), dependencies: { core: "*" } },
      files: {
        object: {
          fieldPatches: {
            "core:sword--dagger": [{ op: "set", path: "gore:bleed", value: 1 }],
            "core:sword--main-gauche": [{ op: "set", path: "gore:bleed", value: 2 }],
          },
        },
      },
    } as unknown as LoadedPack;
    const composed = composeContentPacks([corePack(), mod]);
    expect(composed.problems).toHaveLength(1);
  });
});

describe("a field declared for the wrong file", () => {
  it("is stripped, and the problem names where it WAS declared", () => {
    const mod: LoadedPack = {
      manifest: {
        ...manifest("gore", [{ name: "bleed", files: ["object"] }]),
        dependencies: { core: "*" },
      },
      files: {
        monster: {
          fieldPatches: { "core:kobold": [{ op: "set", path: "gore:bleed", value: 1 }] },
        },
      },
    } as unknown as LoadedPack;
    const composed = composeContentPacks([corePack(), mod]);
    const kobold = (composed.records["monster"] as Record<string, unknown>[])[0];
    expect(kobold?.["gore:bleed"]).toBeUndefined();
    expect(composed.problems[0]).toContain("declares it for object and not for monster");
  });
});

describe("a field of the wrong shape", () => {
  it("is stripped, naming both the declared and the actual type", () => {
    const composed = composeContentPacks([
      corePack(),
      modWriting("gore", "gore:bleed", "lots", [
        { name: "bleed", files: ["object"], type: "number" },
      ]),
    ]);
    expect(dagger(composed.records["object"])["gore:bleed"]).toBeUndefined();
    expect(composed.problems[0]).toContain("declared as number, got string");
  });

  it('is kept when the declaration says "any"', () => {
    const composed = composeContentPacks([
      corePack(),
      modWriting("gore", "gore:bleed", "lots", [
        { name: "bleed", files: ["object"], type: "any" },
      ]),
    ]);
    expect(composed.problems).toEqual([]);
    expect(dagger(composed.records["object"])["gore:bleed"]).toBe("lots");
  });
});

describe("declaredFields", () => {
  it("keeps the first of a duplicate name, so a later edit cannot redefine it", () => {
    const m = manifest("gore", [
      { name: "bleed", files: ["object"], label: "first" },
      { name: "bleed", files: ["monster"], label: "second" },
    ]);
    expect(declaredFields([m]).get("gore:bleed")?.label).toBe("first");
  });

  it("namespaces by the DECLARING pack, so two mods can coin the same word", () => {
    const a = manifest("gore", [{ name: "bleed", files: ["object"] }]);
    const b = manifest("wounds", [{ name: "bleed", files: ["object"] }]);
    expect([...declaredFields([a, b]).keys()]).toEqual(["gore:bleed", "wounds:bleed"]);
  });
});

describe("checkUnqualified", () => {
  it("names a misspelling of one of core's own keys and suggests the real one", () => {
    const faults = checkUnqualified("object", [{ name: "Dagger", atack: 1 }], [
      "name",
      "type",
      "attack",
    ]);
    expect(faults).toHaveLength(1);
    expect(faults[0]?.message).toContain('did you mean "attack"');
    expect(faults[0]?.message).toContain('"<mod id>:atack"');
  });

  it("says nothing about a key core knows", () => {
    expect(checkUnqualified("object", [{ name: "Dagger" }], ["name"])).toEqual([]);
  });

  it("says nothing about a namespaced key, which is the other arm's business", () => {
    expect(checkUnqualified("object", [{ "gore:bleed": 1 }], ["name"])).toEqual([]);
  });

  it("does not strip - the fault is the product", () => {
    /* A key core reads but never ships in its own data is indistinguishable
     * from a typo out here, and dropping it would break a legitimate patch to
     * satisfy a diagnostic. */
    const record: Record<string, unknown> = { atack: 1 };
    checkUnqualified("object", [record], ["attack"]);
    expect(record["atack"]).toBe(1);
  });
});

describe("the manifest refuses a declaration that could not work", () => {
  const base = { id: "gore", name: "Gore", version: "1.0.0", shape: "content" };

  it("refuses a name containing a colon, which would forge a namespace", () => {
    expect(() =>
      validateManifest({ ...base, fields: [{ name: "other:bleed", files: ["object"] }] }),
    ).toThrow(ManifestError);
  });

  it("refuses a field with no files, because 'anywhere' cannot catch a misplacement", () => {
    expect(() => validateManifest({ ...base, fields: [{ name: "bleed" }] })).toThrow(
      /must list the record files/,
    );
  });

  it("refuses a type it does not know", () => {
    expect(() =>
      validateManifest({ ...base, fields: [{ name: "bleed", files: ["object"], type: "int" }] }),
    ).toThrow(/expected one of/);
  });

  it("refuses the same name twice", () => {
    expect(() =>
      validateManifest({
        ...base,
        fields: [
          { name: "bleed", files: ["object"] },
          { name: "bleed", files: ["monster"] },
        ],
      }),
    ).toThrow(/declared twice/);
  });

  it("accepts a well-formed declaration and returns it", () => {
    const m = validateManifest({
      ...base,
      fields: [{ name: "bleed", files: ["object", "ego_item"], type: "object", label: "Bleed" }],
    });
    expect(m.fields).toEqual([
      { name: "bleed", files: ["object", "ego_item"], type: "object", label: "Bleed" },
    ]);
  });
});
