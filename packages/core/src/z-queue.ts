/** Faithful integer priority heap from reference/src/z-queue.c. */
/** z-queue.c's fixed-capacity circular integer queue. */
export class CircularIntQueue {
  private data: number[];
  private head = 0;
  private tail = 0;
  constructor(size: number) { this.data = new Array<number>(size + 1); }
  get size(): number { return this.data.length - 1; }
  get length(): number { return this.tail >= this.head ? this.tail - this.head : this.data.length - this.head + this.tail; }
  push(item: number): void {
    if (this.length === this.size) throw new Error("queue overflow");
    this.data[this.tail] = item; this.tail = (this.tail + 1) % this.data.length;
  }
  pop(): number {
    if (!this.length) throw new Error("queue underflow");
    const item = this.data[this.head] as number; this.head = (this.head + 1) % this.data.length; return item;
  }
}

interface Element { priority: number; payload: number; }

export class IntPriorityQueue {
  private data: Element[];
  private count = 0;
  constructor(size: number) { this.data = new Array<Element>(size); }
  get size(): number { return this.data.length; }
  get length(): number { return this.count; }
  resize(size: number): void { this.data.length = size; if (this.count > size) this.count = size; }
  push(priority: number, payload: number): void {
    if (this.count === this.size) throw new Error("priority queue overflow");
    this.data[this.count] = { priority, payload }; this.upHeap(this.count++);
  }
  pop(): number {
    if (!this.count) throw new Error("priority queue underflow");
    const result = (this.data[0] as Element).payload;
    this.data[0] = this.data[--this.count] as Element; this.downHeap(0); return result;
  }
  /** qp_pushpop_int(), retaining the C implementation's equality choices. */
  pushpop(priority: number, payload: number): number {
    if (!this.count || priority <= (this.data[0] as Element).priority) return payload;
    const result = (this.data[0] as Element).payload;
    if (priority <= (this.data[this.count - 1] as Element).priority) this.data[0] = { priority, payload };
    else { this.data[0] = this.data[this.count - 1] as Element; this.data[this.count - 1] = { priority, payload }; }
    this.downHeap(0); return result;
  }
  private upHeap(i: number): void {
    while (i) { const parent = (i - 1) >> 1; if ((this.data[i] as Element).priority >= (this.data[parent] as Element).priority) break;
      [this.data[parent], this.data[i]] = [this.data[i] as Element, this.data[parent] as Element]; i = parent; }
  }
  private downHeap(i: number): void {
    while (true) { const child1 = (i << 1) + 1; if (child1 >= this.count) break;
      if (child1 === this.count - 1) { if ((this.data[i] as Element).priority <= (this.data[child1] as Element).priority) break;
        [this.data[i], this.data[child1]] = [this.data[child1] as Element, this.data[i] as Element]; break; }
      const here = this.data[i] as Element, left = this.data[child1] as Element, right = this.data[child1 + 1] as Element;
      if (here.priority > left.priority) { if (here.priority <= right.priority || left.priority < right.priority) { [this.data[i], this.data[child1]] = [left, here]; i = child1; }
        else { [this.data[i], this.data[child1 + 1]] = [right, here]; i = child1 + 1; } }
      else if (here.priority > right.priority) { [this.data[i], this.data[child1 + 1]] = [right, here]; i = child1 + 1; } else break;
    }
  }
}
