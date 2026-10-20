import type {
  PsqView,
  ReportSignoffView,
  ResultMap,
  StatutoryDetails,
  TemplateSnapshot,
} from './data-source-types';

/**
 * The write commands the editor issues. One member per route-action intent of
 * `app/routes/inspection-edit/action.server.ts` (and the two modules it chains
 * to, `action-statutory.server.ts` and `action-followup.server.ts`).
 *
 * NOT in this union, on purpose:
 * - `upload-photo`. Photo bytes go through `FieldDataSource.media.uploader`
 *   (online) or `media.store` (offline); see `MediaUploader` in `media-types.ts`.
 * - The `PATCH`es the editor writes straight into the live results document.
 */
export type FieldCommand =
  | { type: 'complete' }
  /**
   * `markComplete` absent or false skips the complete call. `autoSignOnPublish`
   * ABSENT means "do not touch the stored flag" (the action only PATCHes it when
   * the form field is present), so a host that has no such toggle must omit it.
   */
  | { type: 'publish'; markComplete?: boolean; autoSignOnPublish?: boolean; summary?: string }
  /** The body is relayed unchanged to the property-facts PATCH; its keys belong to PropertyInfoForm (Task 5). */
  | { type: 'save-property-facts'; payload: Record<string, unknown> }
  /** Read-only lookup: nothing is persisted. See `CommandDataMap['autofill-property-facts']`. */
  | { type: 'autofill-property-facts'; addressString: string }
  /** The settings sheet's whole form; the data source sanitises it (empty strings mean "unchanged"). */
  | { type: 'save-settings'; payload: Record<string, unknown> }
  /** An empty `key` is refused. */
  | { type: 'save-pca-narrative'; key: string; value: string }
  /** An empty `signatureBase64` is a no-op that still answers ok. */
  | { type: 'sign-inspector'; signatureBase64: string }
  /** An empty string clears the cover. */
  | { type: 'set-cover'; coverPhotoId: string }
  /** Uploads to the media pool, then sets it as the cover. The action requires a `File`; hosts wrap the blob. */
  | { type: 'upload-cover'; file: Blob }
  /** `crop` is the JSON string of a `PhotoCropTransform` (the action forwards it as a form field). */
  | { type: 'crop-cover'; sourceKey: string; crop: string; image: Blob }
  /**
   * `nodes` is the JSON string of the serialised annotation node tree (`'[]'` when
   * absent). `photoIndex` must be >= 0. `sectionId` is optional: the action omits it
   * from the request when empty.
   */
  | { type: 'annotate'; itemId: string; photoIndex: number; nodes: string; image: Blob; sectionId?: string }
  /** `collab` true also asks the live document to converge; a refused convergence answers `ok: false` with `error`. */
  | { type: 'restructure'; snapshot: TemplateSnapshot; collab: boolean }
  | SaveStructureTemplateCommand
  | { type: 'add-statutory-instance'; groupId: string; index: number; fields: Record<string, unknown> }
  /** Absent keys mean "leave it alone", so a partial payload is safe. */
  | { type: 'save-statutory-details'; payload: Partial<StatutoryDetails> }
  /** `status: null` clears the verdict; an absent `notes` leaves the stored note alone. */
  | { type: 'set-followup'; itemId: string; status: string | null; notes?: string }
  | UnitCommand
  | ComplianceCommand
  /** Pulls one unit's findings. See `CommandDataMap['load-scope']`. */
  | { type: 'load-scope'; scope: string };

/**
 * `mode: 'new'` forks a template (name defaults to a placeholder when blank).
 * `mode: 'back'` updates the source template and REQUIRES its id: the action
 * answers an error without it.
 */
export type SaveStructureTemplateCommand =
  | { type: 'save-structure-template'; mode: 'new'; snapshot: TemplateSnapshot; name?: string }
  | { type: 'save-structure-template'; mode: 'back'; snapshot: TemplateSnapshot; templateId: string };

/** Body of the unit bulk-create route (`BulkCreateUnitsSchema`). */
export type BulkCreateUnitsBody =
  | { mode: 'floors_stacks'; floors: number[]; stacks: number; startAt?: number; parentUnitId?: string | null }
  | { mode: 'csv'; csv: string; parentUnitId?: string | null };

