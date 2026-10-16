/**
 * Facts about a company's own SMS account and the retired sender modes, kept apart
 * from the provider loaders so the send gate can ask them without importing the
 * whole resolver.
 */
import { loadTenantSecrets } from '../secrets-cache';
import { getDeploymentProfile, type DeploymentProfile } from '../deployment-profile';

/**
 * Stored `sms_mode` values that name a sender which no longer exists.
 *
 * `managed_shared` was the deployment-wide shared number. On a hosted
 * deployment `platform` also meant "send from the deployment's number". Both
 * now read as not configured unless the company's own account is complete. On a
 * self-hosted deployment `platform` is the operator's own provider account (their
 * env credentials), so it keeps working. The stored column is never rewritten.
 */
export function isRetiredSenderMode(env: { APP_MODE?: string | undefined; profile?: DeploymentProfile | undefined }, mode: string): boolean {
    if (mode === 'managed_shared') return true;
    if (mode !== 'platform') return false;
    return (env.profile ?? getDeploymentProfile(env.APP_MODE === undefined ? {} : { APP_MODE: env.APP_MODE })).hasManagedCompliance;
}

/**
 * Whether the company's own account details (decrypted stored keys) are complete
 * for the provider it uses. Same key sets the Integrations card judges by.
 */
export function ownSmsAccountComplete(byoProvider: 'twilio' | 'telnyx' | null | undefined, dec: Record<string, string | undefined>): boolean {
    const keys = byoProvider === 'telnyx'
        ? ['TELNYX_API_KEY', 'TELNYX_FROM_NUMBER']
        : ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'];
    return keys.every((k) => (dec[k] ?? '').trim() !== '');
}

/** For the send gate: is this company's own account complete? Fails closed (false) on any read failure. */
export async function loadOwnSmsAccountComplete(
    env: { DB: D1Database; TENANT_CACHE?: KVNamespace | undefined; JWT_SECRET: string; JWT_SECRET_PREVIOUS?: string | undefined },
    tenantId: string,
    byoProvider: 'twilio' | 'telnyx' | null | undefined,
): Promise<boolean> {
    const dec = await loadTenantSecrets(env.DB, env.TENANT_CACHE, tenantId, env.JWT_SECRET, env.JWT_SECRET_PREVIOUS).catch(() => null);
    return !!dec && ownSmsAccountComplete(byoProvider, dec);
}
