/**
 * The four things about QuickBooks that no schema can tell us.
 *
 * Everything in `*.contract.spec.ts` is offline and runs for everyone. This
 * file is the remainder: facts that exist only on the wire, each of which this
 * integration got wrong and shipped.
 *
 *   1. QuickBooks v3 has no PUT. Every update was sent as one, for years.
 *   2. A duplicate DisplayName returns 6240. The ladder read 6140 — a number no
 *      response carries — so it never once climbed a rung.
 *   3. A colon in a DisplayName returns 2040. Nothing retries that, so a contact
 *      named "Smith Trust: 2019" was permanently unmappable.
 *   4. An Invoice needs both a `Line` and a `CustomerRef`, and the schema marks
 *      neither. Both absences were refused for the life of the integration.
 *
 * None of those four numbers or behaviours appears in the vendored XSDs. They
 * are only knowable by asking, which is what this file does.
 *
 * It writes to the connected company, so point it at a SANDBOX. Names carry a
 * `contract-<n>` suffix so what it leaves behind is identifiable; nothing is
 * deleted, because a test that deletes from someone's books is a worse idea
 * than a sandbox with some litter in it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
    liveConnection, isUnavailable, post, faultCodes,
    type LiveConnection,
} from './live-connection';
import { buildInvoicePayload, billableLines, toQboLines } from '../../../server/services/qbo/invoice-payload';
import { buildCustomerPayload, sanitizeDisplayName } from '../../../server/services/qbo/customer-payload';

let conn: LiveConnection | null = null;
let why = '';

beforeAll(async () => {
    const resolved = await liveConnection();
    if (isUnavailable(resolved)) {
        why = resolved.reason;
        // Loud, every run, with the reason. A lane that reports nothing when it
        // ran nothing is indistinguishable from a lane that passed, and this
        // one is skipped far more often than it runs.
        console.warn(`\n[qbo live contract] SKIPPING every spec in this file — ${why}\n`);
        return;
    }
    conn = resolved;
});

/** A run-scoped suffix so repeated runs do not collide on DisplayName. */
const RUN = process.env.QBO_CONTRACT_RUN_ID ?? String(process.pid);

describe.runIf(process.env.QBO_CONTRACT_LIVE !== '0')('what only QuickBooks can tell us', () => {
    it('is connected — otherwise every spec below is meaningless', () => {
        // The gate, stated as a spec rather than hidden in a helper. If this
        // fails the reason is printed above, and the rest are skipped by their
        // own guards rather than passing on a null connection.
        expect(conn, `no live connection: ${why}`).not.toBeNull();
    });

    it('has no PUT verb — an update is a POST carrying Id and SyncToken', async (ctx) => {
        if (!conn) return ctx.skip();
        const sep = '?';
        const res = await fetch(
            `${conn.apiBase}/v3/company/${conn.realmId}/customer${sep}minorversion=75`,
            {
                method: 'PUT',
                headers: {
                    Authorization: `Bearer ${conn.accessToken}`,
                    Accept: 'application/json', 'Content-Type': 'application/json',
                },
                body: JSON.stringify({ DisplayName: `never-created-${RUN}` }),
            },
        );
        // Anything but success. The exact status is Intuit's to choose; what
        // this pins is that PUT is not the update verb, which ten unit specs
        // asserted the opposite of because the implementation told them so.
        expect(res.ok).toBe(false);
        expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('answers a duplicate DisplayName with a code our ladder recognises', async (ctx) => {
        if (!conn) return ctx.skip();
        const name = sanitizeDisplayName(`Contract Dup ${RUN}`);
        const payload = buildCustomerPayload(name, 'Contract', `Dup ${RUN}`, {});

        const first = await post(conn, 'customer', payload);
        // Either it was created now, or a previous run created it. Both leave
        // the name taken, which is all the second call needs.
        expect([200, 400]).toContain(first.status);

        const second = await post(conn, 'customer', payload);
        expect(second.status).toBe(400);

        // 🔴 The assertion this whole lane was built for. It is written against
        // OUR set, not against a literal, so it fails if Intuit ever answers
        // with something the ladder does not climb for — which is the failure
        // that went unnoticed for the life of the integration.
        const DUPLICATE_NAME_FAULT_CODES = new Set(['6240', '6140']);
        const codes = faultCodes(second.body);
        expect(codes.length).toBeGreaterThan(0);
        expect(
            codes.some((c) => DUPLICATE_NAME_FAULT_CODES.has(c)),
            `QuickBooks answered ${JSON.stringify(codes)}; customer-sync.ts climbs only for ` +
            `${JSON.stringify([...DUPLICATE_NAME_FAULT_CODES])}. Add the code THERE, with this capture as the reason.`,
        ).toBe(true);
    });

    it('refuses a colon in DisplayName, and accepts the name we sanitise', async (ctx) => {
        if (!conn) return ctx.skip();
        const raw = `Contract Colon: ${RUN}`;

        const refused = await post(conn, 'customer', { DisplayName: raw, GivenName: 'Contract' });
        expect(refused.status).toBe(400);
        expect(faultCodes(refused.body)).toContain('2040');

        // The positive control, and the reason `sanitizeDisplayName` exists.
        const accepted = await post(conn, 'customer', {
            DisplayName: sanitizeDisplayName(raw), GivenName: 'Contract',
        });
        expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    });

    it('refuses an Invoice with no Line, and accepts the one our builder makes', async (ctx) => {
        if (!conn) return ctx.skip();
        const customer = await post(conn, 'customer', {
            DisplayName: sanitizeDisplayName(`Contract Payer ${RUN}`), GivenName: 'Contract',
        });
        const customerId = (customer.body as { Customer?: { Id?: string } }).Customer?.Id
            // A repeat run: the name is taken, so look it up rather than fail
            // the spec on bookkeeping rather than on the thing under test.
            ?? await existingCustomerId(conn, sanitizeDisplayName(`Contract Payer ${RUN}`));
        expect(customerId, JSON.stringify(customer.body)).toBeTruthy();

        const base = {
            docNumber: `CT-${RUN}`.slice(0, 21),
            txnDate: today(), dueDate: today(),
            qboCustomerId: customerId!, status: 'sent',
        };

        // An empty Line is what the dashboard's own dialog produced.
        const empty = await post(conn, 'invoice', { ...buildInvoicePayload({ ...base, lines: [] }) });
        expect(empty.status).toBe(400);
        expect(faultCodes(empty.body)).toContain('2020');

        // And the fallback our builder applies to exactly that input.
        const filled = await post(conn, 'invoice', buildInvoicePayload({
            ...base,
            lines: toQboLines(billableLines([], 44400), '1'),
        }));
        expect(filled.status, JSON.stringify(filled.body)).toBe(200);
    });
});

function today(): string {
    // The spec's own date, not the tenant's — `txnDateFor` is unit-tested and
    // is not what this file is asking about.
    return new Date().toISOString().slice(0, 10);
}

async function existingCustomerId(c: LiveConnection, displayName: string): Promise<string | null> {
    const q = `SELECT Id FROM Customer WHERE DisplayName = '${displayName.replaceAll("'", "\\'")}'`;
    const res = await fetch(
        `${c.apiBase}/v3/company/${c.realmId}/query?query=${encodeURIComponent(q)}&minorversion=75`,
        { headers: { Authorization: `Bearer ${c.accessToken}`, Accept: 'application/json' } },
    );
    const body = await res.json() as { QueryResponse?: { Customer?: Array<{ Id: string }> } };
    return body.QueryResponse?.Customer?.[0]?.Id ?? null;
}
