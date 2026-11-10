/**
 * Child process for memory.spec.ts. Run as `node --max-old-space-size=N --import tsx memory-child.ts <scenario>`.
 * An out-of-memory kill exits non-zero without printing; a clean run prints one JSON line.
 */
import { MAX_CHECKSUM_ENTRIES, MAX_CHECKSUMS_BYTES, parseChecksums } from '../../../server/lib/data-package/checksums';
import { parseManifest } from '../../../server/lib/data-package/manifest';
import { readNdjson } from '../../../server/lib/data-package/ndjson';

function codeOf(error: unknown): string {
  return (error as { code?: string }).code ?? 'other';
}

/** The bytes as a stream in chunks of `chunk` bytes, the way an upload arrives. */
function chunked(bytes: Uint8Array, chunk: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) controller.close();
      else {
        controller.enqueue(bytes.subarray(offset, offset + chunk));
        offset += chunk;
      }
    },
  });
}

async function readRows(line: string, chunk: number): Promise<number> {
  let rows = 0;
  for await (const row of readNdjson(chunked(new TextEncoder().encode(`${line}\n`), chunk))) {
    rows += 1;
    void row;
  }
  return rows;
}

async function main(scenario: string): Promise<string> {
  if (scenario === 'wide-array') {
    // A 4 MiB line (the line limit) holding two million array elements, read end to end through readNdjson.
    const n = 2_000_000;
    return JSON.stringify({ ok: true, rows: await readRows(`{"a":[${'0,'.repeat(n - 1)}0]}`, 65_536) });
  }
  if (scenario === 'wide-nested') {
    // A row of a million empty arrays: containers, not scalars.
    const n = 1_000_000;
    return JSON.stringify({ ok: true, rows: await readRows(`{"a":[${'[],'.repeat(n - 1)}[]]}`, 65_536) });
  }
  if (scenario === 'wide-manifest') {
    // A 16 MiB hostile manifest whose "files" is a huge array of scalars.
    const body = '0,'.repeat(8_000_000);
    const text = `{"formatVersion":1,"files":[${body}0]}`;
    try {
      parseManifest(text);
      return JSON.stringify({ ok: false });
    } catch (error) {
      return JSON.stringify({ ok: true, code: codeOf(error), chars: text.length });
    }
  }
  if (scenario === 'tiny-chunks') {
    // One 4 MiB line delivered one byte at a time.
    const line = `{"a":"${'x'.repeat(4 * 1024 * 1024 - 20)}"}`;
    return JSON.stringify({ ok: true, rows: await readRows(line, 1) });
  }
  if (scenario === 'checksums-max') {
    // The largest file the caps allow: the full entry count, about 234 bytes a line.
    const sha = '0123456789abcdef'.repeat(4);
    const dir = 'd'.repeat(150);
    const lines: string[] = [];
    for (let i = 0; i < MAX_CHECKSUM_ENTRIES; i++) lines.push(`${sha}  media/${dir}/${i}.jpg\n`);
    const bytes = new TextEncoder().encode(lines.join(''));
    if (bytes.byteLength > MAX_CHECKSUMS_BYTES) return JSON.stringify({ ok: false, why: 'fixture over the cap' });
    return JSON.stringify({ ok: true, entries: parseChecksums(bytes).length, bytes: bytes.byteLength });
  }
  if (scenario === 'checksums-over') {
    try {
      parseChecksums(new Uint8Array(12 * 1024 * 1024 + 1)); // the documented cap, written out so a raised constant is caught
      return JSON.stringify({ ok: false });
    } catch (error) {
      return JSON.stringify({ ok: true, code: codeOf(error), message: (error as Error).message });
    }
  }
  return JSON.stringify({ ok: false, why: 'unknown scenario' });
}

main(process.argv[2] ?? '')
  .then((line) => {
    process.stdout.write(`${line}\n`);
  })
  .catch((error: unknown) => {
    process.stdout.write(`${JSON.stringify({ ok: false, code: codeOf(error) })}\n`);
  });
