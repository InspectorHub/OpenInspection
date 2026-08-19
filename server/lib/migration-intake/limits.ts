import { Errors } from '../errors';
import type { DeploymentProfile } from '../deployment-profile';

/**
 * The caps in force for this deployment.
 *
 * A separate shape from the profile so the intake path takes exactly what it
 * needs — a function that accepts the whole profile can read anything, and the
 * next reader cannot tell what it actually depends on.
 */
export interface IntakeLimits {
    maxCsvBytes: number;
    maxVendorExportBytes: number;
    maxRows: number;
}

export function limitsFor(profile: DeploymentProfile): IntakeLimits {
    return {
        maxCsvBytes: profile.importMaxCsvBytes,
        maxVendorExportBytes: profile.importMaxVendorExportBytes,
        maxRows: profile.importMaxRows,
    };
}

function megabytes(bytes: number): number {
    return Math.round(bytes / 1_000_000);
}

/**
 * Refuses a source file that is over the cap for its kind.
 *
 * The message carries BOTH numbers. "File too large" leaves the operator
 * guessing how much they have to cut, which for a spreadsheet means splitting
 * it blind and uploading twice.
 */
export function assertSourceSizeWithin(
    limits: IntakeLimits,
    ext: 'csv' | 'json',
    byteLength: number,
): void {
    const cap = ext === 'json' ? limits.maxVendorExportBytes : limits.maxCsvBytes;
    if (byteLength <= cap) return;
    throw Errors.BadRequest(
        `This file is ${megabytes(byteLength)} MB and the limit is ${megabytes(cap)} MB. `
        + 'Split it and import the parts, or ask us to bring it in for you.',
    );
}

/**
 * Refuses a bundle with more entries than one run may carry, naming the real
 * count. A file over the line is not a mistake to correct, it is a file that
 * wants the assisted route, and the operator can only tell which by seeing how
 * far over it is.
 */
export function assertRowCountWithin(limits: IntakeLimits, rowCount: number): void {
    if (rowCount <= limits.maxRows) return;
    throw Errors.BadRequest(
        `This file contains ${rowCount} entries and one import can carry ${limits.maxRows}. `
        + 'Split it and import the parts, or ask us to bring it in for you.',
    );
}