/**
 * Per-unit editor mutations (action intents `unit-*`). The payload keys per op
 * are exactly what each action branch reads:
 * - create: `name` (trimmed, required; the unit is created top-level)
 * - rename: `unitId`, `name`
 * - delete / duplicate: `unitId`
 * - bulk-create: `payload`, the whole discriminated body
 * - mode-switch: `mode`
 * None of them returns data.
 */
export type UnitCommand =
  | { type: 'unit'; op: 'create'; name: string }
  | { type: 'unit'; op: 'rename'; unitId: string; name: string }
  | { type: 'unit'; op: 'delete'; unitId: string }
  | { type: 'unit'; op: 'duplicate'; unitId: string }
  | { type: 'unit'; op: 'bulk-create'; payload: BulkCreateUnitsBody }
  | { type: 'unit'; op: 'mode-switch'; mode: 'tagged' | 'per_unit' };

/**
 * Compliance panel mutations (action intents `compliance-*`). Keys per op:
 * - signoff: `role`, `personId`, `name` (all required), `license` (empty becomes null), `dualRole`
 * - remove-signoff: `role`
 * - doc-review-seed: none (populates an empty checklist)
 * - doc-review: `documentKey`, the four flags, `notes` (empty becomes null)
 * - psq: `responses`
 * - psq-status: `status`, and `reason` (context carried into the disclosed deviation when declined)
 */
export type ComplianceCommand =
  | {
      type: 'compliance';
      op: 'signoff';
      role: ReportSignoffView['role'];
      personId: string;
      name: string;
      license: string | null;
      dualRole: boolean;
    }
  | { type: 'compliance'; op: 'remove-signoff'; role: ReportSignoffView['role'] }
  | { type: 'compliance'; op: 'doc-review-seed' }
  | {
      type: 'compliance';
      op: 'doc-review';
      documentKey: string;
      requested: boolean;
      received: boolean;
      reviewed: boolean;
      na: boolean;
      notes: string | null;
    }
  | { type: 'compliance'; op: 'psq'; responses: Record<string, unknown> }
  | { type: 'compliance'; op: 'psq-status'; status: PsqView['status']; reason?: string };

/**
 * Why an autofill returned no facts. The first three are the property-lookup
 * service's own codes (`LookupReason`); the last two are the route action's
 * (address shorter than five characters, and a non-ok API response).
 */
export type AutofillReason = 'NO_API_KEY' | 'NOT_FOUND' | 'PROVIDER_ERROR' | 'BAD_ADDRESS' | 'REQUEST_FAILED';

/**
 * The value a command answers with, keyed by `CommandKey`. A command absent from
 * this map answers no data. Shapes are what the action returns beside `ok`.
 */
export interface CommandDataMap {
  /**
   * Present on BOTH outcomes: a failed lookup answers `{ ok: false, data: { facts: null, reason } }`,
   * and a successful lookup that found nothing answers `ok: true` with a `reason`. This is the
   * channel for the "auto-fill not configured" hint; do not parse `error` for it.
   */
  'autofill-property-facts': { facts: Record<string, unknown> | null; reason: AutofillReason | null };
  /** The composite-keyed slice for the editor to merge. */
  'load-scope': { scope: string; results: ResultMap };
  /** `coverUrl` is null when the upload response carried none. */
  'upload-cover': { coverKey: string; coverUrl: string | null };
  /** `coverKey` is null when the crop response carried none. */
  'crop-cover': { coverKey: string | null };
  'compliance:signoff': { role: ReportSignoffView['role'] };
  'compliance:remove-signoff': { role: ReportSignoffView['role'] };
  'compliance:doc-review': { documentKey: string };
  'compliance:psq-status': { status: PsqView['status'] };
}

/** `type`, or `type:op` for the two commands that carry an `op`. */
export type CommandKey<C extends FieldCommand> = C extends { type: infer T extends string; op: infer O extends string }
  ? `${T}:${O}`
  : C['type'];

type DataOfKey<K> = K extends keyof CommandDataMap ? CommandDataMap[K] : undefined;

/** The data type `execute` answers for command `C`; `undefined` when the command returns none. */
export type CommandData<C extends FieldCommand> = DataOfKey<CommandKey<C>>;

/**
 * `ok` is the write's outcome. `error` is the sentence to show, when the action
 * wrote one (publish, restructure, save-structure-template, set-followup,
 * add-statutory-instance). `data` is typed per command by `CommandDataMap`.
 */
export interface CommandResult<D = undefined> {
  ok: boolean;
  error?: string;
  data?: D;
}
