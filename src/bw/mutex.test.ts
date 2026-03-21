import assert from 'node:assert/strict';
import test from 'node:test';
import { Mutex } from './mutex.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('mutex serializes concurrent operations', async () => {
  const mutex = new Mutex();
  const order: number[] = [];

  await Promise.all([
    mutex.runExclusive(async () => {
      await delay(20);
      order.push(1);
    }),
    mutex.runExclusive(async () => {
      order.push(2);
    }),
    mutex.runExclusive(async () => {
      order.push(3);
    }),
  ]);

  assert.deepEqual(order, [1, 2, 3]);
});

test('mutex propagates return values', async () => {
  const mutex = new Mutex();
  const result = await mutex.runExclusive(async () => 42);
  assert.equal(result, 42);
});

test('mutex propagates exceptions without blocking subsequent callers', async () => {
  const mutex = new Mutex();

  await assert.rejects(
    () =>
      mutex.runExclusive(async () => {
        throw new Error('boom');
      }),
    { message: 'boom' },
  );

  // Subsequent call should still work
  const result = await mutex.runExclusive(async () => 'ok');
  assert.equal(result, 'ok');
});

test('mutex handles rapid sequential calls', async () => {
  const mutex = new Mutex();
  const results: number[] = [];

  for (let i = 0; i < 10; i++) {
    results.push(await mutex.runExclusive(async () => i));
  }

  assert.deepEqual(results, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('mutex maintains exclusivity after errors in the middle', async () => {
  const mutex = new Mutex();
  const order: string[] = [];

  const p1 = mutex.runExclusive(async () => {
    order.push('a-start');
    await delay(10);
    order.push('a-end');
  });

  const p2 = mutex.runExclusive(async () => {
    order.push('b-start');
    throw new Error('b-fail');
  });

  const p3 = mutex.runExclusive(async () => {
    order.push('c-start');
    order.push('c-end');
  });

  await p1;
  await p2.catch(() => {});
  await p3;

  assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'c-start', 'c-end']);
});
