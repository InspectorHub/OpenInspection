/**
 * Unsubscribe from a signed link — the way out of an email, for someone who is
 * not signed in and may have no account to sign in to.
 *
 * ── STRUCTURALLY OUT OF REACH, NOT EXEMPTED ─────────────────────────────────
 * Mounted under `/api/public`, which `jwtAuthMiddleware` short-circuits before
 * it classifies anybody. `agentUserId` is therefore never set, so
 * `agentTermsGate` — which is mounted on `*` and keyed on that variable —
 * returns on its first line. This is the same shape as the inbound SMS
 * STOP/START webhook: not an entry in the gate's exempt list, but outside the
 * reckoning that list belongs to.
 *
 * That distinction is the reason this file exists in this form. An exemption is
 * a decision, and decisions get argued with, revisited, or dropped when
 * somebody tidies a list. **Do not add this path to `EXEMPT_PATHS`.** If it
 * ever appears there, something has moved it inside the gate and the fix is to
 * move it back out, not to keep the entry.
 *
 * ── The GET does not mutate. That is not a style preference ─────────────────
 * Mail clients prefetch. Corporate link scanners, anti-malware appliances and
 * safe-link rewriters fetch every URL in every message, before a human has read
 * a word of it. An unsubscribe that fires on GET is therefore an unsubscribe
 * fired by a virus scanner. So the link lands on `/unsubscribe/:token`, whose
 * loader calls `GET /resolve` — a pure read that describes what the link would
 * do — and the change happens only on the POST behind a confirm control.
 *
 * ── RFC 8058 one-click is deliberately NOT implemented here ─────────────────
 * `List-Unsubscribe-Post: List-Unsubscribe=One-Click` is the one legitimate
 * POST-without-confirmation, and it would be a good thing to have. It is not
 * here because it cannot be added at this layer alone: `EmailSendArgs`
 * (`server/lib/email/provider.ts`) carries no custom-header channel, so the
 * header pair would mean changing all five provider adapters and each vendor's
 * own header encoding. When that is done, the one-click target must be a
 * SEPARATE route that accepts exactly the RFC's form-encoded
 * `List-Unsubscribe=One-Click` body and nothing else — never this JSON route
 * with a relaxed body, because a POST that unsubscribes on any shape is a POST
 * a preflighting client can trip.
 *
 * ── Both routes are `tier: 'excluded'` ───────────────────────────────────────
 * Not gated behind a flag — never exposed as an MCP tool at all. The only
 * key to this surface is a signed token that was mailed to one person, and
 * there is no path by which an assistant comes to hold one legitimately. A
 * tool that did would be a tool for acting on a recipient's behalf without
 * the recipient, which is the one thing this endpoint exists to prevent.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { createApiRouter } from '../lib/openapi-router';
import { getDrizzle } from '../lib/route-helpers';
import { tenantConfigs } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { notificationClass, isSuppressible } from '../lib/notifications/classes';
import { isPreferenceMuted, resolveSubjectsForAddress } from '../lib/notifications/preference-port';
import { writeChoice } from '../lib/notifications/preference-write';
import { verifyUnsubscribeToken } from '../lib/notifications/unsubscribe-token';

/** Every refusal on this surface says the same thing. A link that names a class
 *  this deployment stopped sending, an address it no longer has, or a signature
 *  it did not make are all "this link does not work" to the person holding it,
 *  and distinguishing them out loud would turn the endpoint into an oracle for
 *  which addresses a company has on file. */
const DEAD_LINK = 'This unsubscribe link is no longer valid. Ask the company that emailed you to stop, and they can do it from their side.';

const ResolvedSchema = z.object({
    success: z.literal(true),
    data: z.object({
        companyName: z.string().describe('Who sends the notification — the name the recipient will recognise.'),
        label: z.string().describe('Recipient-facing name of the one notification this link covers.'),
        classId: z.string(),
        muted: z.boolean().describe('True when this notification is ALREADY switched off for this address.'),
    }),
}).openapi('UnsubscribeResolved');

const resolveRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/unsubscribe/resolve',
    tags: ['public'],
    summary: 'Describe what a signed unsubscribe link would switch off',
    request: { query: z.object({ token: z.string().min(1)
            .describe('The signed token from the unsubscribe link in the email. Names one address and one notification.') }) },
    responses: {
        200: { content: { 'application/json': { schema: ResolvedSchema } }, description: 'What the link covers.' },
        404: { description: 'The link is not valid for this deployment.' },
    },
    operationId: 'resolveUnsubscribeLink',
    description:
        'A PURE READ. Resolves the signed token to the company, the one notification it covers, ' +
        'and whether that notification is already off for this address. Writes nothing — link ' +
        'scanners and mail clients fetch every URL in an email, so acting here would unsubscribe ' +
        'people who never opened the message.',
}, { scopes: ['read'], tier: 'excluded' }));

const setRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/unsubscribe',
    tags: ['public'],
    summary: 'Switch one notification off for this address',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        token: z.string().min(1)
                            .describe('The signed token from the unsubscribe link in the email. Names one address and one notification.'),
                        enabled: z.boolean()
                            .describe('false to stop this notification; true to start it again.'),
                    }),
                },
            },
        },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true), enabled: z.boolean() }) } },
            description: 'Recorded.',
        },
        400: { description: 'A notification the recipient is told is always sent.' },
        404: { description: 'The link is not valid for this deployment.' },
    },
    operationId: 'setUnsubscribePreference',
    description:
        'Records the recipient\'s own choice for the ONE notification the token names, on the ' +
        'email channel, against the same `notification_preferences` row the signed-in screen ' +
        'writes. Needs no session. Two-directional on purpose — a recipient with no account has ' +
        'no other way back.',
}, { scopes: ['write'], tier: 'excluded' }));

/**
 * Token to (tenant, subjects, class), or a 404 shared by both handlers.
 *
 * The `isSuppressible` check is a 400 rather than a 404 because it is a
 * different fact and the difference matters to whoever is reading logs: the
 * link is genuine, the deployment issued it, and what it asks for is something
 * the recipient was never offered. A link like that should not have been minted
 * — the footer builder only mints them for suppressible classes — so seeing one
 * means a hand-built link or a class whose `required` flag has since changed.
 */
async function resolveLink(
    db: ReturnType<typeof getDrizzle>, secret: string, token: string,
) {
    const grant = await verifyUnsubscribeToken(secret, token);
    if (!grant) throw Errors.NotFound(DEAD_LINK);

    const cls = notificationClass(grant.classId);
    if (!cls) throw Errors.NotFound(DEAD_LINK);
    if (!isSuppressible(grant.classId)) {
        throw Errors.BadRequest('This message is part of the service itself — an inspection report, an agreement, a receipt — so it cannot be switched off. Contact the company directly if you no longer want it.');
    }

    // An address with no `users` or `contacts` row in this tenant has nowhere to
    // store a preference. Saying "done" would be the worst available answer: the
    // person stops looking, and nothing changed. (The realistic causes are an
    // erasure and a changed address; both are correctly a dead link.)
    const subjects = await resolveSubjectsForAddress(db, grant.tenantId, grant.email);
    if (subjects.length === 0) throw Errors.NotFound(DEAD_LINK);

    return { grant, cls, subjects };
}

const unsubscribeRoutes = createApiRouter()
    .openapi(resolveRoute, async (c) => {
        const db = getDrizzle(c);
        const { token } = c.req.valid('query');
        const { grant, cls, subjects } = await resolveLink(db, c.env.JWT_SECRET, token);

        // The name the recipient recognises is the company's, not the platform's
        // — they were emailed by an inspection company, and a page headed with
        // the software's name would read as a different organisation entirely.
        const cfg = await db.select({ companyName: tenantConfigs.companyName })
            .from(tenantConfigs).where(eq(tenantConfigs.tenantId, grant.tenantId)).get();

        return c.json({
            success: true as const,
            data: {
                companyName: cfg?.companyName ?? 'this company',
                label: cls.label,
                classId: cls.id,
                muted: await isPreferenceMuted(db, grant.tenantId, cls.id, 'email', subjects),
            },
        }, 200);
    })
    .openapi(setRoute, async (c) => {
        const db = getDrizzle(c);
        const { token, enabled } = c.req.valid('json');
        const { grant, subjects } = await resolveLink(db, c.env.JWT_SECRET, token);

        // EVERY subject the address stands for, because one person can be both a
        // user and a contact and they are the same human. Muting one of the two
        // would be a control that half-works, which is worse than none.
        for (const s of subjects) {
            await writeChoice(db, {
                tenantId: grant.tenantId,
                subjectKind: s.kind,
                subjectId: s.id,
                classId: grant.classId,
                channel: 'email',
                enabled,
            });
        }
        return c.json({ success: true as const, enabled }, 200);
    });

export default unsubscribeRoutes;
export type UnsubscribeApi = typeof unsubscribeRoutes;
