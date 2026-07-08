/**
 * Low-level bit vector manipulation, ported from reference/src/z-bitflag.c/h
 * (Angband 4.2.6).
 *
 * A flag set is a Uint8Array of bytes ("bitflag" is uint8_t upstream). Flags
 * are 1-indexed: FLAG_START is 1 and flag 0 is the upstream FLAG_END
 * sentinel, which never tests as set. The byte size of a set able to hold n
 * flags is flagSize(n), mirroring the upstream FLAG_SIZE macro.
 *
 * Sentinel mapping: upstream flag_next() returns FLAG_END (0) when no more
 * flags are set. This port returns NO_FLAG (-1) instead so that the "no
 * flag" pseudo-value 0 is never conflated with an iteration result; loops
 * must compare against NO_FLAG. Upstream's variadic functions (flags_test
 * and friends) terminate their argument list with FLAG_END; this port uses
 * rest parameters instead, so no terminator is passed.
 *
 * Intentional divergences, each noted on the function it affects:
 * - The C functions take an explicit byte size next to the array; here the
 *   Uint8Array length is the size. Binary operations require equal lengths.
 * - flag_on/flag_off with flag 0 is undefined behavior upstream (1 << -1);
 *   this port throws a RangeError instead.
 * - flagCompUnion/flagCompInter/flagCompDiff: upstream 4.2.6 declares no
 *   such functions; the only trace is the never-expanded macro
 *   rf_comp_union in src/monster.h line 114. They are defined here as the
 *   natural complement reading: apply union/inter/diff with the bitwise
 *   complement of the second operand.
 */

/** Bits per bitflag array element (sizeof(uint8_t) * 8). */
export const FLAG_WIDTH = 8;

/** Enum flag value of the first valid flag in a set. */
export const FLAG_START = 1;

/**
 * The upstream sentinel meaning "no flag" (FLAG_START - 1). flag 0 is never
 * set. Note that flagNext returns NO_FLAG, not FLAG_END; see module docs.
 */
export const FLAG_END = FLAG_START - 1;

/** Iteration sentinel returned by flagNext when no further flag is set. */
export const NO_FLAG = -1;

/** The array size (in bytes) necessary to hold n flags (FLAG_SIZE). */
export function flagSize(n: number): number {
  return Math.trunc((n + FLAG_WIDTH - 1) / FLAG_WIDTH);
}

/** The highest flag value plus one in an array of size bytes (FLAG_MAX). */
export function flagMax(size: number): number {
  return size * FLAG_WIDTH + FLAG_START;
}

/** Convert a flag value to its array index (FLAG_OFFSET). */
function flagOffset(flag: number): number {
  return Math.trunc((flag - FLAG_START) / FLAG_WIDTH);
}

/** Convert a flag value to its binary bit value (FLAG_BINARY). */
function flagBinary(flag: number): number {
  return 1 << ((flag - FLAG_START) % FLAG_WIDTH);
}

function assertValidFlag(flags: Uint8Array, flag: number, fn: string): void {
  if (flag < FLAG_START) {
    throw new RangeError(`${fn}: flag ${flag} is below FLAG_START`);
  }
  if (flagOffset(flag) >= flags.length) {
    throw new RangeError(
      `${fn}: flag ${flag} does not fit in ${flags.length} byte(s)`,
    );
  }
}

function assertSameSize(a: Uint8Array, b: Uint8Array, fn: string): void {
  if (a.length !== b.length) {
    throw new RangeError(
      `${fn}: flag set sizes differ (${a.length} vs ${b.length})`,
    );
  }
}

/**
 * flag_has: tests if a flag is on in a bitflag set. Flag 0 (FLAG_END) is
 * always false, as upstream.
 */
export function flagHas(flags: Uint8Array, flag: number): boolean {
  if (flag === FLAG_END) return false;
  assertValidFlag(flags, flag, "flagHas");
  return ((flags[flagOffset(flag)] as number) & flagBinary(flag)) !== 0;
}

/**
 * flag_next: returns the next on flag, starting from (and including) flag.
 * Returns NO_FLAG when the end of the set is reached (upstream returns
 * FLAG_END). Iteration starts at the beginning of the set when flag is
 * FLAG_END or lower; upstream relies on x86 shift masking for flag 0, which
 * skips it, so starting at FLAG_START is behavior-identical.
 */
export function flagNext(flags: Uint8Array, flag: number): number {
  const maxFlags = flagMax(flags.length);
  for (let f = Math.max(flag, FLAG_START); f < maxFlags; f++) {
    if (((flags[flagOffset(f)] as number) & flagBinary(f)) !== 0) return f;
  }
  return NO_FLAG;
}

