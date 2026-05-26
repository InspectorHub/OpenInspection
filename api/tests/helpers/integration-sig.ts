import crypto from 'node:crypto';

/**
 * Generates an HMAC SHA-256 signature for M2M communication between Portal and Core.
 * Matches the logic in portal/src/services/provisioning.service.ts
 */
export async function generatePortalSignature(secret: string, timestamp: string, body: string): Promise<string> {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(`${timestamp}.${body}`);
    return hmac.digest('hex');
}
