/**
 * What a notice SAYS, in the language its reader reads.
 *
 * Extracted from the trigger mixin for the file-size ratchet, and it earns the
 * split: everything here is about wording — the tenant's own in-app template
 * when a rule references one, the built-in titles when it does not — while the
 * trigger is about which rows to write.
 */
import { interpolate } from './shared';
import { m } from '../../lib/i18n/messages';
import type { NoticeWording } from './notice-headers';
import type { TemplateStore } from './template-store';
import type { ContactLocale } from '../../lib/i18n/contact-locale';
import type { automations, inspections } from '../../lib/db/schema';

/**
 * The title STORED on a notice when a rule's template has no subject, or
 * resolves to no template at all. Staff/ledger voice with the address —
 * distinct from the recipient-voiced `notice_title_*` family that
 * `app/lib/notice-view.ts` renders for types it recognises, which is why these
 * carry the `comm_` prefix (same split as `comm_reason_sms_opt_out` vs
 * `notice_reason_sms_opt_out`).
 *
 * `locale` is REQUIRED and names the RECIPIENT. Paraglide's message functions
 * default to `getLocale()` when no locale option is passed, and in this path
 * that is always wrong: a trigger fires from another user's request, from cron,
 * or from a queue consumer, so the ambient answer describes either the wrong
 * person or nobody. Making the parameter mandatory is the guard — an ambient
 * read here would be a silent mistranslation, not a type error, so the type
 * system is asked to make it one.
 */
function noticeTitleFor(
    event: string,
    insp: typeof inspections.$inferSelect,
    locale: ContactLocale,
): string {
    const address = insp.propertyAddress || 'inspection';
    const at = { locale };
    switch (event) {
        case 'inspection.created':   return m.comm_notice_title_inspection_created({ address }, at);
        case 'inspection.confirmed': return m.comm_notice_title_inspection_confirmed({ address }, at);
        case 'inspection.cancelled': return m.comm_notice_title_inspection_cancelled({ address }, at);
        case 'report.published':     return m.comm_notice_title_report_published({ address }, at);
        case 'invoice.created':      return m.comm_notice_title_invoice_created({ address }, at);
        case 'payment.received':     return m.comm_notice_title_payment_received({ address }, at);
        // Deliberately kept: a trigger can be added to the enum before a
        // template exists for it, and a readable "<event> — <address>" beats an
        // empty notice title. It is now translatable too.
        default:                     return m.comm_notice_title_generic({ event, address }, at);
    }
}

/**
 * B3 (IA-115) — one firing's wording resolver. The wording comes from each
 * rule's in-app template when it has one, memoized so a rule fanning out to
 * eight staff does not re-read the same template eight times.
 *
 * The memo is keyed by (rule, LOCALE), not by rule: one firing can reach an
 * English agent and a Spanish client, so a key without the language would hand
 * the first recipient's wording to everyone — exactly the bug this whole change
 * exists to remove, just relocated into a cache.
 */
export function createNoticeWordingResolver(args: {
    store: TemplateStore;
    tenantId: string;
    triggerEvent: string;
    companyName: string;
    inspection: typeof inspections.$inferSelect;
    rules: Array<typeof automations.$inferSelect>;
}): (automationId: string | null, locale: ContactLocale) => Promise<NoticeWording> {
    const { store, tenantId, triggerEvent, companyName, inspection, rules } = args;
    const cache = new Map<string, NoticeWording>();
    const ruleById = new Map(rules.map((r) => [r.id, r]));
    const vars = {
        property_address: inspection.propertyAddress || 'inspection',
        company_name: companyName,
        scheduled_date: inspection.date ?? '',
    };

    return async (automationId, locale) => {
        const key = `${automationId ?? ''}:${locale}`;
        const hit = cache.get(key);
        if (hit) return hit;
        const rule = automationId ? ruleById.get(automationId) : undefined;
        // The recipient's own language picks the variant; a tenant with no
        // variant in it keeps getting the English row, which is the whole
        // degrade-never-block contract (message-template.service#resolveForLocale).
        const tpl = rule?.inAppTemplateId
            ? await store.resolve(tenantId, rule.inAppTemplateId, locale)
            : null;
        const wording: NoticeWording = tpl && tpl.channel === 'in_app'
            ? {
                title: interpolate(tpl.subject ?? '', vars) || noticeTitleFor(triggerEvent, inspection, locale),
                body: tpl.body ? interpolate(tpl.body, vars) : null,
            }
            : { title: noticeTitleFor(triggerEvent, inspection, locale), body: null };
        cache.set(key, wording);
        return wording;
    };
}
