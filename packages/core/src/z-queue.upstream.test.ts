/**
 * Upstream unit tests from reference/src/tests/z-queue/qp.c (suite z-queue/qp).
 *
 * Mapping: qp_new -> qpNew; qp_size -> size(); qp_len -> len();
 * qp_push_int / qp_push_ptr -> push(); qp_pop_int / qp_pop_ptr -> pop();
 * qp_pushpop_int / qp_pushpop_ptr -> pushpop(); qp_peek_int / qp_peek_ptr ->
 * peek(); qp_resize -> resize(); qp_flush -> flush(); qp_free -> free();
 * qp_isinvalid -> isInvalid().
 *
 * The int / pointer halves of every entry point have line-for-line identical
 * bodies upstream and differ only in which member of the payload union they
 * read, so they collapse into one generic method here (see z-queue.ts). Both
 * halves are still exercised: the `_int` cases below use PriorityQueue<number>
 * and the `_ptr` cases PriorityQueue<Marker>, where reference identity stands
 * in for pointer identity and `toBe` is upstream's ptreq.
 *
 * The `payload_free` callback is a C memory concern with no JS counterpart, but
 * it is not skipped: it is passed as a collector, so the cases assert exactly
 * WHICH elements upstream would have freed and in what order. The one place
 * that callback changes behaviour rather than just releasing memory - qp_resize
 * dropping the overflow only when the callback is non-NULL (z-queue.c L231) -
 * gets its own assertion at the end, beyond the upstream case.
 *
 * The peek-then-pop order asserted by test_qp_integer and test_qp_pointer is
 * upstream's qsort by priority. Every priority in both data sets is distinct,
 * so that order is fully determined and C's unstable qsort cannot differ.
 */

import { describe, expect, it } from "vitest";
import { qpNew } from "./z-queue";

/** A stand-in for the `void *` payloads: identity is the only thing asserted. */
interface Marker {
  readonly id: string;
}

function marker(id: string): Marker {
  return { id };
}

