/** Test helpers: a seeded PRNG (so property runs are reproducible) and stream builders. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomBytes(rand: () => number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.floor(rand() * 256);
  return out;
}

/** A stream over `bytes` cut into chunks of the given sizes (cycled), so chunk boundaries land anywhere. */
export function streamOf(bytes: Uint8Array, chunkSizes: number[] = [bytes.length || 1]): ReadableStream<Uint8Array> {
  let offset = 0;
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const size = Math.max(1, chunkSizes[i++ % chunkSizes.length] ?? 1);
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
}

export function text(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

export async function rejectsWithCode(promise: Promise<unknown> | (() => unknown), code: string): Promise<void> {
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (error) {
    const got = (error as { code?: string }).code;
    if (got !== code) throw new Error(`expected error code ${code}, got ${String(got)}: ${String(error)}`);
    return;
  }
  throw new Error(`expected error code ${code}, but nothing was thrown`);
}

