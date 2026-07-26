/**
 * Upstream unit tests from reference/src/tests/z-util/guard.c
 * (suite z-util/guard).
 *
 * Mapping: add_guardi → addGuardi; sub_guardi → subGuardi;
 * add_guardi16 → addGuardi16; sub_guardi16 → subGuardi16.
 * INT_MAX/INT_MIN/INT16 bounds come from guard.ts (32-bit / 16-bit rails).
 */

import { describe, expect, it } from "vitest";
import {
  addGuardi,
  addGuardi16,
  INT_MAX,
  INT_MIN,
  myStristr,
  subGuardi,
  subGuardi16,
} from "./guard";

describe("z-util/guard upstream", () => {
  // C: test_add_guardi
  it("add_guardi", () => {
    expect(addGuardi(0, 0)).toBe(0);
    expect(addGuardi(0, 1)).toBe(1);
    expect(addGuardi(1, 0)).toBe(1);
    expect(addGuardi(0, -1)).toBe(-1);
    expect(addGuardi(-1, 0)).toBe(-1);
    expect(addGuardi(3, 5)).toBe(8);
    expect(addGuardi(5, 3)).toBe(8);
    expect(addGuardi(-4, -7)).toBe(-11);
    expect(addGuardi(-7, -4)).toBe(-11);
    expect(addGuardi(6, -2)).toBe(4);
    expect(addGuardi(-2, 6)).toBe(4);
    expect(addGuardi(-8, 7)).toBe(-1);
    expect(addGuardi(7, -8)).toBe(-1);
    expect(addGuardi(INT_MAX, 0)).toBe(INT_MAX);
    expect(addGuardi(0, INT_MAX)).toBe(INT_MAX);
    expect(addGuardi(INT_MAX, -5)).toBe(INT_MAX - 5);
    expect(addGuardi(-5, INT_MAX)).toBe(INT_MAX - 5);
    expect(addGuardi(INT_MIN, 0)).toBe(INT_MIN);
    expect(addGuardi(0, INT_MIN)).toBe(INT_MIN);
    expect(addGuardi(INT_MIN, 7)).toBe(INT_MIN + 7);
    expect(addGuardi(7, INT_MIN)).toBe(INT_MIN + 7);
    /* Cases that would overflow. */
    expect(addGuardi(INT_MAX, 1)).toBe(INT_MAX);
    expect(addGuardi(1, INT_MAX)).toBe(INT_MAX);
    expect(addGuardi(INT_MAX - 3, 5)).toBe(INT_MAX);
    expect(addGuardi(5, INT_MAX - 3)).toBe(INT_MAX);
    expect(addGuardi(INT_MAX, INT_MAX)).toBe(INT_MAX);
    expect(addGuardi(INT_MIN, -1)).toBe(INT_MIN);
    expect(addGuardi(-1, INT_MIN)).toBe(INT_MIN);
    expect(addGuardi(INT_MIN + 6, -8)).toBe(INT_MIN);
    expect(addGuardi(-8, INT_MIN + 6)).toBe(INT_MIN);
    expect(addGuardi(INT_MIN, INT_MIN)).toBe(INT_MIN);
  });

  // C: test_sub_guardi
  it("sub_guardi", () => {
    expect(subGuardi(0, 0)).toBe(0);
    expect(subGuardi(0, 1)).toBe(-1);
    expect(subGuardi(1, 0)).toBe(1);
    expect(subGuardi(0, -1)).toBe(1);
    expect(subGuardi(-1, 0)).toBe(-1);
    expect(subGuardi(3, 5)).toBe(-2);
    expect(subGuardi(5, 3)).toBe(2);
    expect(subGuardi(-4, -7)).toBe(3);
    expect(subGuardi(-7, -4)).toBe(-3);
    expect(subGuardi(6, -2)).toBe(8);
    expect(subGuardi(-2, 6)).toBe(-8);
    expect(subGuardi(-8, 7)).toBe(-15);
    expect(subGuardi(7, -8)).toBe(15);
    expect(subGuardi(9, 9)).toBe(0);
    expect(subGuardi(-10, -10)).toBe(0);
    expect(subGuardi(INT_MAX, 0)).toBe(INT_MAX);
    expect(subGuardi(0, INT_MAX - 1)).toBe(-(INT_MAX - 1));
    expect(subGuardi(INT_MAX, 5)).toBe(INT_MAX - 5);
    expect(subGuardi(5, INT_MAX)).toBe(-(INT_MAX - 5));
    expect(subGuardi(INT_MIN, 0)).toBe(INT_MIN);
    expect(subGuardi(0, INT_MIN + 2)).toBe(-(INT_MIN + 2));
    expect(subGuardi(INT_MIN, -7)).toBe(INT_MIN + 7);
    expect(subGuardi(-7, INT_MIN)).toBe(-(INT_MIN + 7));
    expect(subGuardi(INT_MAX, INT_MAX)).toBe(0);
    expect(subGuardi(INT_MIN, INT_MIN)).toBe(0);
    /* Cases that would overflow. */
    expect(subGuardi(INT_MAX, -1)).toBe(INT_MAX);
    expect(subGuardi(INT_MAX - 3, -5)).toBe(INT_MAX);
    expect(subGuardi(INT_MAX, INT_MIN)).toBe(INT_MAX);
    expect(subGuardi(INT_MIN, 3)).toBe(INT_MIN);
    expect(subGuardi(INT_MIN + 6, 8)).toBe(INT_MIN);
    expect(subGuardi(INT_MIN, INT_MAX)).toBe(INT_MIN);
  });

  // C: test_add_guardi16
  it("add_guardi16", () => {
    expect(addGuardi16(0, 0)).toBe(0);
    expect(addGuardi16(0, 1)).toBe(1);
    expect(addGuardi16(1, 0)).toBe(1);
    expect(addGuardi16(0, -1)).toBe(-1);
    expect(addGuardi16(-1, 0)).toBe(-1);
    expect(addGuardi16(3, 5)).toBe(8);
    expect(addGuardi16(5, 3)).toBe(8);
    expect(addGuardi16(-4, -7)).toBe(-11);
    expect(addGuardi16(-7, -4)).toBe(-11);
    expect(addGuardi16(6, -2)).toBe(4);
    expect(addGuardi16(-2, 6)).toBe(4);
    expect(addGuardi16(-8, 7)).toBe(-1);
    expect(addGuardi16(7, -8)).toBe(-1);
    expect(addGuardi16(32767, 0)).toBe(32767);
    expect(addGuardi16(0, 32767)).toBe(32767);
    expect(addGuardi16(32767, -5)).toBe(32762);
    expect(addGuardi16(-5, 32767)).toBe(32762);
    expect(addGuardi16(-32768, 0)).toBe(-32768);
    expect(addGuardi16(0, -32768)).toBe(-32768);
    expect(addGuardi16(-32768, 7)).toBe(-32761);
    expect(addGuardi16(7, -32768)).toBe(-32761);
    /* Cases that would overflow. */
    expect(addGuardi16(32767, 1)).toBe(32767);
    expect(addGuardi16(1, 32767)).toBe(32767);
    expect(addGuardi16(32764, 5)).toBe(32767);
    expect(addGuardi16(5, 32764)).toBe(32767);
    expect(addGuardi16(32767, 32767)).toBe(32767);
    expect(addGuardi16(-32768, -1)).toBe(-32768);
    expect(addGuardi16(-1, -32768)).toBe(-32768);
    expect(addGuardi16(-32762, -8)).toBe(-32768);
    expect(addGuardi16(-8, -32762)).toBe(-32768);
    expect(addGuardi16(-32768, -32768)).toBe(-32768);
  });

  // C: test_sub_guardi16
  it("sub_guardi16", () => {
    expect(subGuardi16(0, 0)).toBe(0);
    expect(subGuardi16(0, 1)).toBe(-1);
    expect(subGuardi16(1, 0)).toBe(1);
    expect(subGuardi16(0, -1)).toBe(1);
    expect(subGuardi16(-1, 0)).toBe(-1);
    expect(subGuardi16(3, 5)).toBe(-2);
    expect(subGuardi16(5, 3)).toBe(2);
    expect(subGuardi16(-4, -7)).toBe(3);
    expect(subGuardi16(-7, -4)).toBe(-3);
    expect(subGuardi16(6, -2)).toBe(8);
    expect(subGuardi16(-2, 6)).toBe(-8);
    expect(subGuardi16(-8, 7)).toBe(-15);
    expect(subGuardi16(7, -8)).toBe(15);
    expect(subGuardi16(9, 9)).toBe(0);
    expect(subGuardi16(-10, -10)).toBe(0);
    expect(subGuardi16(32767, 0)).toBe(32767);
    expect(subGuardi16(0, 32766)).toBe(-32766);
    expect(subGuardi16(32767, 5)).toBe(32762);
    expect(subGuardi16(5, 32767)).toBe(-32762);
    expect(subGuardi16(-32768, 0)).toBe(-32768);
    expect(subGuardi16(0, -32766)).toBe(32766);
    expect(subGuardi16(-32768, -7)).toBe(-32761);
    expect(subGuardi16(-7, -32768)).toBe(32761);
    expect(subGuardi16(32767, 32767)).toBe(0);
    expect(subGuardi16(-32768, -32768)).toBe(0);
    /* Cases that would overflow. */
    expect(subGuardi16(32767, -1)).toBe(32767);
    expect(subGuardi16(32764, -5)).toBe(32767);
    expect(subGuardi16(32767, -32768)).toBe(32767);
    expect(subGuardi16(-32768, 3)).toBe(-32768);
    expect(subGuardi16(-32762, 8)).toBe(-32768);
    expect(subGuardi16(-32768, 32767)).toBe(-32768);
  });
});

