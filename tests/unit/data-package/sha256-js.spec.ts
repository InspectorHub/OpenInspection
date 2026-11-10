import { describe, expect, it } from 'vitest';
import { Sha256Js } from '../../../server/lib/data-package/sha256-js';
import { prng, randomBytes } from './helpers';

async function reference(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('Sha256Js', () => {
  it('matches the published vectors', () => {
    const empty = new Sha256Js();
    expect(empty.digestHex()).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    const abc = new Sha256Js();
    abc.update(new TextEncoder().encode('abc'));
    expect(abc.digestHex()).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('agrees with Web Crypto for random lengths around every block boundary, in random chunkings', async () => {
    const rand = prng(1);
    const lengths = [...Array.from({ length: 140 }, (_, i) => i), 1000, 4096, 65_537];
    for (const length of lengths) {
      const bytes = randomBytes(rand, length);
      const hasher = new Sha256Js();
      let offset = 0;
      while (offset < bytes.length) {
        const step = 1 + Math.floor(rand() * 97);
        hasher.update(bytes.subarray(offset, offset + step));
        offset += step;
      }
      expect(hasher.digestHex(), `length ${length}`).toBe(await reference(bytes));
    }
  });

  it('digestHex is idempotent and refuses further input', () => {
    const h = new Sha256Js();
    h.update(new TextEncoder().encode('abc'));
    const first = h.digestHex();
    expect(h.digestHex()).toBe(first);
    expect(() => h.update(new Uint8Array(1))).toThrowError(expect.objectContaining({ code: 'hasher_finished' }));
    expect(h.digestHex()).toBe(first);
  });
});
