import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Hostile or maximal inputs run in a child process whose V8 heap is capped well below the 128 MB a Worker
 * has. Before the iterative O(depth) walk and the single growing line buffer the first four died with an
 * out-of-memory abort (a non-zero exit and no output line). The caps sit above what the current code needs
 * and below what the old code needed; measured minimum heaps (child includes building its own fixture):
 * wide-array 48 MB, wide-nested 80 MB, wide-manifest 96 MB, tiny-chunks 32 MB, checksums-max 48 MB,
 * checksums-over 24 MB, media-index-150k 24 MB.
 *
 * Caveat: `--max-old-space-size` limits the V8 heap only, not ArrayBuffer backing stores (external memory). These
 * tests therefore prove that row OBJECTS, parsed values and stack entries do not accumulate; they do not prove that
 * the BYTES of a file are never buffered (a Uint8Array of the whole input would not trip the cap). Byte buffering is
 * bounded separately by the explicit byte limits (line, manifest, checksums), each tested on its own.
 */
const child = fileURLToPath(new URL('./memory-child.ts', import.meta.url));

function run(scenario: string, heapMb: number): { status: number | null; last: string } {
  const result = spawnSync(process.execPath, [`--max-old-space-size=${heapMb}`, '--import', 'tsx', child, scenario], { encoding: 'utf8', timeout: 110_000 });
  const lines = result.stdout.trim().split('\n');
  return { status: result.status, last: lines[lines.length - 1] ?? '' };
}

describe('bounded memory on hostile shapes (child process, capped heap)', () => {
  it('a 4 MiB row of two million array elements is read end to end (readNdjson) in bounded memory', () => {
    const { status, last } = run('wide-array', 64);
    expect(status).toBe(0);
    expect(JSON.parse(last)).toEqual({ ok: true, rows: 1 });
  }, 120_000);

  it('a row of a million empty containers is read end to end without a stack entry per container', () => {
    const { status, last } = run('wide-nested', 96);
    expect(status).toBe(0);
    expect(JSON.parse(last)).toEqual({ ok: true, rows: 1 });
  }, 120_000);

  it('a 16 MiB wide manifest is refused by the schema, not by running out of memory', () => {
    const { status, last } = run('wide-manifest', 112);
    expect(status).toBe(0);
    expect(JSON.parse(last)).toMatchObject({ ok: true, code: 'manifest_invalid' });
  }, 120_000);

  it('a 4 MiB line delivered one byte at a time reads in one bounded buffer', () => {
    const { status, last } = run('tiny-chunks', 48);
    expect(status).toBe(0);
    expect(JSON.parse(last)).toEqual({ ok: true, rows: 1 });
  }, 120_000);

  it('the largest checksums file the caps allow (50,002 entries, about 11.6 MB) parses in bounded memory', () => {
    const { status, last } = run('checksums-max', 64);
    expect(status).toBe(0);
    expect(JSON.parse(last)).toMatchObject({ ok: true, entries: 50_002 });
  }, 120_000);

  it('a 150,000-row media index (46.8 MB) is hashed and verified against its declaration in a streaming pass', () => {
    const { status, last } = run('media-index-150k', 32);
    expect(status).toBe(0);
    expect(JSON.parse(last)).toEqual({ ok: true, rows: 150_000, bytes: 46_838_890 });
  }, 120_000);

  it('a checksums file one byte over the cap is refused before decoding', () => {
    const { status, last } = run('checksums-over', 48);
    expect(status).toBe(0);
    expect(JSON.parse(last)).toEqual({ ok: true, code: 'checksums_invalid', message: 'file too large' });
  }, 120_000);
});
