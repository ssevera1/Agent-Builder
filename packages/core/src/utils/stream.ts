/**
 * AsyncIterable helper utilities for working with streaming data.
 */

/**
 * Transform each item in an async iterable.
 *
 * @param source - Source async iterable.
 * @param fn - Mapping function applied to each item.
 * @returns A new async iterable of mapped items.
 */
export async function* mapStream<T, U>(
  source: AsyncIterable<T>,
  fn: (item: T, index: number) => U | Promise<U>,
): AsyncGenerator<U> {
  let index = 0;
  for await (const item of source) {
    yield await fn(item, index++);
  }
}

/**
 * Filter items from an async iterable.
 *
 * @param source - Source async iterable.
 * @param predicate - Return true to keep the item.
 * @returns A new async iterable with only items that pass the predicate.
 */
export async function* filterStream<T>(
  source: AsyncIterable<T>,
  predicate: (item: T, index: number) => boolean | Promise<boolean>,
): AsyncGenerator<T> {
  let index = 0;
  for await (const item of source) {
    if (await predicate(item, index++)) {
      yield item;
    }
  }
}

/**
 * Merge multiple async iterables into a single stream.
 * Items are yielded as they become available (interleaved, not sequential).
 *
 * @param sources - Array of async iterables to merge.
 * @returns A single async iterable that yields items from all sources.
 */
export async function* mergeStreams<T>(...sources: AsyncIterable<T>[]): AsyncGenerator<T> {
  // We convert each source into a "racing" promise and yield as they resolve.
  type IteratorState = {
    iterator: AsyncIterator<T>;
    done: boolean;
  };

  const states: IteratorState[] = sources.map((src) => ({
    iterator: src[Symbol.asyncIterator](),
    done: false,
  }));

  // Pull the next value from each active iterator
  function pullNext(
    state: IteratorState,
    index: number,
  ): Promise<{ index: number; result: IteratorResult<T> }> {
    return state.iterator.next().then((result) => ({ index, result }));
  }

  // Active promises: one per non-done iterator
  const pending = new Map<number, Promise<{ index: number; result: IteratorResult<T> }>>();

  for (let i = 0; i < states.length; i++) {
    const state = states[i]!;
    pending.set(i, pullNext(state, i));
  }

  try {
    while (pending.size > 0) {
      // Race all pending promises
      const { index, result } = await Promise.race(pending.values());

      if (result.done) {
        states[index]!.done = true;
        pending.delete(index);
      } else {
        yield result.value;
        // Immediately request the next value from this iterator
        const state = states[index]!;
        pending.set(index, pullNext(state, index));
      }
    }
  } finally {
    // Close any iterators that are still open (consumer exited early or one source threw)
    for (const state of states) {
      if (!state.done) {
        await state.iterator.return?.();
      }
    }
  }
}

/**
 * Collect all items from an async iterable into an array.
 *
 * @param source - Source async iterable.
 * @returns Array of all items.
 */
export async function collectStream<T>(source: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of source) {
    items.push(item);
  }
  return items;
}

/**
 * Take the first N items from an async iterable and stop.
 *
 * @param source - Source async iterable.
 * @param count - Maximum number of items to take.
 * @returns A new async iterable that yields at most `count` items.
 */
export async function* takeStream<T>(
  source: AsyncIterable<T>,
  count: number,
): AsyncGenerator<T> {
  let taken = 0;
  for await (const item of source) {
    if (taken >= count) {
      return;
    }
    yield item;
    taken++;
  }
}

/**
 * Callback types for streamToCallback.
 */
export interface StreamCallbacks<T> {
  /** Called for each item in the stream. */
  onData: (item: T) => void;
  /** Called when the stream ends successfully. */
  onEnd?: () => void;
  /** Called if the stream errors. */
  onError?: (error: unknown) => void;
}

/**
 * Convert an async iterable into event callbacks.
 * Useful for bridging async iterables to event-driven APIs (e.g., SSE, WebSockets).
 *
 * @param source - Source async iterable.
 * @param callbacks - Event callbacks.
 * @returns A promise that resolves when the stream completes.
 */
export async function streamToCallback<T>(
  source: AsyncIterable<T>,
  callbacks: StreamCallbacks<T>,
): Promise<void> {
  try {
    for await (const item of source) {
      callbacks.onData(item);
    }
    callbacks.onEnd?.();
  } catch (error) {
    if (callbacks.onError) {
      callbacks.onError(error);
    } else {
      throw error;
    }
  }
}

/**
 * Create an async iterable from a callback-based API.
 * Returns a [push, iterable] pair. Call push(item) to emit items,
 * and push(null) to signal completion.
 */
export function createPushStream<T>(): {
  push: (item: T | null) => void;
  pushError: (error: unknown) => void;
  stream: AsyncIterable<T>;
} {
  type QueueItem =
    | { type: 'value'; value: T }
    | { type: 'done' }
    | { type: 'error'; error: unknown };

  const queue: QueueItem[] = [];
  let resolve: ((value: void) => void) | null = null;
  let done = false;

  function notify() {
    if (resolve) {
      const r = resolve;
      resolve = null;
      r();
    }
  }

  function push(item: T | null) {
    if (done) return;
    if (item === null) {
      done = true;
      queue.push({ type: 'done' });
    } else {
      queue.push({ type: 'value', value: item });
    }
    notify();
  }

  function pushError(error: unknown) {
    if (done) return;
    done = true;
    queue.push({ type: 'error', error });
    notify();
  }

  async function* generate(): AsyncGenerator<T> {
    try {
      while (true) {
        if (queue.length === 0) {
          await new Promise<void>((r) => {
            resolve = r;
          });
        }

        while (queue.length > 0) {
          const item = queue.shift()!;
          if (item.type === 'done') {
            return;
          }
          if (item.type === 'error') {
            throw item.error;
          }
          yield item.value;
        }
      }
    } finally {
      // Stop accepting new items when the consumer exits early
      done = true;
    }
  }

  return { push, pushError, stream: generate() };
}
