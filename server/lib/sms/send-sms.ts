import { createTwilioClient, type TwilioCreds } from '../messaging/twilio';
export { signParams, validateTwilioSignature } from '../messaging/twilio';
export type { TwilioCreds };

/**
 * @deprecated Prefer MessagingProvider via loadProviderForTenant / sendOneSms.
 * Kept for the unit test that pins the Twilio REST shape; production callers
 * must not import this (`lint:provider-helpers` bans new call sites).
 */
export async function sendTwilioSms(
    creds: TwilioCreds, to: string, body: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
    return createTwilioClient({ sid: creds.sid, token: creds.token, from: creds.from })
        .messages.create({ from: creds.from, to, body });
}
