/**
 * OI #271 conditions 4 and 5 — the recipient is told, in the message that
 * carries the link, in words a tenant cannot delete.
 *
 * `docs/compliance/report-view-lia.md` §3.2: *"Remove the disclosure and this
 * assessment fails."* These tests are the executable form of that sentence, so
 * each one names the condition it holds up rather than the string it matches.
 *
 * The two failure modes they exist to catch are not "the copy changed":
 *
 *  1. **A descriptor quietly loses the block.** Four separate descriptors carry
 *     a report link, in two catalog files, and three of them look nothing like
 *     each other. The list below is asserted against the REGISTRY, so adding a
 *     fifth report-link template and forgetting the disclosure fails here
 *     instead of shipping.
 *  2. **The disclosure degrades into template copy.** The delivery emails are
 *     `editable: true`, and an editable default only seeds a per-tenant row —
 *     it cannot carry a guarantee (condition 5). So the test renders with a
 *     tenant override that blanks every editable block and asserts the notice
 *     survives it.
 */
import { describe, it, expect } from 'vitest';
import { EmailTemplateRenderer, reportDeliverySystemBlocks } from '../../../server/lib/email-templates/renderer';
import { getDescriptor } from '../../../server/lib/email-templates/registry';
import { REPORT_VIEW_DISCLOSURE } from '../../../server/lib/legal/report-view-disclosure';
import type { TemplateBrand, TemplateOverride } from '../../../server/lib/email-templates/types';

/**
 * Every descriptor whose message hands the recipient a report link.
 *
 * There is no single "the report delivery email": `report-ready` and
 * `report-ready-pdf` go to the client, `agent-share-link` is a one-off share,
 * and `agent-report-ready` lives in a different catalog file entirely. The LIA
 * bounds condition 4 to the email path because every report-link notice class
 * declares `channels: ['email']`; if that ever stops being true, the SMS path
 * needs its own answer and this list is where the mismatch will show.
 */
const REPORT_LINK_TRIGGERS = ['report-ready', 'report-ready-pdf', 'agent-share-link', 'agent-report-ready'] as const;

const brand: TemplateBrand = { name: 'Acme Inspections', logoUrl: null, primaryColor: '#123456' };

/**
 * `viewCountingEnabled` defaults to TRUE here because every assertion below is
 * about the workspace the notice is OWED TO — one that turned open-counting on.
 * The workspace that did not is its own describe block at the foot of the file,
 * and it is what makes these assertions discriminating: without it, hiding the
 * notice unconditionally would satisfy that half and fail this one.
 */
function render(
    trigger: string,
    data: Record<string, unknown> = {},
    overrides?: Map<string, TemplateOverride>,
    viewCountingEnabled = true,
) {
    const renderer = new EmailTemplateRenderer({
        tenantBrand: brand,
        platformBrand: brand,
        ...(overrides ? { overrides } : {}),
        viewCountingEnabled,
    });
    return renderer.render(trigger, { address: '1 Main St', agentName: 'Dana', propertyAddress: '1 Main St', reportUrl: 'https://acme.test/report-view/acme/insp-1?token=abc', ...data });
}

