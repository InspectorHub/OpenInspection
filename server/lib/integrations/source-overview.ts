/**
 * The per-company overview of every integration service: which sources are
 * available on this deployment, which one the company is on, and whether it
 * works. Pure: everything is derived from values the caller already read, with
 * no network call, so a page can render it on every load.
 *
 * States describe whether the chosen source works, not whose it is:
 *   connected      the resolved source has complete credentials
 *   attention      something is half done or broken in a way a person can fix
 *   not_connected  nothing set up, or the source is not available at all
 */
import type { DeploymentProfile } from '../deployment-profile';
import { SERVICE_SPECS } from './source-catalog';
import {
    INTEGRATION_SERVICES,
    offeredSources,
    resolveIntegrationSource,
    type CompanyIntegrationConfig,
    type IntegrationEnv,
    type IntegrationService,
    type IntegrationSource,
    type IntegrationSourceChoice,
    type SourceReason,
} from './sources';

type IntegrationState = 'connected' | 'attention' | 'not_connected';

export interface IntegrationSourceRow {
    service: IntegrationService;
    available: IntegrationSourceChoice[];
    current: IntegrationSource;
    reason: SourceReason;
    state: IntegrationState;
}

function stateFor(
    service: IntegrationService,
    current: IntegrationSource,
    reason: SourceReason,
    company: CompanyIntegrationConfig,
): IntegrationState {
    if (current !== 'unavailable') return 'connected';
    switch (reason) {
        // Half-entered keys are something the person can finish.
        case 'own_credentials_incomplete':
            return SERVICE_SPECS[service].own(company).state === 'partial' ? 'attention' : 'not_connected';
        // The deployment is missing a credential it is supposed to provide.
        case 'provided_not_configured':
            return 'attention';
        default:
            return 'not_connected';
    }
}

export function integrationSources(
    profile: DeploymentProfile,
    company: CompanyIntegrationConfig,
    env: IntegrationEnv,
): IntegrationSourceRow[] {
    return INTEGRATION_SERVICES.map((service) => {
        const r = resolveIntegrationSource(service, profile, company, env);
        return {
            service,
            available: offeredSources(service, profile, env),
            current: r.source,
            reason: r.reason,
            state: stateFor(service, r.source, r.reason, company),
        };
    });
}
