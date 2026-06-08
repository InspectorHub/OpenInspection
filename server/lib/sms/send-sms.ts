import type { TwilioCreds } from './resolve-twilio';

/** Send one SMS via the Twilio REST API. Pure I/O — caller maps ok→sent / !ok→failed. */
export async function sendTwilioSms(
    creds: TwilioCreds, to: string, body: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
    const form = new URLSearchParams({ To: to, From: creds.from, Body: body });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${creds.sid}/Messages.json`, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${btoa(`${creds.sid}:${creds.token}`)}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
    });
    if (res.ok) return { ok: true };
    const text = await res.text().catch(() => '');
    return { ok: false, error: `twilio ${res.status}: ${text}`.slice(0, 500) };
}

/**
 * Twilio request signature = base64( HMAC-SHA1( authToken, URL + sorted(k+v) ) ).
 * See https://www.twilio.com/docs/usage/security#validating-requests
 */
export async function signParams(authToken: string, url: string, params: Record<string, string>): Promise<string> {
    const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
    return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function validateTwilioSignature(
    authToken: string, url: string, params: Record<string, string>, presented: string,
): Promise<boolean> {
    if (!presented) return false;
    const expected = await signParams(authToken, url, params);
    // constant-time-ish compare
    if (expected.length !== presented.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ presented.charCodeAt(i);
    return diff === 0;
}
