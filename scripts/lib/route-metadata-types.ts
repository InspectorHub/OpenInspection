/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

export interface RouteAction {
    file: string;
    method: string;
    path: string;
    operationId: string;
    tags: string[];
    scopes: string[];
    tier: string;
    summary: string;
    description: string;
    summaryFlag: boolean;       // < 4 words
    descriptionFlag: boolean;   // < 50 chars
    wrapped: boolean;           // true if we wrapped (false if already wrapped)
}
