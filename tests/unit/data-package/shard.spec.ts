import { describe, expect, it } from 'vitest';
import { classifyPackageEntry } from '../../../server/lib/data-package/volume';
import { dataFileName, emptyDataFile, isTableName, parseDataFileName, ShardCutter } from '../../../server/lib/data-package/shard';
import { prng } from './helpers';

describe('data file names', () => {
  it('round-trips, and shard 1 has no number', () => {
    expect(dataFileName('users', 1)).toBe('data/users.ndjson');
    expect(dataFileName('users', 2)).toBe('data/users.2.ndjson');
    for (const shard of [1, 2, 9, 10, 999_999]) {
      expect(parseDataFileName(dataFileName('inspection_results', shard))).toEqual({ table: 'inspection_results', shard });
    }
  });

  it('rejects look-alikes', () => {
    for (const bad of ['data/users.1.ndjson', 'data/users.0.ndjson', 'data/users.02.ndjson', 'data/Users.ndjson', 'data/users.ndjson.gz', 'data/a/b.ndjson', 'data/_x.ndjson', 'data/users.2.3.ndjson', 'data/users.1000000.ndjson', 'x/users.ndjson'])
      expect(parseDataFileName(bad), bad).toBeNull();
    expect(() => dataFileName('Users', 1)).toThrowError(expect.objectContaining({ code: 'entry_name_invalid' }));
    expect(() => dataFileName('users', 0)).toThrowError(expect.objectContaining({ code: 'entry_name_invalid' }));
    expect(isTableName('__proto__')).toBe(false);
    expect(isTableName('a'.repeat(65))).toBe(false);
  });
});

describe('ShardCutter', () => {
  it('cuts before the row that would exceed either limit and keeps every row (generated)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rand = prng(seed);
      const limits = { maxRows: 1 + Math.floor(rand() * 30), maxBytes: 200 + Math.floor(rand() * 5000) };
      const cutter = new ShardCutter('things', limits);
      const shards = new Map<number, { rows: number; bytes: number }>();
      let last = 0;
      let rows = 0;
      for (let i = 0; i < 300; i++) {
        const bytes = 1 + Math.floor(rand() * 150);
        const placed = cutter.place(bytes);
        expect(placed.opensShard).toBe(placed.shard !== last);
        expect(placed.shard - last).toBeLessThanOrEqual(1);
        last = placed.shard;
        expect(placed.path).toBe(dataFileName('things', placed.shard));
        const s = shards.get(placed.shard) ?? { rows: 0, bytes: 0 };
        s.rows += 1;
        s.bytes += bytes;
        shards.set(placed.shard, s);
        rows += 1;
      }
      let total = 0;
      for (const s of shards.values()) {
        total += s.rows;
        expect(s.rows).toBeLessThanOrEqual(limits.maxRows);
        expect(s.bytes).toBeLessThanOrEqual(limits.maxBytes);
      }
      expect(total).toBe(rows);
      expect([...shards.keys()]).toEqual(Array.from({ length: shards.size }, (_, i) => i + 1));
    }
  });

  it('gives a single oversized row a shard of its own instead of dropping it', () => {
    const cutter = new ShardCutter('things', { maxRows: 10, maxBytes: 100 });
    expect(cutter.place(500)).toMatchObject({ shard: 1, opensShard: true });
    expect(cutter.place(10)).toMatchObject({ shard: 2, opensShard: true });
  });

  it('refuses bad limits, names and sizes', () => {
    expect(() => new ShardCutter('Bad', { maxRows: 1, maxBytes: 1 })).toThrowError(expect.objectContaining({ code: 'entry_name_invalid' }));
    expect(() => new ShardCutter('ok', { maxRows: 0, maxBytes: 1 })).toThrowError(expect.objectContaining({ code: 'limit_invalid' }));
    expect(() => new ShardCutter('ok', { maxRows: 1, maxBytes: 1 }).place(0)).toThrowError(expect.objectContaining({ code: 'limit_invalid' }));
  });
});

describe('device-name tables and empty tables', () => {
  const devices = ['con', 'prn', 'aux', 'nul', 'com1', 'com9', 'lpt1', 'lpt9', 'CON'.toLowerCase()];

  it('a table named like a Windows device can never get a data file name the manifest would refuse', () => {
    for (const table of devices) {
      expect(isTableName(table), table).toBe(false);
      expect(() => dataFileName(table, 1), table).toThrowError(expect.objectContaining({ code: 'entry_name_invalid' }));
      expect(() => new ShardCutter(table, { maxRows: 1, maxBytes: 1 }), table).toThrowError(expect.objectContaining({ code: 'entry_name_invalid' }));
      expect(classifyPackageEntry(`data/${table}.ndjson`), table).toBeNull();
    }
  });

  it('every file name dataFileName produces is a name classifyPackageEntry accepts as data (generated)', () => {
    for (const table of ['users', 'inspection_results', 'a', 'x1', 'console', 'comment', 'lpt', 'com10', 'auxiliary']) {
      for (const shard of [1, 2, 10, 999_999]) expect(classifyPackageEntry(dataFileName(table, shard)), `${table} ${shard}`).toBe('data');
    }
  });

  it('a zero-row table has a defined empty shard entry (rows 0, bytes 0) the manifest accepts', () => {
    expect(emptyDataFile('users')).toEqual({ path: 'data/users.ndjson', rows: 0, bytes: 0 });
    expect(() => emptyDataFile('con')).toThrowError(expect.objectContaining({ code: 'entry_name_invalid' }));
  });
});
