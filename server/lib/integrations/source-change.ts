/**
 * Choosing a source for a service: what a settings page may show, what the
 * server accepts, and the one write that records a choice.
 *
 * Only the choice is written. The company's keys live in the encrypted secrets
 * store and are never touched here, which is what lets a company switch to
 * Built-in and back without typing anything again.
 *
 * The write merges into the CURRENT row on the server. D1 gives no JSON merge
 * operator through the query builder, so it reads the JSON, merges, and writes
 * back only if the JSON is still the one it read; if another request changed it
 * in between, it reads again. A copy held by the browser is never the base.
 */
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, isNull } from 'drizzle-orm';
import { tenantConfigs } from '../db/schema';
import { SERVICE_SPECS } from './source-catalog';
import { SWITCHABLE_SERVICES, type SwitchableService, type OverviewInputs } from './overview';
import { sourceReasonMessageKey, type SourceReasonMessageKey } from './source-reasons';
import { integrationSources } from './source-overview';
import { mergeStoredIntegrationSources } from './stored-sources';
import type { IntegrationSource, IntegrationSourceChoice, SourceReason } from './sources';

export interface SwitchableSourceRow {
    service: SwitchableService;
    /** Built-in is on offer for the service, so the company is asked to choose. */
    choiceShown: boolean;
    /** The sources the company can pick right now. */
    available: IntegrationSourceChoice[];
    /** The company's explicit choice, or null when it never made one. */
    stored: IntegrationSourceChoice | null;
    current: IntegrationSource;
    reason: SourceReason;
    reasonKey: SourceReasonMessageKey | null;
    state: 'connected' | 'attention' | 'not_connected';
    /** Runs on a number registered for the company. */
    dedicatedNumber: boolean;
    /** The company's own account details are complete, so Your own can be chosen. */
    ownReady: boolean;
}

type SourceChangeRefusal = 'not_offered' | 'own_credentials_incomplete';
type SourceChangeCheck = { ok: true } | { ok: false; error: SourceChangeRefusal };

/** The services where a choice is honoured, with what a page needs to draw the choice. */
export function describeSwitchableSources(inputs: OverviewInputs): SwitchableSourceRow[] {
    const rows = integrationSources(inputs.profile, inputs.company, inputs.env);
    return SWITCHABLE_SERVICES.map((service) => {
        const row = rows.find((r) => r.service === service);
        if (!row) throw new Error(`no source row for ${service}`);
        const spec = SERVICE_SPECS[service];
        const hosted = spec.offersProvided(inputs.profile);
        return {
            service,
            // Asked to choose only where there is more than one source to choose
            // between. Hosted SMS offers its own account alone.
            choiceShown: hosted && spec.offersOwn(inputs.profile) && row.available.includes('provided'),
            available: row.available,
            stored: inputs.company.sources?.[service] ?? null,
            current: row.current,
            reason: row.reason,
            reasonKey: sourceReasonMessageKey({ service, source: row.current, reason: row.reason }),
            state: row.state,
            dedicatedNumber: row.reason === 'dedicated_number' || row.reason === 'dedicated_not_ready',
            // Self-hosted: the operator's environment counts as the company's own details.
            ownReady: hosted ? spec.own(inputs.company).state === 'complete' : spec.standaloneOwn(inputs.company, inputs.env),
        };
    });
}

/** Whether a requested change may be saved. Never saves a source that would leave the service with no account. */
export function checkSourceChange(
    inputs: OverviewInputs,
    service: SwitchableService,
    source: IntegrationSourceChoice,
): SourceChangeCheck {
    const row = describeSwitchableSources(inputs).find((r) => r.service === service);
    if (!row || !row.available.includes(source)) return { ok: false, error: 'not_offered' };
    // Where a built-in account exists, Your own is only usable once the company's
    // details are complete: it never borrows the deployment's.
    if (source === 'own' && SERVICE_SPECS[service].offersProvided(inputs.profile) && !row.ownReady) return { ok: false, error: 'own_credentials_incomplete' };
    return { ok: true };
}

/**
 * The older per-service column the send paths still read. It follows the choice
 * so the two cannot disagree: a company on its own SMS account while the column
 * still said "managed" would be refused at send time.
 */
function legacyColumns(
    service: SwitchableService,
    source: IntegrationSourceChoice,
    currentSmsMode: string | undefined,
): Partial<Pick<typeof tenantConfigs.$inferInsert, 'emailMode' | 'smsMode'>> {
    if (service === 'email') return { emailMode: source === 'own' ? 'own' : 'platform' };
    if (service === 'sms') {
        if (source === 'own') return { smsMode: 'own' };
        // 'provided' is refused before it gets here for SMS; keep a registered
        // number as it is and never write the retired shared mode.
        return currentSmsMode === 'managed_dedicated' ? { smsMode: 'managed_dedicated' } : {};
    }
    return {};
}

const MAX_ATTEMPTS = 4;

/** Record one service's choice for one company. Touches no key. */
export async function writeIntegrationSource(
    d1: D1Database,
    tenantId: string,
    service: SwitchableService,
    source: IntegrationSourceChoice,
): Promise<void> {
    const db = drizzle(d1);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const row = await db.select({ integrationConfig: tenantConfigs.integrationConfig, smsMode: tenantConfigs.smsMode })
            .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
        const integrationConfig = mergeStoredIntegrationSources(row?.integrationConfig, service, source);
        const legacy = legacyColumns(service, source, row?.smsMode);
        if (!row) {
            try {
                await db.insert(tenantConfigs).values({ tenantId, integrationConfig, ...legacy, updatedAt: new Date() });
                return;
            } catch {
                // Another request created the row first: read it and merge into that one.
                continue;
            }
        }
        const unchanged = row.integrationConfig === null
            ? isNull(tenantConfigs.integrationConfig)
            : eq(tenantConfigs.integrationConfig, row.integrationConfig);
        const written = await db.update(tenantConfigs)
            .set({ integrationConfig, ...legacy, updatedAt: new Date() })
            .where(and(eq(tenantConfigs.tenantId, tenantId), unchanged))
            .returning({ tenantId: tenantConfigs.tenantId });
        if (written.length > 0) return;
    }
    throw new Error('integration_sources_write_conflict');
}