describe("z-queue/qp upstream", () => {
  // C: test_qp_trivial
  it("test_qp_trivial", () => {
    let qp = qpNew<number>(0);
    expect(qp.size()).toBe(0);
    expect(qp.len()).toBe(0);
    expect(qp.isInvalid()).toBe(false);
    qp.free();

    qp = qpNew<number>(4);
    expect(qp.size()).toBe(4);
    expect(qp.len()).toBe(0);
    expect(qp.isInvalid()).toBe(false);
    qp.push(7, 10);
    expect(qp.size()).toBe(4);
    expect(qp.len()).toBe(1);
    expect(qp.isInvalid()).toBe(false);
    expect(qp.peek()).toBe(10);
    expect(qp.pop()).toBe(10);
    expect(qp.size()).toBe(4);
    expect(qp.len()).toBe(0);
    expect(qp.isInvalid()).toBe(false);
    qp.free();

    /* The C pushes &qp, a pointer whose only property is its identity. */
    const self = marker("qp");
    const qpp = qpNew<Marker>(5);
    expect(qpp.size()).toBe(5);
    expect(qpp.len()).toBe(0);
    expect(qpp.isInvalid()).toBe(false);
    qpp.push(-3, self);
    expect(qpp.size()).toBe(5);
    expect(qpp.len()).toBe(1);
    expect(qpp.isInvalid()).toBe(false);
    expect(qpp.peek()).toBe(self);
    expect(qpp.pop()).toBe(self);
    expect(qpp.size()).toBe(5);
    expect(qpp.len()).toBe(0);
    expect(qpp.isInvalid()).toBe(false);
    qpp.free();
  });

  // C: test_qp_integer
  it("test_qp_integer", () => {
    const size = 15;
    const data: { priority: number; payload: number }[] = [
      { priority: 6, payload: -3 },
      { priority: 3, payload: 15 },
      { priority: 17, payload: 0 },
      { priority: 16, payload: -2 },
      { priority: 0, payload: 8 },
      { priority: 9, payload: 11 },
      { priority: -3, payload: -7 },
      { priority: 14, payload: 10 },
      { priority: 20, payload: 1 },
      { priority: 11, payload: 18 },
      { priority: 5, payload: 7 },
      { priority: -4, payload: 6 },
    ];
    /* C: qsort(sorted, ..., compare_iidata) - by priority, ascending. */
    const sorted = [...data].sort((a, b) => a.priority - b.priority);
    const qp = qpNew<number>(size);

    expect(qp.size()).toBe(size);
    expect(qp.len()).toBe(0);
    expect(qp.isInvalid()).toBe(false);
    const first = data[0] as { priority: number; payload: number };
    qp.push(first.priority, first.payload);
    expect(qp.size()).toBe(size);
    expect(qp.len()).toBe(1);
    expect(qp.peek()).toBe(first.payload);
    expect(qp.isInvalid()).toBe(false);
    for (let i = 1; i < data.length; ++i) {
      const d = data[i] as { priority: number; payload: number };
      qp.push(d.priority, d.payload);
      expect(qp.size()).toBe(size);
      expect(qp.len()).toBe(i + 1);
      expect(qp.isInvalid()).toBe(false);
    }
    for (let i = 0; i < data.length; ++i) {
      const s = sorted[i] as { priority: number; payload: number };
      expect(qp.peek()).toBe(s.payload);
      expect(qp.pop()).toBe(s.payload);
      expect(qp.size()).toBe(size);
      expect(qp.len()).toBe(data.length - i - 1);
      expect(qp.isInvalid()).toBe(false);
    }
    qp.free();
  });

  // C: test_qp_pointer
  it("test_qp_pointer", () => {
    const size = 15;
    /* The C's payloads are `data + n`, pointers into its own array; all that is
     * asserted of them is identity, so distinct objects serve. */
    const m = Array.from({ length: 14 }, (_unused, i) => marker(`m${i}`));
    const data: { priority: number; payload: Marker }[] = [
      { priority: 8, payload: m[8] as Marker },
      { priority: 19, payload: m[3] as Marker },
      { priority: 12, payload: m[0] as Marker },
      { priority: -7, payload: m[4] as Marker },
      { priority: 0, payload: m[2] as Marker },
      { priority: 15, payload: m[9] as Marker },
      { priority: 1, payload: m[7] as Marker },
      { priority: 13, payload: m[13] as Marker },
      { priority: 9, payload: m[1] as Marker },
      { priority: 11, payload: m[10] as Marker },
      { priority: 3, payload: m[5] as Marker },
      { priority: 16, payload: m[11] as Marker },
      { priority: -12, payload: m[6] as Marker },
      { priority: 23, payload: m[12] as Marker },
    ];
    const sorted = [...data].sort((a, b) => a.priority - b.priority);
    const qp = qpNew<Marker>(size);

    expect(qp.size()).toBe(size);
    expect(qp.len()).toBe(0);
    expect(qp.isInvalid()).toBe(false);
    const first = data[0] as { priority: number; payload: Marker };
    qp.push(first.priority, first.payload);
    expect(qp.size()).toBe(size);
    expect(qp.len()).toBe(1);
    expect(qp.peek()).toBe(first.payload);
    expect(qp.isInvalid()).toBe(false);
    for (let i = 1; i < data.length; ++i) {
      const d = data[i] as { priority: number; payload: Marker };
      qp.push(d.priority, d.payload);
      expect(qp.size()).toBe(size);
      expect(qp.len()).toBe(i + 1);
      expect(qp.isInvalid()).toBe(false);
    }
    for (let i = 0; i < data.length; ++i) {
      const s = sorted[i] as { priority: number; payload: Marker };
      expect(qp.peek()).toBe(s.payload);
      expect(qp.pop()).toBe(s.payload);
      expect(qp.isInvalid()).toBe(false);
      expect(qp.size()).toBe(size);
      expect(qp.len()).toBe(data.length - i - 1);
    }
    qp.free();
  });

  // C: test_qp_pushpop
  it("test_qp_pushpop", () => {
    const qp = qpNew<number>(8);

    expect(qp.len()).toBe(0);
    expect(qp.isInvalid()).toBe(false);
    /* Empty queue: the new element comes straight back and is not stored. */
    expect(qp.pushpop(9, 76)).toBe(76);
    expect(qp.len()).toBe(0);
    expect(qp.isInvalid()).toBe(false);
    qp.push(-7, 34);
    /* A lower priority than the head: handed back, heap untouched. */
    expect(qp.pushpop(-9, 20)).toBe(20);
    expect(qp.len()).toBe(1);
    expect(qp.isInvalid()).toBe(false);
    /* A higher priority: the head pops and the new element takes its place. */
    expect(qp.pushpop(11, 13)).toBe(34);
    expect(qp.len()).toBe(1);
    expect(qp.isInvalid()).toBe(false);
    expect(qp.pop()).toBe(13);
    expect(qp.len()).toBe(0);
    expect(qp.isInvalid()).toBe(false);

    const a = marker("a");
    const b = marker("b");
    const c = marker("c");
    const qpp = qpNew<Marker>(8);
    expect(qpp.pushpop(13, a)).toBe(a);
    expect(qpp.len()).toBe(0);
    expect(qpp.isInvalid()).toBe(false);
    qpp.push(6, b);
    expect(qpp.pushpop(3, c)).toBe(c);
    expect(qpp.len()).toBe(1);
    expect(qpp.isInvalid()).toBe(false);
    expect(qpp.pushpop(8, a)).toBe(b);
    expect(qpp.len()).toBe(1);
    expect(qpp.isInvalid()).toBe(false);
    expect(qpp.pop()).toBe(a);
    expect(qpp.len()).toBe(0);
    expect(qpp.isInvalid()).toBe(false);

    qp.free();
    qpp.free();
  });

  // C: test_qp_resize
  it("test_qp_resize", () => {
    const freed: Marker[] = [];
    const memFree = (p: Marker): void => {
      freed.push(p);
    };

    let a = marker("a");
    let b = marker("b");
    let c = marker("c");
    const d = marker("d");
    let qp = qpNew<Marker>(3);
    qp.push(10, a);
    qp.push(8, b);
    qp.push(9, c);
    expect(qp.isInvalid()).toBe(false);
    expect(qp.len()).toBe(3);
    expect(qp.peek()).toBe(b);
    /* Growing: nothing is dropped, the head is unchanged. */
    expect(qp.resize(10, memFree)).toBe(false);
    expect(freed).toEqual([]);
    expect(qp.size()).toBe(10);
    expect(qp.len()).toBe(3);
    expect(qp.peek()).toBe(b);
    qp.push(12, d);
    expect(qp.len()).toBe(4);
    expect(qp.pop()).toBe(b);
    expect(qp.pop()).toBe(c);
    expect(qp.pop()).toBe(a);
    expect(qp.pop()).toBe(d);
    qp.free(memFree);
    expect(freed).toEqual([]);

    qp = qpNew<Marker>(3);
    a = marker("a2");
    b = marker("b2");
    c = marker("c2");
    qp.push(10, a);
    qp.push(8, b);
    qp.push(9, c);
    expect(qp.isInvalid()).toBe(false);
    expect(qp.len()).toBe(3);
    expect(qp.peek()).toBe(b);
    /* Shrinking below the occupancy: the elements at array indices >= the new
     * size are freed and dropped - which are NOT the highest-priority ones, but
     * whatever the heap layout put there (here a at [1] and c at [2]). */
    expect(qp.resize(1, memFree)).toBe(false);
    expect(freed).toEqual([a, c]);
    expect(qp.isInvalid()).toBe(false);
    expect(qp.size()).toBe(1);
    expect(qp.len()).toBe(1);
    expect(qp.peek()).toBe(b);
    qp.free(memFree);
    expect(freed).toEqual([a, c, b]);
  });

  // C: test_qp_flush
  it("test_qp_flush", () => {
    const qp = qpNew<number>(3);
    qp.flush();
    expect(qp.size()).toBe(3);
    expect(qp.len()).toBe(0);
    expect(qp.isInvalid()).toBe(false);
    qp.push(7, 21);
    qp.push(5, 32);
    qp.push(10, 19);
    qp.flush();
    expect(qp.size()).toBe(3);
    expect(qp.len()).toBe(0);
    expect(qp.isInvalid()).toBe(false);

    const freed: Marker[] = [];
    const a = marker("a");
    const b = marker("b");
    const c = marker("c");
    const qpp = qpNew<Marker>(3);
    qpp.push(9, a);
    qpp.push(12, b);
    qpp.push(4, c);
    qpp.flush((p) => {
      freed.push(p);
    });
    /* The C frees data[0..count), i.e. in heap-array order, not pop order. */
    expect(freed).toEqual([c, b, a]);
    expect(qpp.size()).toBe(3);
    expect(qpp.len()).toBe(0);
    expect(qpp.isInvalid()).toBe(false);

    qp.free();
    qpp.free();
  });

  /*
   * Beyond the upstream cases: qp_pushpop's head test (z-queue.c L415) is
   * `priority <= data[0].priority`, so on a TIE the incoming element is handed
   * straight back and the heap is not touched at all. test_qp_pushpop only ever
   * pushes priorities strictly below or strictly above the head, so `<` would
   * pass it. find_path leans on exactly this tie at L1281: the neighbour it held
   * back becomes the next grid it walks to whenever it ties with the best
   * pending one, which is what keeps its dive along the ddd order.
   */
  it("qp_pushpop returns the incoming element on a tie with the head (z-queue.c L415)", () => {
    const a = marker("a");
    const b = marker("b");
    const qp = qpNew<Marker>(4);
    qp.push(5, a);
    expect(qp.pushpop(5, b)).toBe(b);
    expect(qp.len()).toBe(1);
    /* a is still in the queue, untouched; b was never stored. */
    expect(qp.peek()).toBe(a);
    expect(qp.isInvalid()).toBe(false);
  });

  /*
   * Beyond the upstream cases: down_heap's two-child branch (z-queue.c
   * L158-L172) when the two children have EQUAL priorities and the parent is
   * larger than both. Upstream's condition is `pri <= pri2 || pri1 < pri2`,
   * which is false for equal children, so it sinks through the RIGHT child - a
   * textbook "swap with the smaller child" heap sinks through the left one and
   * every other input agrees with upstream. test_qp_integer and test_qp_pointer
   * cannot see it: their assertion is a qsort by priority, and equal priorities
   * make any payload order valid there. find_path's priorities tie constantly,
   * so this decides which of two equal-cost grids it expands first.
   */
  it("down_heap sinks through the RIGHT child when children tie (z-queue.c L158)", () => {
    const a = marker("a");
    const b = marker("b");
    const c = marker("c");
    const d = marker("d");
    const qp = qpNew<Marker>(4);
    qp.push(1, a);
    qp.push(5, b);
    qp.push(5, c);
    qp.push(9, d);
    /* Popping a moves d (priority 9) to the root over children b and c, both
     * at 5. The C swaps d with the RIGHT child, leaving c at the head. */
    expect(qp.pop()).toBe(a);
    expect(qp.peek()).toBe(c);
    expect(qp.isInvalid()).toBe(false);
    expect(qp.pop()).toBe(c);
    expect(qp.pop()).toBe(b);
    expect(qp.pop()).toBe(d);
  });

  /* Beyond the upstream cases: qp_resize's NULL-callback branch (z-queue.c
   * L231) is the one place payload_free changes BEHAVIOUR rather than just
   * releasing memory. Without a callback the overflow is not dropped, and the
   * queue is left with count > size - which is exactly what makes
   * qp_isinvalid's first test (L504) fire. */
  it("qp_resize with no payload_free leaves count > size (z-queue.c L231 wart)", () => {
    const qp = qpNew<number>(3);
    qp.push(10, 1);
    qp.push(8, 2);
    qp.push(9, 3);
    expect(qp.resize(1)).toBe(false);
    expect(qp.size()).toBe(1);
    expect(qp.len()).toBe(3);
    expect(qp.isInvalid()).toBe(true);
  });
});