/** flag_count: counts the flags which are on in a bitflag set. */
export function flagCount(flags: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < flags.length; i++) {
    for (let j = 1; j <= FLAG_WIDTH; j++) {
      if (((flags[i] as number) & flagBinary(j)) !== 0) count++;
    }
  }
  return count;
}

/** flag_is_empty: true when no flags are set. */
export function flagIsEmpty(flags: Uint8Array): boolean {
  for (let i = 0; i < flags.length; i++) {
    if ((flags[i] as number) > 0) return false;
  }
  return true;
}

/**
 * flag_is_full: true when all flags are set. As upstream, this checks whole
 * bytes (0xff), so trailing padding bits beyond the last real flag count.
 */
export function flagIsFull(flags: Uint8Array): boolean {
  for (let i = 0; i < flags.length; i++) {
    if ((flags[i] as number) !== 0xff) return false;
  }
  return true;
}

/** flag_is_inter: true when any flag is set in both sets. */
export function flagIsInter(flags1: Uint8Array, flags2: Uint8Array): boolean {
  assertSameSize(flags1, flags2, "flagIsInter");
  for (let i = 0; i < flags1.length; i++) {
    if (((flags1[i] as number) & (flags2[i] as number)) !== 0) return true;
  }
  return false;
}

/**
 * flag_is_subset: true when every set flag in flags2 is also set in flags1
 * (i.e. flags2 is a subset of flags1). Argument order follows upstream.
 */
export function flagIsSubset(flags1: Uint8Array, flags2: Uint8Array): boolean {
  assertSameSize(flags1, flags2, "flagIsSubset");
  for (let i = 0; i < flags1.length; i++) {
    if ((~(flags1[i] as number) & (flags2[i] as number)) !== 0) return false;
  }
  return true;
}

/** flag_is_equal: true when both sets have identical flags. */
export function flagIsEqual(flags1: Uint8Array, flags2: Uint8Array): boolean {
  assertSameSize(flags1, flags2, "flagIsEqual");
  for (let i = 0; i < flags1.length; i++) {
    if ((flags1[i] as number) !== (flags2[i] as number)) return false;
  }
  return true;
}

/**
 * flag_on: sets one flag. Returns true when a change was made, false when
 * the flag was already set.
 */
export function flagOn(flags: Uint8Array, flag: number): boolean {
  assertValidFlag(flags, flag, "flagOn");
  const offset = flagOffset(flag);
  const binary = flagBinary(flag);
  if (((flags[offset] as number) & binary) !== 0) return false;
  flags[offset] = (flags[offset] as number) | binary;
  return true;
}

/**
 * flag_off: clears one flag. Returns true when a change was made, false
 * when the flag was already clear.
 */
export function flagOff(flags: Uint8Array, flag: number): boolean {
  assertValidFlag(flags, flag, "flagOff");
  const offset = flagOffset(flag);
  const binary = flagBinary(flag);
  if (((flags[offset] as number) & binary) === 0) return false;
  flags[offset] = (flags[offset] as number) & ~binary & 0xff;
  return true;
}

/** flag_wipe: clears all flags. */
export function flagWipe(flags: Uint8Array): void {
  flags.fill(0);
}

/** flag_setall: sets all flags (whole bytes, as upstream memset 255). */
export function flagSetall(flags: Uint8Array): void {
  flags.fill(0xff);
}

/** flag_negate: toggles all flags. */
export function flagNegate(flags: Uint8Array): void {
  for (let i = 0; i < flags.length; i++) {
    flags[i] = ~(flags[i] as number) & 0xff;
  }
}

/** flag_copy: copies flags2 into flags1. */
export function flagCopy(flags1: Uint8Array, flags2: Uint8Array): void {
  assertSameSize(flags1, flags2, "flagCopy");
  flags1.set(flags2);
}

/**
 * flag_union: flags1 |= flags2. Returns true when changes were made (some
 * flag of flags2 was not already set in flags1).
 */
export function flagUnion(flags1: Uint8Array, flags2: Uint8Array): boolean {
  assertSameSize(flags1, flags2, "flagUnion");
  let delta = false;
  for (let i = 0; i < flags1.length; i++) {
    const a = flags1[i] as number;
    const b = flags2[i] as number;
    if ((~a & b) !== 0) delta = true;
    flags1[i] = (a | b) & 0xff;
  }
  return delta;
}

