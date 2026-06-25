import { TwilioClient, type TwilioCreds } from '../messaging/twilio';
export { signParams, validateTwilioSignature } from '../messaging/twilio';
export type { TwilioCreds };

/** Send one SMS via the Twilio REST API. Pure I/O — caller maps ok→sent / !ok→failed. */
export async function sendTwilioSms(
    creds: TwilioCreds, to: string, body: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
    return new TwilioClient({ sid: creds.sid, token: creds.token }).messages.create({ from: creds.from, to, body });
}
