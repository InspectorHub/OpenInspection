-- DB-9 — idempotency/data-quality unique indexes. Each CREATE UNIQUE INDEX is
-- preceded by a defensive dedup (keep the earliest rowid per key) so the index
-- can't fail on a pre-existing duplicate. Single-statement GROUP BY dedup (no
-- CROSS JOIN fan-out) keeps clear of D1's compound-SELECT term limit.

DELETE FROM `automation_logs`
WHERE `event_id` IS NOT NULL
  AND `rowid` NOT IN (
    SELECT MIN(`rowid`) FROM `automation_logs`
    WHERE `event_id` IS NOT NULL
    GROUP BY `automation_id`, `inspection_id`, `event_id`
  );--> statement-breakpoint
CREATE UNIQUE INDEX `uq_automation_logs_event` ON `automation_logs` (`automation_id`,`inspection_id`,`event_id`) WHERE event_id IS NOT NULL;--> statement-breakpoint
DELETE FROM `tenant_invites`
WHERE `status` = 'pending'
  AND `rowid` NOT IN (
    SELECT MIN(`rowid`) FROM `tenant_invites`
    WHERE `status` = 'pending'
    GROUP BY `tenant_id`, `email`
  );--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tenant_invites_pending_email` ON `tenant_invites` (`tenant_id`,`email`) WHERE status = 'pending';