describe('OI #271 — the Art. 13 disclosure rides every report-link email', () => {
    it.each(REPORT_LINK_TRIGGERS)('%s declares the viewDisclosure system block', (trigger) => {
        // Declared on the DESCRIPTOR, not merely present in one rendered
        // sample: the descriptor is what a new report-link template gets
        // compared against.
        expect(getDescriptor(trigger)?.systemBlocks).toContain('viewDisclosure');
    });

    it.each(REPORT_LINK_TRIGGERS)('%s declares a reportUrl variable for the exit link to hang on', (trigger) => {
        // The exit link is the report link plus a fragment. A descriptor that
        // carries the block but no `reportUrl` would render the exit as words
        // with nowhere to go — the coupling is executable here rather than
        // stated in a comment nobody re-reads.
        expect(getDescriptor(trigger)?.variables.map((v) => v.name)).toContain('reportUrl');
    });

    it.each(REPORT_LINK_TRIGGERS)('%s states the fact, the limit and the exit, in that order', (trigger) => {
        const { html } = render(trigger);
        const fact = html.indexOf(REPORT_VIEW_DISCLOSURE.fact);
        const limit = html.indexOf(REPORT_VIEW_DISCLOSURE.limit);
        const exit = html.indexOf(REPORT_VIEW_DISCLOSURE.exit);
        expect(fact).toBeGreaterThan(-1);
        // The middle sentence is the one an editor trims for length. It is why
        // the necessity test passes: those things are ABSENT, and a notice that
        // omits them lets the reader assume the ordinary shape of web tracking.
        expect(limit).toBeGreaterThan(fact);
        expect(exit).toBeGreaterThan(limit);
    });

    it('offers the exit as "turn this off and keep your report", never as a dead link', () => {
        const { html } = render('report-ready');
        // Both halves. "Turn this off" alone is satisfied by revoking the link,
        // which is the remedy external review rejected (LIA §4 amendment).
        expect(html).toContain('keep your report');
        expect(html).toContain('https://acme.test/report-view/acme/insp-1?token=abc#view-tracking');
    });

    it('stamps the disclosure version onto the delivered artifact', () => {
        // A later rewording must not retroactively re-caption a document
        // already delivered, and there is no archive of superseded copy — so
        // the version travels with the message that carried it.
        expect(render('report-ready').html).toContain(`data-disclosure-version="${REPORT_VIEW_DISCLOSURE.version}"`);
    });

    it('survives a tenant that blanks every editable block (condition 5)', () => {
        // The whole reason this is a SystemBlockKind. An `editable: true`
        // default only seeds a per-tenant row; a tenant who empties the body
        // must not thereby empty the notice.
        const d = getDescriptor('report-ready')!;
        const blocks = Object.fromEntries(d.blocks.map((b) => [b.key, '']));
        const overrides = new Map<string, TemplateOverride>([
            ['report-ready', { trigger: 'report-ready', subject: '', blocks, enabled: true }],
        ]);
        const { html } = render('report-ready', {}, overrides);
        expect(html).toContain(REPORT_VIEW_DISCLOSURE.fact);
        expect(html).toContain(REPORT_VIEW_DISCLOSURE.limit);
    });

    it('keeps the exit sentence when the message has no report URL', () => {
        // Degrades to words naming the control rather than dropping the
        // sentence: the exit is a condition, not an enhancement.
        const { html } = render('report-ready', { reportUrl: '' });
        expect(html).toContain(REPORT_VIEW_DISCLOSURE.exit);
        expect(html).toContain(REPORT_VIEW_DISCLOSURE.exitLabel);
        expect(html).not.toContain('href="#view-tracking"');
    });

    it('agrees with the report page about which version of the copy this is', async () => {
        // The email carries fixed English platform copy; the page carries the
        // translated catalogue. Different artifacts, deliberately — but a reader
        // who saw one and a reader who saw the other saw the SAME disclosure, so
        // a version that disagreed between them would make the stamp worse than
        // useless. Executable rather than a "keep these in sync" comment.
        const { REPORT_VIEW_DISCLOSURE_VERSION } = await import(
            '../../../app/components/portal/sections/report/report-view-disclosure-version'
        );
        expect(REPORT_VIEW_DISCLOSURE_VERSION).toBe(REPORT_VIEW_DISCLOSURE.version);
    });

    it('does NOT ride a message that carries no report link', () => {
        // `payment-request` is the control: adding the notice everywhere would
        // make it noise, and the LIA only asks for it where a report link is
        // being handed over.
        expect(render('payment-request').html).not.toContain(REPORT_VIEW_DISCLOSURE.fact);
    });
});

/**
 * The claim must not outlive the processing it describes.
 *
 * `tenant_configs.is_report_view_counting_enabled` defaults to FALSE and is the
 * first thing `shouldCountReportView` checks, so in a workspace that never opted
 * in NOTHING is recorded when a report is opened. The delivery email said
 * otherwise to every one of them — stating, in the message that hands over the
 * report, that opens are recorded, when, and how many times. Safer than
 * understating the design, but not true, and not checkable by the one person it
 * is addressed to.
 */
describe('a workspace that does not count opens makes no claim that it does', () => {
    it.each(REPORT_LINK_TRIGGERS)('%s carries no recording claim when counting is off', (trigger) => {
        const { html } = render(trigger, {}, undefined, /* viewCountingEnabled */ false);
        expect(html).not.toContain(REPORT_VIEW_DISCLOSURE.fact);
        // The heading alone would still announce a measurement, and the version
        // stamp would attest to a disclosure nobody was given.
        expect(html).not.toContain(REPORT_VIEW_DISCLOSURE.heading);
        expect(html).not.toContain('data-disclosure-version');
    });

    it('still renders the rest of the message', () => {
        // The block goes, the email does not. A notice suppressed by hiding the
        // report link would be a different and worse bug.
        const { html } = render('report-ready', {}, undefined, false);
        expect(html).toContain('1 Main St');
        expect(html).toContain('https://acme.test/report-view/acme/insp-1?token=abc');
    });

    it('reaches the same verdict on the rule-authored path, which renders no descriptor', () => {
        // An automation rule supplying its own copy never goes through
        // `render()`, so the two painters have to agree: this is the path the
        // cron flush uses for a published report.
        const url = 'https://acme.test/report-view/acme/insp-1?token=abc';
        const off = reportDeliverySystemBlocks({ reportUrl: url, hasAttachment: true, viewCountingEnabled: false });
        expect(off).not.toContain(REPORT_VIEW_DISCLOSURE.fact);
        // The attachment manifest is a different block about a different fact,
        // and it must survive — otherwise this reads as "turn counting off and
        // lose the sentence saying the PDF is attached".
        expect(off).toContain('attached to this email');

        const on = reportDeliverySystemBlocks({ reportUrl: url, hasAttachment: true, viewCountingEnabled: true });
        expect(on).toContain(REPORT_VIEW_DISCLOSURE.fact);
        expect(on).toContain(REPORT_VIEW_DISCLOSURE.limit);
        expect(on).toContain(REPORT_VIEW_DISCLOSURE.exit);
    });
});
