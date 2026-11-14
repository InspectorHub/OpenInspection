import { describe, it, expect, vi } from 'vitest';
import { interpolate, interpolateHtml } from '../../../server/services/automation/shared';
import {
    interpolate as coreInterpolate, interpolateHtml as coreInterpolateHtml,
} from '../../../server/lib/automation-core/interpolate';
import { deliverAction } from '../../../server/lib/automation-core';

const impls: Array<[string, (t: string, v: Record<string, string>) => string]> = [
    ['services', interpolateHtml],
    ['automation-core', coreInterpolateHtml],
];

describe.each(impls)('interpolateHtml (%s)', (_name, fn) => {
    it('escapes markup inside substituted values', () => {
        expect(fn('<p>Hi {{n}}</p>', { n: '<img src=x onerror=1>' })).toBe('<p>Hi &lt;img src=x onerror=1&gt;</p>');
        expect(fn('{{n}}', { n: '<b>Bold</b> & "q" \'s\'' })).toBe('&lt;b&gt;Bold&lt;/b&gt; &amp; &quot;q&quot; &#39;s&#39;');
    });

    it('leaves the template author markup untouched', () => {
        expect(fn('<p class="a">x &amp; y</p>', {})).toBe('<p class="a">x &amp; y</p>');
    });

    it('renders a missing key as empty, like interpolate', () => {
        expect(fn('a{{missing}}b', {})).toBe('ab');
    });

    it('keeps a URL value usable inside an href', () => {
        expect(fn('<a href="{{u}}">x</a>', { u: 'https://a.test/p?x=1&y=2' }))
            .toBe('<a href="https://a.test/p?x=1&amp;y=2">x</a>');
    });
});

describe('plain interpolate is unchanged (subjects and SMS)', () => {
    it.each([['services', interpolate], ['automation-core', coreInterpolate]] as const)('%s', (_n, fn) => {
        expect(fn("{{n}}", { n: "O'Brien & AT&T <b>" })).toBe("O'Brien & AT&T <b>");
    });
});

describe('deliverAction escapes by channel', () => {
    async function run(channel: 'email' | 'sms') {
        const sendEmail = vi.fn().mockResolvedValue({ ok: true });
        const sendSms = vi.fn().mockResolvedValue({ ok: true });
        await deliverAction({
            tenantId: 't', logId: 'l', to: 'x', action: { channel, templateId: 'tpl' },
            vars: { n: "O'Brien <b>" }, requiredVars: {},
            deps: {
                templates: { resolve: async () => ({ channel, subject: 'S {{n}}', body: '<p>{{n}}</p>', variables: [] }) },
                transport: { sendEmail, sendSms },
                logger: { record: async () => {} },
                clock: { nowMs: () => 0 },
            },
        } as never);
        return { sendEmail, sendSms };
    }
    it('email: body escaped, subject not', async () => {
        const { sendEmail } = await run('email');
        const arg = sendEmail.mock.calls[0]![0] as { subject: string; html: string };
        expect(arg.html).toBe('<p>O&#39;Brien &lt;b&gt;</p>');
        expect(arg.subject).toBe("S O'Brien <b>");
    });
    it('sms: body not escaped', async () => {
        const { sendSms } = await run('sms');
        expect((sendSms.mock.calls[0]![0] as { body: string }).body).toBe("<p>O'Brien <b></p>");
    });
});
