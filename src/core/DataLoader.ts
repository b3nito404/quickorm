/**
 * Generic DataLoader batches multiple individual loads into a single
 * bulk fetch, eliminating the N+1 query problem for relation loading.
 *
 * Uses a microtask (Promise.resolve().then) to collect all keys
 * requested in the same synchronous "tick" before firing one query.
 */
export class DataLoader<K extends string | number, V> {
  private queue: Map<K, Array<(v: V | null) => void>> = new Map();
  private scheduled = false;
  private stats = { batches: 0, requests: 0 };

  constructor(
    private readonly batchFn: (keys: K[]) => Promise<Map<K, V>>,
    private readonly options: { maxBatchSize?: number } = {}
  ) {}

  /** Load a single key batched with all concurrent load() calls. */
  load(key: K): Promise<V | null> {
    this.stats.requests++;
    return new Promise<V | null>((resolve) => {
      if (!this.queue.has(key)) this.queue.set(key, []);
      this.queue.get(key)!.push(resolve);
      if (!this.scheduled) {
        this.scheduled = true;
        Promise.resolve().then(() => this.flush());
      }
    });
  }

  /** Load multiple keys convenience wrapper. */
  loadMany(keys: K[]): Promise<Array<V | null>> {
    return Promise.all(keys.map((k) => this.load(k)));
  }

  /** D: how many batches and requests have been processed */
  getStats() { return { ...this.stats }; }

  clear(): void {
    this.queue.clear();
    this.scheduled = false;
  }

  private async flush(): Promise<void> {
    const maxBatch = this.options.maxBatchSize ?? Infinity;
    while (this.queue.size > 0) {
      const entries = Array.from(this.queue.entries()).slice(0, maxBatch);
      const keys    = entries.map(([k]) => k);
      const pending = new Map(entries);
      for (const [k] of entries) this.queue.delete(k);
      this.stats.batches++;
      let results: Map<K, V>;
      try {
        results = await this.batchFn(keys);
      } catch {
        results = new Map();
      }
      for (const [key, resolvers] of pending) {
        const value = results.get(key) ?? null;
        for (const r of resolvers) r(value);
      }
    }
    this.scheduled = false;
  }
}
