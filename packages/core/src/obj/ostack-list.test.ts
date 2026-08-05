/**
 * A ratchet on OSTACK_LIST, not a behaviour test. PORT_TODO 2.11.
 *
 * `object_similar` / `object_mergeable` carry three OSTACK_LIST checks in the C
 * (obj-pile.c:409, :410, :485) and this port has none of them. That is a REAL
 * omission and a HARMLESS one, for a reason that is a measurement rather than a
 * judgement: **nothing in Angband 4.2.6 ever passes OSTACK_LIST.** It is declared
 * at obj-pile.h:33, tested three times, and supplied never - the object-list UI
 * that presumably once passed it does not any more. Every OSTACK_* argument in
 * the C tree is PACK, QUIVER, MONSTER, STORE or FLOOR:
 *
 *   cmd-pickup.c:133          OSTACK_PACK
 *   mon-util.c:1375           OSTACK_MONSTER
 *   obj-gear.c:209, :211      OSTACK_PACK
 *   obj-gear.c:668, :771      OSTACK_PACK
 *   obj-gear.c:834            OSTACK_QUIVER : OSTACK_PACK
 *   obj-gear.c:1259, :1278    OSTACK_QUIVER : OSTACK_PACK
 *   store.c:847              OSTACK_PACK
 *
 * and the only `mode &` tests that are not in obj-pile.c read STORE and QUIVER
 * (obj-gear.c:1196, :1216). No arithmetic anywhere can set 0x04.
 *
 * WHY A TEST AND NOT JUST A COMMENT. "Unreachable" is a property of the CALLERS,
 * and callers are the thing most likely to change - a mod, a future object-list
 * screen, or a port of the C's own list UI would make all three checks owed at
 * once, silently, because the port simply ignores the bit. This test fails the
 * moment any port code passes OSTACK_LIST, which is the point at which someone
 * has to implement them. That is the same shape as an allowlist falling behind
 * its type: the guard belongs on the thing that changes.
 *
 * It deliberately does NOT test stacking behaviour. There is nothing to assert -
 * the port ignores the bit, so any such test would be a tautology dressed as
 * coverage.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(fileURLToPath(new URL("../..", import.meta.url)), "src");

/** Every .ts file under packages/core/src, tests included. */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("OSTACK_LIST stays unreachable, or its checks come due", () => {
  it("nothing passes OSTACK_LIST to a stacking predicate", () => {
    /* The declaration and the two explanatory notes are in object.ts; anything
     * ELSE mentioning the identifier is a caller, or on its way to being one. */
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      if (file.endsWith(join("obj", "object.ts"))) continue;
      if (file.endsWith(join("obj", "ostack-list.test.ts"))) continue;
      const src = readFileSync(file, "utf8");
      if (src.includes("OSTACK_LIST")) {
        offenders.push(file.slice(SRC.length + 1).replaceAll("\\", "/"));
      }
    }

    expect(
      offenders,
      "OSTACK_LIST reached a caller. The three checks at obj-pile.c:409, :410 " +
        "and :485 are now owed - implement them in objectStackable / " +
        "objectMergeable (they need the obj->known shadow) rather than deleting " +
        "this guard.",
    ).toEqual([]);
  });

  it("the identifier really is where this test expects it (guard on the guard)", () => {
    /* A scan that finds nothing because it looked in the wrong place is the
     * failure mode here: this asserts the sweep sees a real file, and that the
     * one file it excludes genuinely holds the declaration.
     *
     * THE DECLARATION MATCH IS EXACT ON PURPOSE. It was
     * `toContain("export const OSTACK_LIST")`, and renaming the constant to
     * OSTACK_LIST_RENAMED left this green - the new name CONTAINS the old one. A
     * substring assertion about an identifier cannot tell a rename from a match,
     * which is the whole reason the sweep above looks for the bare identifier and
     * this one pins the full declaration. */
    const files = sources(SRC);
    expect(files.length).toBeGreaterThan(100);
    const decl = readFileSync(join(SRC, "obj", "object.ts"), "utf8");
    expect(decl).toContain("export const OSTACK_LIST = 0x04;");
    expect(decl).toContain("obj-pile.h:33");
  });
});
