-- A person can stop the cross-tenant lookup that is about them.
--
-- GET /api/integration/tenants/by-email takes one address and returns the
-- inspection companies holding a live report grant for it. It exists because it
-- is how a homebuyer who no longer has the email finds their own report, and it
-- is not being removed. But it is the platform — not any one company —
-- assembling a statement about one person's relationships, and there was no way
-- to object to it. This table is the objection.
--
-- NO tenant_id, deliberately. The scan has no tenant in scope, and the person
-- objecting does not know which companies hold grants for them; a per-company
-- objection would be unexercisable by the only party entitled to raise it, and
-- would silently lapse the next time a new company acquired a grant. The
-- reasoning lives next to the table definition in
-- server/lib/db/schema/tenant/core.ts, which is where a reader looks first.
--
-- email_hash, not email: the only question asked of this table is "did THIS
-- address object", and a legible column would also be a browsable list of the
-- people who objected. Unsalted SHA-256 of the trimmed, lower-cased address —
-- confirmable from a candidate address by design, not offered as secrecy.
--
-- withdrawn_at rather than DELETE, so the window in which the objection was in
-- force stays answerable, and so re-filing cannot accumulate rows.
--
-- Filing is authorised by PROOF OF CONTROL of the address: an unrevoked
-- inspection_access_tokens row whose token hash the caller can present and whose
-- recipient matches. That is the same secret that already releases the report
-- itself, so the objection path grants no capability its user did not have —
-- which is what keeps "suppress me" from becoming a way to deny somebody else
-- access to their own report.
CREATE TABLE `discovery_objections` (
	`id` text PRIMARY KEY NOT NULL,
	`email_hash` text NOT NULL,
	`proved_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`withdrawn_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_discovery_objections_email_hash` ON `discovery_objections` (`email_hash`);
