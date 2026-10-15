/**
 * Where each QuickBooks setting comes from: the deployment, the company's own
 * stored values, or nowhere.
 *
 * This answers ORIGIN only. The merged environment holds the values themselves,
 * so the function reads them to tell "set" from "blank", and then returns three
 * words. Nothing it returns is derived from a value's content or length.
 *
 * The precedence rule is not restated. `applyIntegrationSecrets` decides, per
 * request, which keys it filled from the company's stored values and reports
 * them; a key it did not fill and that holds a value is the deployment's.
 */
import type { QBOCredentialOrigin, QBOCredentialSource } from './api-base';

/** The four keys the settings page shows the origin of, as merged into `c.env`. */
export interface QboMergedSettings {
    QBO_CLIENT_ID?: string;
    QBO_CLIENT_SECRET?: string;
    QBO_WEBHOOK_SECRET?: string;
    QBO_ENV?: string;
}

export function describeCredentialSource(
    merged: QboMergedSettings,
    filledFromTenant: readonly string[],
): QBOCredentialSource {
    const originOf = (key: keyof QboMergedSettings): QBOCredentialOrigin => {
        if (filledFromTenant.includes(key)) return 'tenant';
        const value = merged[key];
        return typeof value === 'string' && value.trim() !== '' ? 'env' : 'missing';
    };
    return {
        clientId:     originOf('QBO_CLIENT_ID'),
        clientSecret: originOf('QBO_CLIENT_SECRET'),
        webhookToken: originOf('QBO_WEBHOOK_SECRET'),
        environment:  originOf('QBO_ENV'),
    };
}
