ALTER TABLE `repair_request_items` ADD `repair_action_tag` text;--> statement-breakpoint
-- #275 backfill, appended to the GENERATED column migration on purpose: a
-- standalone data migration ships with no drizzle snapshot, which severs the
-- meta chain so `db:generate` refuses to author the next one — and `db:check`
-- cannot see the break, because the resulting tables are still correct. Only
-- `lint:migchain` catches it. Riding along with the ADD COLUMN keeps one
-- snapshot for one change.
--
-- Every row that already carries a credit is tagged `fund`. The moment the
-- amount input is revealed only by `fund`, an untagged row's credit disappears
-- from the builder — the buyer's own stated ask, silently absent, with nothing
-- looking wrong. The inference is sound (they typed a credit, so they wanted
-- funds) and it preserves the figure rather than hiding it.
--
-- Recorded as a decision, not a convenience: this IS the platform stating an
-- intent on the buyer's behalf, on a negotiation document they already
-- submitted. It must not be extended to inferring any other tag value.
--
-- `repair_action_tag IS NULL` makes this re-runnable after a partial failure and
-- stops it overwriting a tag somebody chose.
UPDATE `repair_request_items`
  SET `repair_action_tag` = 'fund'
  WHERE `requested_credit_cents` IS NOT NULL
    AND `repair_action_tag` IS NULL;
