/**
 * The integer priority queue from reference/src/z-queue.c (Angband 4.2.6): the
 * two sift helpers up_heap (L115) and down_heap (L139), qp_new (L194),
 * qp_resize (L224), qp_flush (L251), qp_free (L271), qp_size (L291),
 * qp_len (L300), qp_push_int / qp_push_ptr (L317 / L337), qp_pop_int /
 * qp_pop_ptr (L358 / L382), qp_pushpop_int / qp_pushpop_ptr (L410 / L449),
 * qp_peek_int / qp_peek_ptr (L478 / L490) and qp_isinvalid (L500).
 *
 * It is a min-heap packed into an array: the LOWEST priority pops first.
 *
 * WHY THIS IS CORE AND NOT PLUMBING. find_path (player-path.c L1069) - the
 * routine do_cmd_pathfind calls to travel to a clicked grid - runs A* over this
 * heap. A heap is not a set: when several grids share a priority, WHICH one
 * pops first is decided entirely by the sift order in up_heap / down_heap and
 * by qp_pushpop_int's preference for the incoming element on a tie (L415). On
 * an open floor equal-cost routes are everywhere, so those comparisons pick the
 * route the character actually walks. Every one of them is therefore
 * transcribed rather than reimplemented - in particular the asymmetric pair in
 * down_heap's two-child branch (L158-L162), where the parent is compared to
 * child1 with `>` but to child1 + 1 with `<=`, and the two children with `<`.
 * A textbook "swap with the smaller child" heap is NOT this heap.
 *
 * THE ONE STRUCTURAL DIFFERENCE. Upstream keeps the payload in a
 * `union { void *p; int i; }` and exposes each half through its own entry point
 * (qp_push_int vs qp_push_ptr, qp_pop_int vs qp_pop_ptr, ...), declaring it
 * undefined behaviour to mix the two in one queue. The bodies of each pair are
 * line-for-line identical - only the union member read differs. TypeScript has
 * a single payload slot and no tagged union, so the pair collapses into one
 * generic parameter: `PriorityQueue<number>` is upstream's `_int` queue and
 * `PriorityQueue<SomeObject>` its `_ptr` queue, with reference identity
 * standing in for pointer identity.
 *
 * THE payload_free CALLBACK. Upstream's qp_resize / qp_flush / qp_free take a
 * `void (*payload_free)(void*)` so the C can release memory it owns. JS is
 * garbage-collected, so nothing here needs freeing - but the callback cannot be
 * dropped, because passing NULL rather than non-NULL selects DIFFERENT
 * BEHAVIOUR in qp_resize (L231): with a NULL callback the elements that no
 * longer fit are not discarded, and the queue is left with count > size. That
 * wart is reproduced; the callback is invoked on every element the C would have
 * freed, so a caller can observe which ones those are.
 */

/** struct priority_queue_element (z-queue.h L55). */
interface PriorityQueueElement<T> {
  priority: number;
  payload: T;
}

/**
 * struct priority_queue (z-queue.h L59): a min-heap packed into an array.
 *
 * `count` is the occupancy and lives as `data.length`; `size` is the separately
 * tracked capacity qp_new allocated, which upstream's callers grow explicitly
 * (find_path, player-path.c L1253-L1258) rather than relying on the array to
 * grow itself.
 */
export class PriorityQueue<T = number> {
  private readonly data: PriorityQueueElement<T>[] = [];
  private capacity: number;

  /**
   * qp_new (L194). Upstream quit()s when the requested size would overflow
   * SIZE_MAX / MAX(2, sizeof(element)); a JS array has no such ceiling, so the
   * only thing kept is the recorded capacity.
   */
  constructor(size: number) {
    this.capacity = size;
  }

  /** qp_size (L291): the maximum number of elements the queue can hold. */
  size(): number {
    return this.capacity;
  }

  /** qp_len (L300): the number of elements currently in the queue. */
  len(): number {
    return this.data.length;
  }

  /**
   * up_heap (L115): push the ith element upward while its priority is less
   * than its parent's.
   */
  private upHeap(i: number): void {
    for (;;) {
      if (i === 0) break;
      const parent = (i - 1) >> 1;
      if (
        (this.data[i] as PriorityQueueElement<T>).priority >=
        (this.data[parent] as PriorityQueueElement<T>).priority
      ) {
        break;
      }
      this.swap(i, parent);
      i = parent;
    }
  }

  /**
   * down_heap (L139): push the ith element downward while its priority is
   * greater than a child's. The comparisons are upstream's, including the
   * `<=` / `<` asymmetry that decides which child a tie sinks through.
   */
  private downHeap(i: number): void {
    const count = this.data.length;
    for (;;) {
      const child1 = (i << 1) + 1;
      if (child1 >= count) break;
      const pri = (this.data[i] as PriorityQueueElement<T>).priority;
      const pri1 = (this.data[child1] as PriorityQueueElement<T>).priority;
      if (child1 === count - 1) {
        /* There's only one child. */
        if (pri <= pri1) break;
        this.swap(i, child1);
        break;
      }
      const pri2 = (this.data[child1 + 1] as PriorityQueueElement<T>).priority;
      if (pri > pri1) {
        if (pri <= pri2 || pri1 < pri2) {
          this.swap(i, child1);
          i = child1;
        } else {
          this.swap(i, child1 + 1);
          i = child1 + 1;
        }
      } else if (pri > pri2) {
        this.swap(i, child1 + 1);
        i = child1 + 1;
      } else {
        break;
      }
    }
  }

  private swap(a: number, b: number): void {
    const tmp = this.data[a] as PriorityQueueElement<T>;
    this.data[a] = this.data[b] as PriorityQueueElement<T>;
    this.data[b] = tmp;
  }

