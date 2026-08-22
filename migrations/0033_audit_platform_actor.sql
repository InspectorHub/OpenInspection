-- An audit row can now say WHICH KIND of actor produced it, so an action taken
-- by the deployment operator on a workspace's behalf stops being indistinguishable
-- from one the workspace took itself.
--
-- `actor_kind` takes a default so that every existing row keeps a meaning. Read
-- that default for what it is: on a row written before this column existed it
-- says "we do not know it was NOT a tenant user", not "we checked and it was".
-- Those rows cannot be used to clear anybody, and no backfill can change that —
-- the fact they would need was never recorded.
ALTER TABLE `audit_logs` ADD `actor_kind` text DEFAULT 'tenant_user' NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `platform_actor_id` text;
