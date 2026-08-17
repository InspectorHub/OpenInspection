-- The destruction record gains its measurement universe.
--
-- A record that says `completed` answers "did the purge finish?", and nothing
-- in this table answered "finish WHAT?". Counsel (round 22) requires a
-- certification to cite the generation of the record it reads, because a
-- record written before Durable Objects were purgeable cannot support a
-- certification whose scope includes them.
--
-- Existing rows default to generation 1 and are NEVER rewritten. A generation-1
-- row is a completed destruction that measured three stores instead of four;
-- backfilling it to look like a current-scope record would manufacture evidence
-- for a measurement that was never taken.
--
-- `store_results` is where a store that refused to purge is recorded — not
-- `status`, which has two values on purpose (see destruction-status.ts). A run
-- that finished with one unverified measurement is a different fact from a run
-- that never finished, and the second is signalled by the absence of
-- `completed` in a way that survives a crash.
ALTER TABLE `tenant_destruction_records` ADD `record_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_destruction_records` ADD `stores_measured` text;--> statement-breakpoint
ALTER TABLE `tenant_destruction_records` ADD `store_results` text;
