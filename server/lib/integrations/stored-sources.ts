/**
 * Where a company's explicit source choices live, and how they are read and
 * written.
 *
 * They are stored inside the existing `tenant_configs.integration_config` JSON
 * under `integrationSources`, so no migration is needed. The company's keys stay
 * in the encrypted secrets store untouched: changing a choice never deletes
 * credentials, which is what lets a company switch to Built-in and back without
 * re-entering anything.
 *
 * Reading is lenient (a corrupt or unexpected value means "no choice", never an
 * error, so a bad row cannot take a service down). Writing is strict.
 */
import {
    INTEGRATION_SERVICES,
    type IntegrationService,
    type IntegrationSourceChoice,
    type StoredIntegrationSources,
} from './sources';

const KEY = 'integrationSources';

const isService = (v: unknown): v is IntegrationService =>
    typeof v === 'string' && (INTEGRATION_SERVICES as readonly string[]).includes(v);
const isChoice = (v: unknown): v is IntegrationSourceChoice => v === 'provided' || v === 'own';

function parseObject(raw: string | null | undefined): Record<string, unknown> {
    if (!raw) return {};
    try {
        const parsed: unknown = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
        return {};
    }
}

/** The explicit choices in an `integration_config` JSON string. Unknown services and values are dropped, including the retired `platform`. */
export function parseStoredIntegrationSources(raw: string | null | undefined): StoredIntegrationSources {
    const block = parseObject(raw)[KEY];
    if (!block || typeof block !== 'object' || Array.isArray(block)) return {};
    const out: StoredIntegrationSources = {};
    for (const [service, value] of Object.entries(block as Record<string, unknown>)) {
        if (isService(service) && isChoice(value)) out[service] = value;
    }
    return out;
}

export type SourceInputResult =
    | { ok: true; service: IntegrationService; source: IntegrationSourceChoice }
    | { ok: false; error: string };

/** Validate a requested change. `platform` (the retired SMS value) and anything unknown are refused. */
export function parseIntegrationSourceInput(input: unknown): SourceInputResult {
    if (!input || typeof input !== 'object') return { ok: false, error: 'invalid_request' };
    const { service, source } = input as { service?: unknown; source?: unknown };
    if (!isService(service)) return { ok: false, error: 'unknown_service' };
    if (source === 'platform') return { ok: false, error: 'platform_mode_not_allowed' };
    if (!isChoice(source)) return { ok: false, error: 'unknown_source' };
    return { ok: true, service, source };
}

/**
 * The `integration_config` JSON with one service's choice set, everything else
 * in it preserved. Returns the new JSON string. Merge it into the CURRENT row
 * on the server; a client-held copy would overwrite concurrent changes.
 */
export function mergeStoredIntegrationSources(
    raw: string | null | undefined,
    service: IntegrationService,
    source: IntegrationSourceChoice,
): string {
    const base = parseObject(raw);
    return JSON.stringify({ ...base, [KEY]: { ...parseStoredIntegrationSources(raw), [service]: source } });
}
