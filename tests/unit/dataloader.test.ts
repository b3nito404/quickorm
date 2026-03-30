import 'reflect-metadata';
import { DataLoader } from '../../src/core/DataLoader';

describe('DataLoader', () => {
  test('batches multiple loads into one batchFn call', async () => {
    let batchCount = 0;
    const loader = new DataLoader<string, string>(async (keys) => {
      batchCount++;
      const map = new Map<string, string>();
      keys.forEach(k => map.set(k, `val:${k}`));
      return map;
    });

    const [a, b, c] = await Promise.all([
      loader.load('k1'),
      loader.load('k2'),
      loader.load('k3'),
    ]);

    expect(a).toBe('val:k1');
    expect(b).toBe('val:k2');
    expect(c).toBe('val:k3');
    expect(batchCount).toBe(1); // all 3 batched into ONE call
  });

  test('returns null for missing keys', async () => {
    const loader = new DataLoader<string, string>(async (_keys) => new Map());
    const result = await loader.load('missing');
    expect(result).toBeNull();
  });

  test('loadMany returns array in correct order', async () => {
    const loader = new DataLoader<number, string>(async (keys) => {
      const map = new Map<number, string>();
      keys.forEach(k => map.set(k, `item-${k}`));
      return map;
    });

    const results = await loader.loadMany([3, 1, 2]);
    expect(results).toEqual(['item-3', 'item-1', 'item-2']);
  });

  test('deduplicates keys in same batch', async () => {
    const batchArgs: number[][] = [];
    const loader = new DataLoader<number, string>(async (keys) => {
      batchArgs.push([...keys]);
      const map = new Map<number, string>();
      keys.forEach(k => map.set(k, `v${k}`));
      return map;
    });

    const [a, b] = await Promise.all([
      loader.load(1),
      loader.load(1), // duplicate
    ]);

    expect(a).toBe('v1');
    expect(b).toBe('v1');
    // key 1 should appear only once in the batch
    expect(batchArgs[0]).toEqual([1]);
  });

  test('respects maxBatchSize option', async () => {
    const batchArgs: string[][] = [];
    const loader = new DataLoader<string, string>(
      async (keys) => {
        batchArgs.push([...keys]);
        const map = new Map<string, string>();
        keys.forEach(k => map.set(k, k));
        return map;
      },
      { maxBatchSize: 2 }
    );

    await Promise.all(['a','b','c','d'].map(k => loader.load(k)));
    // With maxBatchSize=2, we expect 2 batches of 2
    expect(batchArgs.length).toBe(2);
    expect(batchArgs[0].length).toBe(2);
    expect(batchArgs[1].length).toBe(2);
  });

  test('getStats() tracks batches and requests', async () => {
    const loader = new DataLoader<number, number>(async (keys) => {
      const m = new Map<number, number>();
      keys.forEach(k => m.set(k, k * 2));
      return m;
    });

    await Promise.all([loader.load(1), loader.load(2)]);
    await loader.load(3); // second tick new batch

    const stats = loader.getStats();
    expect(stats.requests).toBe(3);
    expect(stats.batches).toBeGreaterThanOrEqual(1);
  });

  test('clear() resets the queue', async () => {
    let calls = 0;
    const loader = new DataLoader<string, string>(async (keys) => {
      calls++;
      const m = new Map<string, string>();
      keys.forEach(k => m.set(k, k));
      return m;
    });

    loader.clear();
    await loader.load('x');
    expect(calls).toBe(1);
  });
});