  /**
   * qp_push_int (L317) / qp_push_ptr (L337): push a payload with the given
   * priority. Upstream asserts count < size and is otherwise undefined; the
   * assert is kept as a throw so a caller that forgets to resize (as find_path
   * does at L1253) is caught rather than silently corrupting the heap.
   */
  push(priority: number, payload: T): void {
    if (this.data.length >= this.capacity) {
      throw new Error("priority queue overflow (qp_push past qp_size)");
    }
    this.data.push({ priority, payload });
    this.upHeap(this.data.length - 1);
  }

  /**
   * qp_pop_int (L358) / qp_pop_ptr (L382): pop the head and return its
   * payload. Undefined upstream when the queue is empty.
   */
  pop(): T {
    if (this.data.length === 0) {
      throw new Error("priority queue underflow (qp_pop while empty)");
    }
    const result = (this.data[0] as PriorityQueueElement<T>).payload;
    const last = this.data.pop() as PriorityQueueElement<T>;
    if (this.data.length > 0) {
      /* C: --count; data[0] = data[count]; i.e. the old tail becomes the root
       * (a no-op self-assignment when the queue had one element). */
      this.data[0] = last;
      this.downHeap(0);
    }
    return result;
  }

  /**
   * qp_pushpop_int (L410) / qp_pushpop_ptr (L449): push then pop the head, in
   * one pass and without growing the heap.
   *
   * The `priority <= data[0].priority` test at L415 hands the NEW element
   * straight back on a tie, leaving the heap untouched - that is the tie-break
   * find_path leans on at L1281 when the last neighbour it examined ties with
   * the best pending grid.
   */
  pushpop(priority: number, payload: T): T {
    const count = this.data.length;
    if (count === 0 || priority <= (this.data[0] as PriorityQueueElement<T>).priority) {
      return payload;
    }
    const result = (this.data[0] as PriorityQueueElement<T>).payload;
    if (priority <= (this.data[count - 1] as PriorityQueueElement<T>).priority) {
      this.data[0] = { priority, payload };
    } else {
      this.data[0] = this.data[count - 1] as PriorityQueueElement<T>;
      this.data[count - 1] = { priority, payload };
    }
    this.downHeap(0);
    return result;
  }

  /**
   * qp_peek_int (L478) / qp_peek_ptr (L490): the payload at the head.
   * Undefined upstream when the queue is empty.
   */
  peek(): T {
    if (this.data.length === 0) {
      throw new Error("priority queue underflow (qp_peek while empty)");
    }
    return (this.data[0] as PriorityQueueElement<T>).payload;
  }

  /**
   * qp_resize (L224): change the capacity. Returns false on success, as
   * upstream does (the SIZE_MAX overflow that makes it return true has no JS
   * counterpart, so it always succeeds).
   *
   * WART KEPT: the elements that no longer fit are dropped only when
   * payloadFree is supplied (L231, `size < qp->count && payload_free`). With no
   * callback the occupancy is left alone and the queue ends up with
   * count > size, which upstream's own qp_size / qp_len asserts would then
   * trip. Callers that shrink are expected to pass a callback; find_path only
   * ever grows.
   */
  resize(size: number, payloadFree?: (payload: T) => void): boolean {
    if (size < this.data.length && payloadFree) {
      for (let i = size; i < this.data.length; ++i) {
        payloadFree((this.data[i] as PriorityQueueElement<T>).payload);
      }
      this.data.length = size;
    }
    this.capacity = size;
    return false;
  }

  /**
   * qp_flush (L251): remove every entry, calling payloadFree on each first if
   * given. The capacity is unchanged.
   */
  flush(payloadFree?: (payload: T) => void): void {
    if (payloadFree) {
      for (const element of this.data) payloadFree(element.payload);
    }
    this.data.length = 0;
  }

  /**
   * qp_free (L271): upstream releases the queue itself. Here it only runs the
   * payload callback over what is left, since the queue is garbage-collected.
   */
  free(payloadFree?: (payload: T) => void): void {
    if (payloadFree) {
      for (const element of this.data) payloadFree(element.payload);
    }
    this.data.length = 0;
  }

  /**
   * qp_isinvalid (L500): true when the heap invariant is broken. Upstream's
   * debug self-check, walking the deepest layer upward in sibling pairs.
   */
  isInvalid(): boolean {
    const count = this.data.length;
    if (count > this.capacity) return true;
    /* Queues with less than two elements have nothing to check. */
    if (count < 2) return false;

    let start: number;
    if ((count & 1) === 0) {
      /* On the deepest layer, there is a node with no sibling. */
      const parent = (count - 2) >> 1;
      if (
        (this.data[count - 1] as PriorityQueueElement<T>).priority <
        (this.data[parent] as PriorityQueueElement<T>).priority
      ) {
        return true;
      }
      start = count - 2;
    } else {
      /* All nodes on the deepest layer have a sibling. */
      start = count - 1;
    }

    while (start > 1) {
      const parent = (start - 1) >> 1;
      if (
        (this.data[start] as PriorityQueueElement<T>).priority <
          (this.data[parent] as PriorityQueueElement<T>).priority ||
        (this.data[start - 1] as PriorityQueueElement<T>).priority <
          (this.data[parent] as PriorityQueueElement<T>).priority
      ) {
        return true;
      }
      start -= 2;
    }
    return false;
  }
}

/** qp_new (z-queue.c L194): a priority queue holding up to `size` elements. */
export function qpNew<T = number>(size: number): PriorityQueue<T> {
  return new PriorityQueue<T>(size);
}
