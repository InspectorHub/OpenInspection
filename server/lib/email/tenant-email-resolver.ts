import type { EmailService } from '../../services/email.service';
import { readTenantPlan, type PlanQuotaGuard } from '../../features/plan-quota/guard';
import { memoOnce } from '../request-scope';
import { assembleTenantEmailService, loadTenantEmailConfig, type EmailServiceEnv } from './build-email-service';

/**
 * Explicit per-tenant email resolution for one request.
 *
 * WHY THIS EXISTS. The DI middleware loads a tenant's email config eagerly, but
 * only when the tenant is already known at that point AND the request is an API
 * call. That gate is deliberate (a page render re-enters the middleware chain
 * many times, and non-API requests must not pay D1 reads for a send they never
 * make), so it stays. What it cannot see is a route that learns its tenant
 * INSIDE the handler, after the DI middleware has already run: a public booking
 * that names its company in the body, a token that names its tenant when
 * redeemed, a global agent session whose company comes from the request. On
 * those routes `services.email` is the platform-default service, so the mail
 * would go out without the tenant's sender name, Reply-To, brand, own provider
 * or template overrides, and unmetered.
 *
 * A send site that knows its tenant therefore asks for that tenant's service
 * by id, and a send that deliberately speaks for the deployment says so.
 */
export interface EmailForOptions {
    /**
     * The send answers something its recipient just did (a booking they made, a
     * signature they gave). It is the tenant's own service in every respect but
     * one: it has no new-company cooling window. Never reuse this for a send the
     * recipient did not trigger.
     */
    recipientInitiated?: boolean | undefined;
}

export interface TenantEmailResolver {
    /** The service configured for `tenantId`: its identity, transport, gates and meter. */
    emailFor(tenantId: string, options?: EmailForOptions): Promise<EmailService>;
    /**
     * The deployment's own voice, for sends that belong to no company (a
     * global account's sign-in link). In a single-tenant deployment the
     * deployment IS its fixed tenant, so this is that tenant's service.
     */
    platformEmail(): EmailService;
}

export interface TenantEmailResolverDeps {
    env: EmailServiceEnv;
    /** The tenant whose config the DI middleware already loaded, if it loaded one. */
    loadedTenantId: string | undefined;
    /** The service DI builds from that loaded config — called only for that tenant. */
    loadedService: () => EmailService;
    /** The fixed tenant of a single-tenant deployment; null when multi-tenant. */
    fixedTenantId: string | null;
    /** Whether this deployment meters tenants against a usage allowance. */
    hasUsageQuota: boolean;
    buildPlanQuota: () => PlanQuotaGuard | undefined;
}

export function createTenantEmailResolver(deps: TenantEmailResolverDeps): TenantEmailResolver {
    // Per-resolver (i.e. per-request) memo. `memoOnce` below only shares work
    // across the in-process sub-requests of one page render; a request that
    // arrived over HTTP has no such scope, and repeated calls within it must
    // still not re-read D1.
    const services = new Map<string, Promise<EmailService>>();
    let platform: EmailService | undefined;

    const build = async (tenantId: string, recipientInitiated: boolean): Promise<EmailService> => {
        // The same memo keys the DI middleware uses for the same reads, so a
        // tenant it loaded under a shared scope is never read twice.
        const cfg = await memoOnce(deps.env, `email-cfg:${tenantId}`, () => loadTenantEmailConfig(deps.env, tenantId));
        // The tier is read for THIS tenant. A tier the tenant router put in the
        // session belongs to the tenant it resolved, which need not be this one.
        const plan = deps.hasUsageQuota
            ? await memoOnce(deps.env, `plan:${tenantId}`, () => readTenantPlan(deps.env.DB, tenantId)).catch(() => null)
            : null;
        return assembleTenantEmailService(deps.env, cfg, tenantId, deps.buildPlanQuota(), plan?.tier, { recipientInitiated });
    };

    return {
        emailFor(tenantId: string, options?: EmailForOptions): Promise<EmailService> {
            const initiated = options?.recipientInitiated === true;
            // The service DI loaded has the cooling window; a recipient-initiated
            // send must not share it, so it is always built separately.
            if (!initiated && tenantId === deps.loadedTenantId) return Promise.resolve(deps.loadedService());
            const memoKey = initiated ? `${tenantId}#initiated` : tenantId;
            const hit = services.get(memoKey);
            if (hit) return hit;
            const pending = memoOnce(deps.env, `email-svc:${memoKey}`, () => build(tenantId, initiated));
            services.set(memoKey, pending);
            return pending;
        },
        platformEmail(): EmailService {
            if (deps.fixedTenantId !== null && deps.fixedTenantId === deps.loadedTenantId) {
                return deps.loadedService();
            }
            platform ??= assembleTenantEmailService(deps.env, { dbSecrets: {} });
            return platform;
        },
    };
}
