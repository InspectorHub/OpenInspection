/**
 * The template editor's Preview and Test send render against sample values.
 *
 * Both used to interpolate against an empty map, so every placeholder in the
 * rendered output came back blank. Production sends do not go through these
 * routes and are untouched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import { STANDALONE_PROFILE } from '../../../server/lib/deployment-profile';
import { lazyD1 } from '../helpers/d1-binding';
import { makeExecutionContext } from '../helpers/exec-ctx';
import {
    AUTOMATION_VARIABLES, AUTOMATION_VARIABLE_SAMPLES,
} from '../../../server/services/automation/variable-catalogue';

const testD1 = lazyD1();

// eslint-disable-next-line import/order
import messageTemplateRoutes from '../../../server/api/message-templates';
import * as resolveTwilioModule from '../../../server/lib/sms/resolve-twilio';
import * as buildEmailModule from '../../../server/lib/email/build-email-service';

const TENANT = '00000000-0000-0000-0000-0000000000f4';
const ENV = { DB: testD1.binding, JWT_SECRET: 'test-secret' } as unknown as HonoConfig['Bindings'];
const EXEC_CTX = makeExecutionContext().ctx;

let db: BetterSQLite3Database<typeof schema>;
let sqlite: { close: () => void };

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('tenantId', TENANT);
        c.set('userRole', 'owner');
        c.set('user', { sub: 'user-1', role: 'owner', tenantId: TENANT } as never);
        c.set('profile', STANDALONE_PROFILE);
        await next();
    });
    app.route('/api/message-templates', messageTemplateRoutes);
    return app;
}

function post(path: string, json: Record<string, unknown>) {
    return buildApp().request(`/api/message-templates/${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json),
    }, ENV, EXEC_CTX);
}

const allTokens = AUTOMATION_VARIABLES.map((v) => `{{${v}}}`).join(' | ');
// The SMS gate refuses a body that names the review link (marketing content), as in a real send.
const smsTokens = AUTOMATION_VARIABLES.filter((v) => v !== 'review_url').map((v) => `{{${v}}}`).join(' | ');
const everySampleIn = (text: string) => {
    for (const v of AUTOMATION_VARIABLES) expect(text, v).toContain(AUTOMATION_VARIABLE_SAMPLES[v]);
};

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db as BetterSQLite3Database<typeof schema>;
    sqlite = fx.sqlite;
    await setupSchema(fx.sqlite);
    testD1.use(db);
    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'pro', createdAt: new Date(),
    } as never);
});

afterEach(() => {
    sqlite.close();
    vi.restoreAllMocks();
});

describe('POST /api/message-templates/preview', () => {
    it('renders a sample for the seeded inspector placeholder (no values posted)', async () => {
        const res = await post('preview', { channel: 'email', subject: 'Hello {{client_name}}', body: 'Your inspector: {{inspector_name}}' });
        const { data } = await res.json() as { data: { subject: string; html: string } };
        // A preview is not a send: no test marker.
        expect(data.subject).toBe(`Hello ${AUTOMATION_VARIABLE_SAMPLES.client_name}`);
        expect(data.html).toBe(`Your inspector: ${AUTOMATION_VARIABLE_SAMPLES.inspector_name}`);
    });

    it('renders every catalogue variable in an email, leaving no placeholder', async () => {
        const res = await post('preview', { channel: 'email', subject: allTokens, body: allTokens });
        const { data } = await res.json() as { data: { subject: string; html: string } };
        everySampleIn(data.subject);
        everySampleIn(data.html);
        expect(data.html).not.toMatch(/\{\{/);
    });

    it('renders every catalogue variable in an SMS', async () => {
        const res = await post('preview', { channel: 'sms', body: allTokens });
        const { data } = await res.json() as { data: { text: string } };
        everySampleIn(data.text);
        expect(data.text).not.toMatch(/\{\{/);
    });

    it('keeps the existing behaviour for a placeholder outside the catalogue: it renders empty', async () => {
        const res = await post('preview', { channel: 'email', subject: null, body: 'a{{not_a_variable}}b' });
        const { data } = await res.json() as { data: { html: string } };
        expect(data.html).toBe('ab');
    });

    it('lets posted sample values override the built-in samples', async () => {
        const res = await post('preview', { channel: 'email', subject: null, body: '{{client_name}} / {{company_name}}', sampleVars: { client_name: 'Posted Name' } });
        const { data } = await res.json() as { data: { html: string } };
        expect(data.html).toBe(`Posted Name / ${AUTOMATION_VARIABLE_SAMPLES.company_name}`);
    });
});

describe('POST /api/message-templates/test-send', () => {
    it('email: sends the rendered samples, not blanks', async () => {
        const sendEmail = vi.fn().mockResolvedValue({ delivered: true });
        vi.spyOn(buildEmailModule, 'buildTenantEmailService').mockResolvedValue({ sendEmail } as never);
        const res = await post('test-send', { channel: 'email', subject: allTokens, body: allTokens, to: 'me@example.test' });
        expect((await res.json() as { success: boolean }).success).toBe(true);
        const [to, subject, html] = sendEmail.mock.calls[0] as [string[], string, string];
        expect(to).toEqual(['me@example.test']);
        // A real recipient must be able to tell this is a test.
        expect(subject.startsWith('[Test] ')).toBe(true);
        everySampleIn(subject);
        everySampleIn(html);
        expect(html).not.toMatch(/\{\{/);
    });

    it('sms: sends the rendered samples, not blanks', async () => {
        const sendMessage = vi.fn().mockResolvedValue({ ok: true, id: 'SM_1' });
        vi.spyOn(resolveTwilioModule, 'loadProviderForTenant').mockResolvedValue({
            provider: { sendMessage, validateInboundSignature: vi.fn().mockResolvedValue(false) },
            from: '+15550009999',
        });
        const res = await post('test-send', { channel: 'sms', body: smsTokens, to: '+15559991234' });
        expect((await res.json() as { success: boolean; error?: string }).success).toBe(true);
        const sent = (sendMessage.mock.calls[0] as [{ body: string }])[0].body;
        for (const v of AUTOMATION_VARIABLES.filter((n) => n !== 'review_url')) expect(sent, v).toContain(AUTOMATION_VARIABLE_SAMPLES[v]);
        // The SMS body is exactly the rendered template: a prefix would change the segment count.
        expect(sent).toBe(smsTokens.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => AUTOMATION_VARIABLE_SAMPLES[k as keyof typeof AUTOMATION_VARIABLE_SAMPLES]));
        expect(sent).not.toMatch(/\{\{/);
    });
});

describe('values substituted into an email body are escaped; subjects and SMS are not', () => {
    const hostile = { client_name: "<b>O'Brien</b> & Co" };

    it('preview: body escaped, subject plain, a URL keeps working in an href', async () => {
        const res = await post('preview', {
            channel: 'email', subject: 'Hi {{client_name}}',
            body: '<p>{{client_name}}</p><a href="{{report_url}}">r</a>',
            sampleVars: { ...hostile, report_url: 'https://a.test/r?x=1&y=2' },
        });
        const { data } = await res.json() as { data: { subject: string; html: string } };
        expect(data.subject).toBe("Hi <b>O'Brien</b> & Co");
        expect(data.html).toBe('<p>&lt;b&gt;O&#39;Brien&lt;/b&gt; &amp; Co</p><a href="https://a.test/r?x=1&amp;y=2">r</a>');
    });

    it('preview: SMS text is not escaped', async () => {
        const res = await post('preview', { channel: 'sms', body: '{{client_name}}', sampleVars: hostile });
        const { data } = await res.json() as { data: { text: string } };
        expect(data.text).toBe("<b>O'Brien</b> & Co");
    });

    it('test send: email body escaped, subject plain', async () => {
        const sendEmail = vi.fn().mockResolvedValue({ delivered: true });
        vi.spyOn(buildEmailModule, 'buildTenantEmailService').mockResolvedValue({ sendEmail } as never);
        await post('test-send', { channel: 'email', subject: '{{client_name}}', body: '<p>{{client_name}}</p>', to: 'me@example.test', sampleVars: hostile });
        const [, subject, html] = sendEmail.mock.calls[0] as [string[], string, string];
        expect(subject).toBe("[Test] <b>O'Brien</b> & Co");
        expect(html).toBe('<p>&lt;b&gt;O&#39;Brien&lt;/b&gt; &amp; Co</p>');
    });
});
