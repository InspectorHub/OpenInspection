/**
 * The offline data package format, shared by the server that imports a package
 * and any client that writes or imports one. Pure data, schemas and logic: this
 * package must not import from `server/` or `app/`, and depends only on `zod`
 * and `fflate`. A client supplies the transport (`Send`) itself.
 */
export * from './src/limits';
export * from './src/manifest';
export { PackageFormatError, parsePackage, readPackageSummary } from './src/format';
export type { PackageSummary, ParsedPackage } from './src/format';
export { extractHeldBackPackage, planParts, splitPackage } from './src/split';
export type { Part, PartLimits, PartPlan, SplitResult } from './src/split';
export { classifyResponse } from './src/classify';
export type { Classified } from './src/classify';
export {
    BACKOFF_BASE_MS, BACKOFF_CAP_MS, MAX_ATTEMPTS_PER_PART, MAX_RETRY_WINDOW_MS, runImport,
} from './src/run-import';
export type { HeldBack, HeldBackReason, ImportOptions, ImportReport, NeedsAttention, Send, SendResult } from './src/run-import';
