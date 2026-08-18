/**
 * Who sent it, and on whose behalf — two questions, both recorded.
 *
 * Counsel round 26-5: the number's owner is not automatically the legal sender.
 * In the default mode a message leaves OUR shared number carrying the TENANT's
 * brand, so "who initiated this" and "on whose behalf was it sent" have
 * different answers, and neither should have to be reconstructed from the
 * database months later by inferring it from `sms_mode`.
 *
 * The naming here is deliberate and is not a style choice.
 * `server/lib/email/sender-identity.ts` already exports `resolveSenderIdentity`
 * with a different signature and a different return type. Two exports of the
 * same name in sibling domain folders are distinguishable only by their import
 * path — which is the one thing a reader does not see in a diff of the call
 * site. So the SMS side is `resolveSmsSenderIdentity` returning
 * `SmsSenderIdentity`, and the email side is left alone: it is shipped, it has
 * its own spec, and renaming a live export to make room for a new one bills the
 * cost to the wrong side.
 */
import { describe, it, expect } from 'vitest';
import { resolveSmsSenderIdentity, PLATFORM_SENDER } from '../../../server/lib/sms/sender-identity';

const TENANT = '00000000-0000-0000-0000-0000000000c1';

describe('resolveSmsSenderIdentity', () => {
    it('records both roles for a platform-mode send', () => {
        const id = resolveSmsSenderIdentity(
            { smsMode: 'platform', companyName: 'Acme Inspections' }, TENANT,
        );
        expect(id.platformSender).toBe(PLATFORM_SENDER);
        expect(id.tenantOnWhoseBehalf).toBe(TENANT);
        expect(id.tenantBrand).toBe('Acme Inspections');
        expect(id.smsMode).toBe('platform');
    });

    it('a BYO-mode send still names both — the tenant sends, we still built the path', () => {
        const id = resolveSmsSenderIdentity(
            { smsMode: 'own', companyName: 'Acme Inspections' }, TENANT,
        );
        expect(id.platformSender).toBe(PLATFORM_SENDER);
        expect(id.tenantOnWhoseBehalf).toBe(TENANT);
        expect(id.smsMode).toBe('own');
    });

    it('names both for every mode the column can hold', () => {
        // The point of the record is that it never has to be inferred from
        // sms_mode. A resolver that answered for two of four modes would push a
        // future reader straight back to inferring the other two.
        for (const smsMode of ['platform', 'own', 'managed_shared', 'managed_dedicated'] as const) {
            const id = resolveSmsSenderIdentity({ smsMode, companyName: 'Acme' }, TENANT);
            expect(id.platformSender, smsMode).toBe(PLATFORM_SENDER);
            expect(id.tenantOnWhoseBehalf, smsMode).toBe(TENANT);
            expect(id.smsMode, smsMode).toBe(smsMode);
        }
    });

    it('a tenant with no company name yields null brand, not a fabricated one', () => {
        // A brand is a name a company chose. Falling back to the platform name,
        // or to a slug, would put a name on a message that its recipient has
        // never seen the company use — the same defect class as deriving a
        // person's name from their email address.
        const id = resolveSmsSenderIdentity({ smsMode: 'platform', companyName: null }, TENANT);
        expect(id.tenantBrand).toBeNull();
        expect(id.platformSender).toBe(PLATFORM_SENDER);
        expect(id.tenantOnWhoseBehalf).toBe(TENANT);
    });

    it('an empty or whitespace company name is treated as absent', () => {
        for (const companyName of ['', '   ']) {
            expect(resolveSmsSenderIdentity({ smsMode: 'platform', companyName }, TENANT).tenantBrand)
                .toBeNull();
        }
    });

    it('never reports the tenant as the platform sender, in any mode', () => {
        // The failure this guards is the tempting simplification: "in BYO mode
        // the tenant IS the sender, so report them". They are not. We chose the
        // provider, we wrote the template, we operate the gate — a BYO key
        // changes whose account is billed, not who built the path. Collapsing
        // the two roles is exactly what counsel said not to do.
        for (const smsMode of ['own', 'managed_dedicated'] as const) {
            const id = resolveSmsSenderIdentity({ smsMode, companyName: 'Acme' }, TENANT);
            expect(id.platformSender).not.toBe(TENANT);
            expect(id.platformSender).not.toBe('Acme');
        }
    });
});