/**
 * flag_inter: flags1 &= flags2. Upstream quirk kept faithfully: the return
 * value reports whether flags1 and flags2 DIFFERED (per byte), not whether
 * flags1 was actually modified. E.g. flags1 = 0x01, flags2 = 0x03 returns
 * true even though flags1 is unchanged.
 */
export function flagInter(flags1: Uint8Array, flags2: Uint8Array): boolean {
  assertSameSize(flags1, flags2, "flagInter");
  let delta = false;
  for (let i = 0; i < flags1.length; i++) {
    const a = flags1[i] as number;
    const b = flags2[i] as number;
    if (a !== b) delta = true;
    flags1[i] = a & b;
  }
  return delta;
}

/**
 * flag_diff: flags1 &= ~flags2 (clears every flag set in flags2). Returns
 * true when changes were made (the sets intersected).
 */
export function flagDiff(flags1: Uint8Array, flags2: Uint8Array): boolean {
  assertSameSize(flags1, flags2, "flagDiff");
  let delta = false;
  for (let i = 0; i < flags1.length; i++) {
    const a = flags1[i] as number;
    const b = flags2[i] as number;
    if ((a & b) !== 0) delta = true;
    flags1[i] = a & ~b & 0xff;
  }
  return delta;
}

/**
 * flag_comp_union: flags1 |= ~flags2 (union with the complement of flags2).
 * Not defined upstream (see module docs); returns true when flags1 changed.
 */
export function flagCompUnion(
  flags1: Uint8Array,
  flags2: Uint8Array,
): boolean {
  assertSameSize(flags1, flags2, "flagCompUnion");
  let delta = false;
  for (let i = 0; i < flags1.length; i++) {
    const a = flags1[i] as number;
    const nb = ~(flags2[i] as number) & 0xff;
    if ((~a & nb) !== 0) delta = true;
    flags1[i] = (a | nb) & 0xff;
  }
  return delta;
}

/**
 * flag_comp_inter: flags1 &= ~flags2 (intersection with the complement of
 * flags2, i.e. the same mutation as flagDiff). Not defined upstream; returns
 * true when flags1 changed.
 */
export function flagCompInter(
  flags1: Uint8Array,
  flags2: Uint8Array,
): boolean {
  assertSameSize(flags1, flags2, "flagCompInter");
  let delta = false;
  for (let i = 0; i < flags1.length; i++) {
    const a = flags1[i] as number;
    const nb = ~(flags2[i] as number) & 0xff;
    if ((a & ~nb) !== 0) delta = true;
    flags1[i] = a & nb;
  }
  return delta;
}

/**
 * flag_comp_diff: flags1 &= ~(~flags2), i.e. flags1 &= flags2 (difference
 * with the complement of flags2, the same mutation as flagInter). Not
 * defined upstream; returns true when flags1 changed (NOT the flagInter
 * inequality quirk).
 */
export function flagCompDiff(flags1: Uint8Array, flags2: Uint8Array): boolean {
  assertSameSize(flags1, flags2, "flagCompDiff");
  let delta = false;
  for (let i = 0; i < flags1.length; i++) {
    const a = flags1[i] as number;
    const b = flags2[i] as number;
    if ((a & ~b) !== 0) delta = true;
    flags1[i] = a & b;
  }
  return delta;
}

/**
 * flags_test: true if any of the given flags are set. Upstream is variadic
 * with a FLAG_END terminator; this port takes rest parameters.
 */
export function flagsTest(flags: Uint8Array, ...check: number[]): boolean {
  for (const f of check) {
    if (flagHas(flags, f)) return true;
  }
  return false;
}

/** flags_test_all: true if all of the given flags are set. */
export function flagsTestAll(flags: Uint8Array, ...check: number[]): boolean {
  for (const f of check) {
    if (!flagHas(flags, f)) return false;
  }
  return true;
}

/**
 * flags_clear: clears the given flags. Returns true when changes were made.
 */
export function flagsClear(flags: Uint8Array, ...clear: number[]): boolean {
  let delta = false;
  for (const f of clear) {
    if (flagOff(flags, f)) delta = true;
  }
  return delta;
}

/** flags_set: sets the given flags. Returns true when changes were made. */
export function flagsSet(flags: Uint8Array, ...set: number[]): boolean {
  let delta = false;
  for (const f of set) {
    if (flagOn(flags, f)) delta = true;
  }
  return delta;
}

/** flags_init: wipes the set, then sets the given flags. */
export function flagsInit(flags: Uint8Array, ...set: number[]): void {
  flagWipe(flags);
  for (const f of set) flagOn(flags, f);
}

