import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'path';

// Apply migrations 0000..0029 (pre-fold), seed legacy rows, then apply 0030 and assert.
function applyUpto(sqlite: Database.Database, stopBefore: string) {
  const dir = path.resolve(__dirname, '../../migrations');
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.sql')) continue;
    if (f >= stopBefore) break;
    sqlite.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
}
function applyOne(sqlite: Database.Database, file: string) {
  const dir = path.resolve(__dirname, '../../migrations');
  sqlite.exec(fs.readFileSync(path.join(dir, file), 'utf8'));
}

describe('0030 comments-repair fold migration', () => {
  it('copies recommendations into comments (id-reuse), seeds contractor_types, drops recommendations', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = OFF');
    applyUpto(sqlite, '0030');

    // Seed a tenant + one recommendation (pre-fold schema).
    sqlite.exec(`INSERT INTO tenants (id,name,slug,tier,status,max_users,deployment_mode,applied_cmd_seq,applied_cred_seq,created_at) VALUES ('t1','T','t1','free','active',5,'shared',0,0,0);`);
    sqlite.exec(`INSERT INTO recommendations (id,tenant_id,category,name,severity,default_estimate_min,default_estimate_max,default_repair_summary,created_by_user_id,created_at) VALUES ('rec1','t1','Roof','Replace shingles','defect',50000,120000,'Replace damaged shingles',NULL,0);`);

    applyOne(sqlite, '0030_comments_repair_fold.sql');

    // recommendations table is gone
    const tbl = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='recommendations'").get();
    expect(tbl).toBeUndefined();

    // comment row created with the reused id + repair fields
    const c = sqlite.prepare("SELECT * FROM comments WHERE id='rec1'").get() as Record<string, unknown>;
    expect(c.text).toBe('Replace shingles');
    expect(c.rating_bucket).toBe('defect');
    expect(c.repair_summary).toBe('Replace damaged shingles');
    expect(c.estimate_min_cents).toBe(50000);
    expect(c.estimate_max_cents).toBe(120000);

    // contractor_types seeded for the tenant
    const n = sqlite.prepare("SELECT COUNT(*) AS n FROM contractor_types WHERE tenant_id='t1'").get() as { n: number };
    expect(n.n).toBe(10);
  });
});
