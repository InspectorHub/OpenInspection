import { z } from 'zod';

/**
 * WHO AT THE DEPLOYMENT OPERATOR is acting, travelling with the command.
 *
 * REQUIRED on all three migration commands, and that is the difference between
 * them and every other command on this seam. The others are unattended —
 * provisioning, a seat reconciliation, a cron pass — and giving those a stand-in
 * actor would make a scheduled job indistinguishable in the audit trail from a
 * person opening a customer's workspace. These three are the opposite: each one
 * is a person acting on somebody else's file, and a row that could not name them
 * would name the workspace's own administrator instead, which is the state this
 * whole seam exists to end.
 *
 * ⚠️ NOT A USER ID OF OURS. `platformAdminId` is the sender's own identifier for
 * its staff and resolves to nothing in this database, which is why it lands in
 * `audit_logs.platform_actor_id` and never in `user_id`. Putting it in `user_id`
 * would make it indistinguishable from a workspace member id.
 */
const cmdPlatformActorSchema = z.object({
    platformAdminId: z.string().min(1),
    email: z.string().min(1),
});

/**
 * A bundle too large for a queue message, left in the shared exports bucket.
 *
 * `key` is `migration-deliveries/{tenantId}/{batchId}/{sha256}.json`; the
 * receiver refuses any key outside the run's own prefix before it reads
 * anything (`server/lib/migration-intake/bundle-delivery.ts`). `bytes` and
 * `sha256` describe the object's content and are re-checked on read.
 */
const cmdBundleRefSchema = z.object({
    key: z.string().min(1),
    bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

/**
 * Deliver a converted bundle into a run that has been waiting for one.
 *
 * The bundle travels inline (`bundle`) or, when it would not fit in a queue
 * message, by reference (`bundleRef`). Exactly one of the two is present.
 *
 * `.strict()`, like the subject commands: the bundle is somebody else's contact
 * data, so a field this build does not recognise means the sender believes
 * something happens here that does not. `bundle` itself is an open record — it
 * is validated in full by the bundle parser inside the applier, which produces a
 * far better message than a mirrored copy of that schema would.
 *
 * The INTENT is deliberately absent. What the workspace asked for was settled
 * when they opened the run, and a delivery allowed to restate it would be
 * allowed to widen it.
 */
export const cmdMigrationDeliverDataSchema = z.object({
    tenantId: z.string().min(1),
    batchId: z.string().min(1),
    bundle: z.record(z.string(), z.unknown()).optional(),
    bundleRef: cmdBundleRefSchema.optional(),
    actor: cmdPlatformActorSchema,
}).strict().refine(
    (d) => (d.bundle === undefined) !== (d.bundleRef === undefined),
    { message: 'carry exactly one of bundle and bundleRef', path: ['bundle'] },
);

/**
 * Hand a waiting run back, unconverted, with the reason on the run.
 *
 * `reason` is required and non-empty for the reason the route's own version is:
 * a run left alone reaches `expired`, which says the clock ran out, and
 * `abandoned` says the workspace stopped. Neither is true of a file a person
 * read and could not convert, and a refusal with no stated ground is
 * indistinguishable from one nobody looked at.
 */
export const cmdMigrationDeclineDataSchema = z.object({
    tenantId: z.string().min(1),
    batchId: z.string().min(1),
    reason: z.string().min(1).max(500),
    actor: cmdPlatformActorSchema,
}).strict();

/** Say, to the person waiting, that their file has been picked up. Moves
 *  nothing: acknowledging a file is not converting it. */
export const cmdMigrationAcknowledgeDataSchema = z.object({
    tenantId: z.string().min(1),
    batchId: z.string().min(1),
    actor: cmdPlatformActorSchema,
}).strict();