/*
 * my_stristr (z-util.c:441). Given a real counterpart 2026-07-26 after W1-CITED
 * found lookupTrap (world/trap.ts) using a case-SENSITIVE `includes` where
 * trap.c:57 uses my_stristr, while mon/bind.ts had inlined the correct test.
 * Two implementations of one C function, one of them wrong.
 */
describe("myStristr (z-util.c:441)", () => {
  it("matches regardless of case on either side", () => {
    expect(myStristr("a Rune of Protection", "rune")).toBe(true);
    expect(myStristr("a rune of protection", "RUNE")).toBe(true);
    expect(myStristr("A RUNE OF PROTECTION", "Rune")).toBe(true);
  });

  it("is a substring test, anchored nowhere", () => {
    expect(myStristr("pit", "pit")).toBe(true);
    expect(myStristr("a spiked pit", "pit")).toBe(true);
    expect(myStristr("pitfall", "pit")).toBe(true);
    expect(myStristr("pit", "spiked pit")).toBe(false);
  });

  it("treats the empty pattern as present, as strstr does", () => {
    expect(myStristr("anything", "")).toBe(true);
  });
});

/*
 * ===================================================================
 * ADJUDICATED N/A -- upstream z-library cases with no port counterpart
 * ===================================================================
 *
 * Recorded here (the port's z-util home) so the coverage ledger stops
 * re-queueing them, WITH the per-case reason. Adjudicated individually in the
 * UT-zlib2 pass; an earlier pass had dismissed whole files as a batch, and that
 * turned out to be wrong for z-util (see rational.ts / rational.upstream.test.ts,
 * which port ten cases that pass had written off).
 *
 * --- reference/src/tests/z-file/path-normalize.c (7) -------------------------
 * path_normalize is POSIX/Win32 filesystem-path semantics against a real
 * filesystem, and it is compiled per-platform (#ifdef WINDOWS / UNIX picks
 * entirely different expectation tables). The port runs in a browser and owns no
 * filesystem: no package's src implements path joining or
 * normalisation. The only path handling anywhere in the repo is node's own
 * `path.join` inside build and test tooling (content/src/compile.ts,
 * data-exactness.test.ts), which is not a port of path_normalize and so cannot
 * inherit the bugs these cases pin.
 *  - test_unchanged: an already-canonical path is returned verbatim, with the
 *    root-prefix size (3 for "C:\", 1 for "/", 22 for a UNC share) reported and
 *    the caller's buffer untouched outside the written span.
 *  - test_relative_parts: "." and ".." component collapsing, including the
 *    required-size differing between the truncated and untruncated calls.
 *  - test_redundant_separators: runs of separators collapse to one.
 *  - test_working_directory: a relative path resolves against getcwd() /
 *    GetCurrentDirectory().
 *  - test_home_directory: UNIX-only "~" and "~user" expansion via getpwuid().
 *  - test_invalid_user: "~<32 random letters>" returns 2 and zeroes both size
 *    out-parameters.
 *  - test_invalid_unc_path: WINDOWS-only malformed "\\\\" share paths return 2.
 * All seven also assert the C caller-supplies-the-buffer protocol (return 1 when
 * the buffer is too small, the required size in an out-parameter, guard bytes
 * either side left as written), which has no analogue for a function returning a
 * JS string.
 *
 * --- reference/src/tests/z-file/filename-index.c (2) -------------------------
 * path_filename_index returns the offset just past the last path separator, and
 * PATH_SEPC itself is '\\' or '/' per platform.
 *  - test_no_separator: a bare name has index 0.
 *  - test_separator: platform tables ("/var/tmp" -> 5, "C:\\Windows\\temp" ->
 *    11), i.e. the same per-platform separator semantics as above.
 * Same reason: no port code splits a filesystem path.
 *
 * --- reference/src/tests/z-virt/string.c (7) ---------------------------------
 * string_make / string_append / string_free are the C's heap-string helpers:
 * malloc-and-strcpy, realloc-and-strcat, and free. A JS string needs none of
 * them, and every one of these cases is about the NULL-pointer protocol that
 * only exists because the values are pointers.
 *  - test_string_make: allocates a copy that compares equal.
 *  - test_string_make_null: string_make(NULL) yields NULL rather than "".
 *  - test_string_free_null: string_free(NULL) is a no-op, not a crash.
 *  - test_string_append: concatenation, with the input pointer invalidated.
 *  - test_string_append_null0: append onto NULL behaves as append onto "".
 *  - test_string_append_null1: appending NULL leaves the original.
 *  - test_string_append_null2: append(NULL, NULL) is NULL, NOT "" -- the one
 *    assertion with any semantic content, and it distinguishes two pointer
 *    states that a `string` in TS does not have.
 *
 * --- reference/src/tests/z-virt/mem.c (1) ------------------------------------
 *  - test_realloc: mem_realloc(NULL, 32) then mem_realloc(p, 64) returns usable
 *    memory that can be memset and freed. C manual memory management outright.
 *
 * --- reference/src/tests/z-quark/quark.c (1) ---------------------------------
 *  - test_dedup: quark_add of the same string twice returns the same quark_t AND
 *    the same char* (`quark_str(q1) == quark_str(q2)` is POINTER equality),
 *    while a different string differs. This is the string-interning table's
 *    whole purpose, and it exists so the C can compare and save inscriptions as
 *    small integers. The port stores inscriptions as plain JS strings (see
 *    obj/desc.ts obj_desc_inscrip and obj/ignore.ts checkForInscrip), where
 *    value equality is the only equality there is, so there is no interning
 *    table and no identity to assert.
 *
 * --- reference/src/tests/trivial/trivial.c (1) ------------------------------
 *  - test_require: `require(1)`. A self-test of the C harness's own require
 *    macro, asserting nothing about Angband. The port's harness is vitest.
 *
 * --- reference/src/tests/z-util/util.c (5) -----------------------------------
 * Despite the file name this is not general string utility coverage: it is
 * UTF-8 BYTE-BUFFER arithmetic plus two helpers reachable only from one platform
 * front end. The port's strings are JS strings (UTF-16 with code-point APIs), so
 * there is no byte cursor to walk and no encoding step to perform.
 *  - test_utf8_fskip: advance n characters forward through a UTF-8 byte buffer,
 *    returning a byte pointer, NULL if that would pass the terminator or a
 *    caller-supplied limit, and (the subtle part) advancing zero from MID-
 *    character moves to the start of the NEXT character. Upstream calls it from
 *    ui-birth.c/ui-input.c text entry (a byte cursor over a char buffer) and,
 *    importantly, from parser.c L279. That parser use IS ported and IS correct:
 *    a `char:` field consumes exactly one CODE POINT and anything other than
 *    ':' or end-of-line after it is PARSE_ERROR_FIELD_TOO_LONG -- see
 *    packages/content/src/parser.ts takeChar, which does exactly that with
 *    codePointAt/fromCodePoint. So the behaviour that depends on this function
 *    is covered; the byte-pointer function itself has no counterpart.
 *  - test_utf8_rskip: the same walk backwards, bounded by a lower limit. Only
 *    callers are the ui-input.c / ui-birth.c text-entry cursors.
 *  - test_utf32_to_utf8: encode UTF-32 code points into a bounded UTF-8 byte
 *    buffer, reporting how many were converted, refusing surrogates
 *    (0xD800-0xDFFF) and anything above 0x10FFFF, and stopping cleanly when the
 *    output buffer is 0 or 1 bytes. Upstream needs it because its Term events
 *    carry a uint32 keycode (ui-event.c L335/L355, ui-knowledge.c L4378); the
 *    port's front end receives a KeyboardEvent whose `key` is already a string,
 *    so no encode step exists.
 *  - test_hex_str_to_int: "1Ba0" -> 0x1ba0, "5z2" -> -1. Its ONLY caller in the
 *    whole reference tree is z-util.c L764, inside strunescape.
 *  - test_strunescape: in-place unescaping of "\\\\", "\\n" and "\\xHH", where a
 *    truncated escape ("\\x", "\\xa") is left LITERAL. Its only callers are
 *    src/nds/nds-buttons.c L165 and src/nds/nds-screenkeys.c L77 -- the
 *    Nintendo DS front end's button/screen-key config parser. The port has no
 *    NDS front end and does no runtime .prf text unescaping (its sound and
 *    colour preferences ship pre-parsed in src/generated and
 *    sound/sound-prefs-data.ts), so both this and hex_str_to_int are
 *    unreachable here.
 */
