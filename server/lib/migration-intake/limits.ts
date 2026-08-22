import { Errors } from '../errors';
import type { DeploymentProfile } from '../deployment-profile';
import type { SourceExt } from '../../services/migration-intake/source-file.service';

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
 * `byteLength` is the LENGTH OF THE FILE, never of a re-encoding of it. The two
 * used to differ: the caller decoded the upload as text and measured the result,
 * so a binary export was inflated by every byte the decode replaced, and could
 * be refused as oversized while being well inside the cap.
 *
 * The message carries BOTH numbers. "File too large" leaves the operator
 * guessing how much they have to cut, which for a spreadsheet means splitting
 * it blind and uploading twice.
 */
export function assertSourceSizeWithin(
    limits: IntakeLimits,
    ext: SourceExt,
    byteLength: number,
): void {
    // A vendor export is a vendor export whether it arrived as JSON or as a
    // container format; only a spreadsheet flattened to text takes the CSV cap.
    const cap = ext === 'csv' ? limits.maxCsvBytes : limits.maxVendorExportBytes;
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
