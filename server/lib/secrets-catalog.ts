/**
 * The integration-secret catalog — which keys exist, what a well-formed value
 * looks like, and the legacy aliases that map onto them.
 *
 * Pure data plus one pure function, kept apart from the route in
 * `server/api/secrets.ts` so the catalog can be read (and imported by the
 * middleware that merges DB secrets into `c.env`) without pulling in the save
 * pipeline. Key names match the Worker env binding names EXACTLY — that identity
 * is what lets the middleware merge them transparently.
 */
import { isMasked } from './config-crypto';

/** Canonical list of every integration secret configurable via the UI. */
export const INTEGRATION_SECRET_KEYS = [
    'RESEND_API_KEY',
    // SENDER_EMAIL removed (B-14): the From address is not a secret — it lives
    // in the plaintext `tenant_configs.sender_email` column set via the
    // Communication settings form, never in the encrypted secrets store.
    'GEMINI_API_KEY',
    'TURNSTILE_SECRET_KEY',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_PLACES_API_KEY',
    'ESTATED_API_KEY',
    'QBO_CLIENT_ID',
    'QBO_CLIENT_SECRET',
    'QBO_WEBHOOK_SECRET',
    'STRIPE_SECRET_KEY',
    'STRIPE_PUBLISHABLE_KEY',
    'STRIPE_WEBHOOK_SECRET',
    // Track L — Twilio SMS credentials (BYO; platform-default in SaaS via env).
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_FROM_NUMBER',
    // Task 8 (#196) — Telnyx BYO provider credentials.
    'TELNYX_API_KEY',
    'TELNYX_FROM_NUMBER',
    // #wh1 — Telnyx base64 Ed25519 PUBLIC key for inbound webhook verification.
    // No format gate (Ed25519 base64 keys have no stable public prefix, like
    // TELNYX_API_KEY). Encrypted at rest exactly like every other key here.
    'TELNYX_PUBLIC_KEY',
    // #195 — email BYO provider credentials (SendGrid / Postmark / Mailgun).
    // RESEND_API_KEY above covers the Resend path.
    'SENDGRID_API_KEY',
    'POSTMARK_SERVER_TOKEN',
    'MAILGUN_API_KEY',
    'MAILGUN_DOMAIN',
    // #wh3 — per-provider email webhook verification secrets (inbound bounce /
    // complaint receiver POST /api/public/email/:provider/:tenant). No format
    // gate — none of these has a stable public prefix (Svix whsec_ is the secret
    // body for HMAC, the SendGrid value is a base64 P-256 SPKI key, the Postmark
    // token and Mailgun signing key are opaque). Encrypted at rest by membership.
    'RESEND_WEBHOOK_SECRET',
    'SENDGRID_WEBHOOK_PUBLIC_KEY',
    'POSTMARK_WEBHOOK_TOKEN',
    'MAILGUN_SIGNING_KEY',
    'APP_BASE_URL',
] as const;

export type IntegrationSecretKey = (typeof INTEGRATION_SECRET_KEYS)[number];

/**
 * Key format rules — the slot a value lands in is inferred from its prefix so
 * a paste into the wrong field is rejected before we attempt a live call.
 * Only keys with a recognizable, STABLE vendor prefix are validated; OAuth
 * client ids/secrets (QBO, Google) and vendor keys without a format guarantee
 * (Places, Estated) are not.
 */
const KEY_FORMATS: Array<{ key: IntegrationSecretKey; re: RegExp; hint: string }> = [
    { key: 'STRIPE_PUBLISHABLE_KEY', re: /^pk_(test|live)_/, hint: 'must start with pk_test_ or pk_live_' },
    { key: 'STRIPE_SECRET_KEY', re: /^(sk|rk)_(test|live)_/, hint: 'must start with sk_test_ / sk_live_ (or a restricted rk_ key)' },
    { key: 'STRIPE_WEBHOOK_SECRET', re: /^whsec_/, hint: 'must start with whsec_' },
    { key: 'RESEND_API_KEY', re: /^re_/, hint: 'must start with re_' },
    { key: 'GEMINI_API_KEY', re: /^AIza/, hint: 'must start with AIza (a Google API key)' },
    // Cloudflare Turnstile secrets: 0x = real, 1x/2x/3x = documented test secrets.
    { key: 'TURNSTILE_SECRET_KEY', re: /^[0-3]x/, hint: 'must start with 0x (or a 1x/2x/3x test secret)' },
    { key: 'APP_BASE_URL', re: /^https?:\/\//, hint: 'must be an http(s):// URL' },
    { key: 'TWILIO_ACCOUNT_SID', re: /^AC[0-9a-fA-F]{32}$/, hint: 'must be an Account SID (starts with AC, 34 chars)' },
    { key: 'TWILIO_FROM_NUMBER', re: /^\+[1-9]\d{6,14}$/, hint: 'must be an E.164 number (e.g. +15551234567)' },
    // TWILIO_AUTH_TOKEN has no stable public prefix — not format-gated.
    { key: 'TELNYX_FROM_NUMBER', re: /^\+[1-9]\d{6,14}$/, hint: 'must be an E.164 number (e.g. +15551234567)' },
    // TELNYX_API_KEY has no stable public prefix — not format-gated.
    { key: 'SENDGRID_API_KEY', re: /^SG\./, hint: 'must start with SG.' },
    { key: 'MAILGUN_DOMAIN', re: /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/, hint: 'must be a domain, e.g. mg.yourdomain.com' },
    // POSTMARK_SERVER_TOKEN and MAILGUN_API_KEY have no stable public prefix — not format-gated.
];

/**
 * camelCase aliases the legacy settings-advanced page sends. Normalized to the
 * canonical ENV-name keys before validation / merge so the POST alias and PUT
 * share one code path.
 */
export const CAMEL_TO_ENV: Record<string, IntegrationSecretKey> = {
    resendApiKey: 'RESEND_API_KEY',
    geminiApiKey: 'GEMINI_API_KEY',
    turnstileSecretKey: 'TURNSTILE_SECRET_KEY',
    googleClientId: 'GOOGLE_CLIENT_ID',
    googleClientSecret: 'GOOGLE_CLIENT_SECRET',
    googlePlacesApiKey: 'GOOGLE_PLACES_API_KEY',
    estatedApiKey: 'ESTATED_API_KEY',
    qboClientId: 'QBO_CLIENT_ID',
    qboClientSecret: 'QBO_CLIENT_SECRET',
    qboWebhookSecret: 'QBO_WEBHOOK_SECRET',
    stripeSecretKey: 'STRIPE_SECRET_KEY',
    stripePublishableKey: 'STRIPE_PUBLISHABLE_KEY',
    stripeWebhookSecret: 'STRIPE_WEBHOOK_SECRET',
    appBaseUrl: 'APP_BASE_URL',
};

/** Returns the first format violation among NEW (non-masked) values, or null. */
export function validateStripeKeyFormats(
    incoming: Record<string, string | undefined>,
): { field: string; message: string } | null {
    for (const { key, re, hint } of KEY_FORMATS) {
        const v = incoming[key];
        if (v && !isMasked(v) && v.trim() !== '' && !re.test(v.trim())) {
            return { field: key, message: `${key} ${hint}.` };
        }
    }
    return null;
}
