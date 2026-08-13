/**
 * The /setup seeder and AUTOMATION_SEEDS are ONE list, asserted rather than
 * asked-for.
 *
 * `standalone-seed-automations.ts` used to keep its own copy of the rules under
 * a comment saying "keep these rows semantically in sync with AUTOMATION_SEEDS".
 * They drifted: six rules carried a different NAME on each side, and because
 * `ensureSeeds` dedupes on (name, trigger) it seeded every one of them a second
 * time under the other name the first time it ran on a standalone tenant. Two
 * active rules on one trigger is a client receiving the same email twice.
 *
 * The copy is gone — the seeder now derives its rows from AUTOMATION_SEEDS — so
 * this spec's job is to make the DERIVATION observable: it runs the real seeder
 * against a recording D1 stub and compares what it would have written, field by
 * field, against the seed list. Re-introducing a private row list here fails.
 *
 * It lives in the fast unit suite deliberately. `tests/workers/` covers the same
 * property end-to-end against real D1, but that suite is a later rung; the drift
 * this guards against is a source edit, and a source edit should be caught by
 * the check that runs first.
 */
import { describe, it, expect } from 'vitest';
import { AUTOMATION_SEEDS } from '../../../server/data/automation-seeds';
import { seedDefaultAutomations } from '../../../server/lib/integration/standalone-seed-automations';

const TENANT = '00000000-0000-0000-0000-000000000001';

interface Recorded { sql: string; binds: unknown[] }

/**
 * A D1 stub that records instead of executing. `prepare().bind()` returns the
 * statement object the seeder hands to `batch()`, which is exactly the shape
 * the real binding uses, so nothing about the seeder changes for the test.
 *
 * It never throws — which matters, because the seeder logs and CONTINUES on a
 * per-row error. A stub that threw would produce an empty recording and every
 * "set equals set" assertion below would pass on two empty sets. The statement
 * COUNT is asserted alongside them for that reason.
 */
function recordingD1(): { db: D1Database; recorded: Recorded[] } {
    const recorded: Recorded[] = [];
    const db = {
        prepare: (sql: string) => ({
            bind: (...binds: unknown[]) => ({ sql, binds }),
        }),
        batch: async (stmts: Recorded[]) => { recorded.push(...stmts); return []; },
    } as unknown as D1Database;
    return { db, recorded };
}

/** Bind order of the automations INSERT in standalone-seed-automations.ts. */
const AUTOMATION_BINDS = [
    'tenantId', 'trigger', 'recipientKind',
    'guardTenantId', 'roleKey',
    'name', 'delayMinutes', 'emailTemplateId', 'active', 'channels', 'smsTemplateId',
] as const;

function readAutomationRow(binds: unknown[]): Record<string, unknown> {
    return Object.fromEntries(AUTOMATION_BINDS.map((k, i) => [k, binds[i]]));
}

describe('standalone /setup seeder writes exactly AUTOMATION_SEEDS', () => {
    const { db, recorded } = recordingD1();
    const ran = seedDefaultAutomations(db, TENANT);

    const automationRows = async () => {
        await ran;
        return recorded
            .filter((s) => /INSERT INTO automations/.test(s.sql))
            .map((s) => readAutomationRow(s.binds));
    };
    const templateRows = async () => {
        await ran;
        return recorded
            .filter((s) => /INSERT INTO message_templates/.test(s.sql))
            .map((s) => ({ name: String(s.binds[2]), channel: /'sms'/.test(s.sql) ? 'sms' : 'email' }));
    };

    it('writes one automations row per seed — no extras, no omissions, no duplicates', async () => {
        const rows = await automationRows();
        // Both numbers, side by side: a recording that captured nothing would
        // otherwise make every set comparison below pass vacuously.
        expect(
            rows.length,
            `recorded ${rows.length} automations INSERT(s) for ${AUTOMATION_SEEDS.length} seed(s)`,
        ).toBe(AUTOMATION_SEEDS.length);

        const written = rows.map((r) => `${r.trigger}::${r.name}`).sort();
        const seeded = AUTOMATION_SEEDS.map((s) => `${s.trigger}::${s.name}`).sort();
        expect(written).toEqual(seeded);
    });

    it('gives every seed a unique (trigger, name) — the identity BOTH seed paths dedupe on', () => {
        // ensureSeeds diffs on this pair and so does the seeder's WHERE NOT
        // EXISTS guard. Two seeds sharing it would make one of them permanently
        // unseedable, and `automation-classes.ts` keys on it too.
        const keys = AUTOMATION_SEEDS.map((s) => `${s.trigger}::${s.name}`);
        const dupes = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
        expect(dupes, `${keys.length} seed(s), ${new Set(keys).size} distinct`).toEqual([]);
    });

    it('carries each seed\'s recipient, delay, channels and default-active state unchanged', async () => {
        const rows = await automationRows();
        const byKey = new Map(rows.map((r) => [`${r.trigger}::${r.name}`, r]));
        const wrong: string[] = [];
        for (const raw of AUTOMATION_SEEDS) {
            const s = raw as unknown as {
                name: string; trigger: string; recipientKind: string;
                recipientRoleKey?: string | null; delayMinutes: number;
                channels?: readonly string[]; defaultActive?: boolean;
            };
            const key = `${s.trigger}::${s.name}`;
            const row = byKey.get(key);
            if (!row) { wrong.push(`${key}: not written`); continue; }
            const expected = {
                recipientKind: s.recipientKind,
                roleKey:       s.recipientKind === 'role' ? (s.recipientRoleKey ?? null) : null,
                delayMinutes:  s.delayMinutes,
                channels:      JSON.stringify(s.channels ? [...s.channels] : ['email']),
                active:        s.defaultActive === false ? 0 : 1,
            };
            const actual = {
                recipientKind: row.recipientKind, roleKey: row.roleKey,
                delayMinutes: row.delayMinutes, channels: row.channels, active: row.active,
            };
            if (JSON.stringify(actual) !== JSON.stringify(expected)) {
                wrong.push(`${key}: wrote ${JSON.stringify(actual)}, seed says ${JSON.stringify(expected)}`);
            }
        }
        expect(wrong).toEqual([]);
    });

    it('creates a template only for a channel the rule actually carries', async () => {
        // The rule `message-template-backfill.ts` states and this seeder used to
        // break: a template row for a channel the rule does not have is a row in
        // the operator's library that nothing can ever send. It created an SMS
        // template for every seed with an `smsBody`, ignoring `channels` — and
        // no seed declares an sms channel, so every one of those was unsendable.
        const templates = await templateRows();
        const wrong: string[] = [];
        for (const raw of AUTOMATION_SEEDS) {
            const s = raw as unknown as { name: string; smsBody?: string; channels?: readonly string[] };
            const channels = s.channels ? [...s.channels] : ['email'];
            for (const channel of ['email', 'sms']) {
                const want = channels.includes(channel) && (channel === 'email' || !!s.smsBody?.trim());
                const got = templates.some((t) => t.channel === channel && t.name === `${s.name} — ${channel === 'sms' ? 'SMS' : 'Email'}`);
                if (want !== got) wrong.push(`${s.name}: ${channel} template ${got ? 'created' : 'missing'}, channels=${JSON.stringify(channels)}`);
            }
        }
        expect(wrong).toEqual([]);
        // No seed declares sms today, so the correct count is zero — stated as a
        // number rather than left implied, so the day one does, this line is
        // what a reader updates on purpose.
        expect(templates.filter((t) => t.channel === 'sms')).toEqual([]);
        expect(templates.filter((t) => t.channel === 'email').length).toBeGreaterThan(0);
    });
});