/**
 * flags_mask: clears the flags NOT given (intersects with a mask built from
 * the given flags). Return value keeps the upstream flag_inter inequality
 * quirk, because upstream implements this via flag_inter.
 */
export function flagsMask(flags: Uint8Array, ...mask: number[]): boolean {
  const m = new Uint8Array(flags.length);
  for (const f of mask) flagOn(m, f);
  return flagInter(flags, m);
}

/**
 * An object wrapper around a Uint8Array flag set with the upstream API as
 * methods. Sizes are byte sizes, exactly like the upstream `size`
 * parameters; use FlagSet.forFlags(maxFlag) to size a set by its highest
 * flag value (the equivalent of bitflag name[FLAG_SIZE(MAX)]).
 */
export class FlagSet {
  readonly bits: Uint8Array;

  constructor(size: number | Uint8Array) {
    if (typeof size === "number") {
      if (size < 1 || !Number.isInteger(size)) {
        throw new RangeError(`FlagSet: invalid byte size ${size}`);
      }
      this.bits = new Uint8Array(size);
    } else {
      this.bits = size;
    }
  }

  /** Size a set to hold flags FLAG_START..maxFlag - 1 (FLAG_SIZE(max)). */
  static forFlags(maxFlag: number): FlagSet {
    return new FlagSet(flagSize(maxFlag));
  }

  /** The byte size of the set (the upstream `size` parameter). */
  get size(): number {
    return this.bits.length;
  }

  has(flag: number): boolean {
    return flagHas(this.bits, flag);
  }

  /** Next on flag at or after `flag`; NO_FLAG when exhausted. */
  next(flag: number): number {
    return flagNext(this.bits, flag);
  }

  count(): number {
    return flagCount(this.bits);
  }

  isEmpty(): boolean {
    return flagIsEmpty(this.bits);
  }

  isFull(): boolean {
    return flagIsFull(this.bits);
  }

  /** True when any flag is set in both this set and `other`. */
  isInter(other: FlagSet): boolean {
    return flagIsInter(this.bits, other.bits);
  }

  /**
   * True when `other` is a subset of this set (every flag set in `other`
   * is also set in this). Mirrors upstream flag_is_subset(this, other).
   */
  isSubset(other: FlagSet): boolean {
    return flagIsSubset(this.bits, other.bits);
  }

  isEqual(other: FlagSet): boolean {
    return flagIsEqual(this.bits, other.bits);
  }

  on(flag: number): boolean {
    return flagOn(this.bits, flag);
  }

  off(flag: number): boolean {
    return flagOff(this.bits, flag);
  }

  wipe(): void {
    flagWipe(this.bits);
  }

  setall(): void {
    flagSetall(this.bits);
  }

  negate(): void {
    flagNegate(this.bits);
  }

  /** Copies `other` into this set (upstream flag_copy(this, other)). */
  copy(other: FlagSet): void {
    flagCopy(this.bits, other.bits);
  }

  /** A new FlagSet with the same contents. */
  clone(): FlagSet {
    return new FlagSet(Uint8Array.from(this.bits));
  }

  union(other: FlagSet): boolean {
    return flagUnion(this.bits, other.bits);
  }

  inter(other: FlagSet): boolean {
    return flagInter(this.bits, other.bits);
  }

  diff(other: FlagSet): boolean {
    return flagDiff(this.bits, other.bits);
  }

  compUnion(other: FlagSet): boolean {
    return flagCompUnion(this.bits, other.bits);
  }

  compInter(other: FlagSet): boolean {
    return flagCompInter(this.bits, other.bits);
  }

  compDiff(other: FlagSet): boolean {
    return flagCompDiff(this.bits, other.bits);
  }

  test(...check: number[]): boolean {
    return flagsTest(this.bits, ...check);
  }

  testAll(...check: number[]): boolean {
    return flagsTestAll(this.bits, ...check);
  }

  clear(...clear: number[]): boolean {
    return flagsClear(this.bits, ...clear);
  }

  set(...set: number[]): boolean {
    return flagsSet(this.bits, ...set);
  }

  init(...set: number[]): void {
    flagsInit(this.bits, ...set);
  }

  mask(...mask: number[]): boolean {
    return flagsMask(this.bits, ...mask);
  }

  /** Iterate the set flags in ascending order. */
  *[Symbol.iterator](): IterableIterator<number> {
    for (
      let f = flagNext(this.bits, FLAG_START);
      f !== NO_FLAG;
      f = flagNext(this.bits, f + 1)
    ) {
      yield f;
    }
  }
}
