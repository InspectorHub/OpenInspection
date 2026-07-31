-- Thread inspection_messages by CONTACT (Communication design §3.9):
-- contact_id (notNull) + from_user_id are new, inspection_id becomes nullable,
-- and the unread index re-keys from inspection to contact. The nullability
-- change forces this table rebuild; nothing references inspection_messages
-- (verified), and the FOREIGN KEY clauses below re-declare the frozen legacy
-- FKs — they do not add new ones.
--
-- BACKFILL, and its known flaw, recorded deliberately: contact_id is filled
-- with the inspection's primary client (inspection_people ⋈
-- contact_role_profiles key='client'), falling back to the oldest client-kind
-- seat. A row actually written by a CO-CLIENT is therefore attributed to the
-- primary client. That is what the product already displayed before this
-- change, so the backfill fossilises an existing error rather than creating
-- one — but do not assume the historical attribution is clean. A row whose
-- inspection has no client seat at all lands on '' and renders as an unknown
-- contact; it cannot be attributed to anyone with the data that exists.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_inspection_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text,
	`from_role` text NOT NULL,
	`from_name` text,
	`body` text NOT NULL,
	`attachments` text,
	`read_at` integer,
	`created_at` integer NOT NULL,
	`contact_id` text NOT NULL,
	`from_user_id` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inspection_id`) REFERENCES `inspections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_inspection_messages`("id", "tenant_id", "inspection_id", "from_role", "from_name", "body", "attachments", "read_at", "created_at", "contact_id", "from_user_id") SELECT
	m."id", m."tenant_id", m."inspection_id", m."from_role", m."from_name", m."body", m."attachments", m."read_at", m."created_at",
	COALESCE(
		(SELECT ip.contact_id FROM inspection_people ip
			JOIN contact_role_profiles crp ON crp.id = ip.role_profile_id
			WHERE ip.tenant_id = m.tenant_id AND ip.inspection_id = m.inspection_id AND crp.key = 'client'
			LIMIT 1),
		(SELECT ip.contact_id FROM inspection_people ip
			JOIN contact_role_profiles crp ON crp.id = ip.role_profile_id
			WHERE ip.tenant_id = m.tenant_id AND ip.inspection_id = m.inspection_id AND crp.kind = 'client'
			ORDER BY ip.created_at LIMIT 1),
		''
	),
	NULL
FROM `inspection_messages` m;--> statement-breakpoint
DROP TABLE `inspection_messages`;--> statement-breakpoint
ALTER TABLE `__new_inspection_messages` RENAME TO `inspection_messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_msg_inspection` ON `inspection_messages` (`inspection_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_msg_contact` ON `inspection_messages` (`tenant_id`,`contact_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_msg_unread` ON `inspection_messages` (`tenant_id`,`contact_id`,`from_role`) WHERE "inspection_messages"."read_at" IS NULL;
