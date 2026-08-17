ALTER TABLE `invoices` ADD `invoice_number` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_invoices_tenant_number` ON `invoices` (`tenant_id`,`invoice_number`);--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `invoice_seq` integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
-- Backfill. Every invoice that predates this column gets a number, in the order
-- it was raised, so a tenant's history reads as one sequence rather than
-- starting at 1001 tomorrow with a gap behind it.
--
-- A correlated count rather than a window function: the ordering key is
-- (created_at, id) because created_at is not unique — two invoices raised in the
-- same millisecond would otherwise both claim the same rank and collide on
-- uq_invoices_tenant_number, refusing the migration itself.
UPDATE invoices SET invoice_number = 1000 + (
    SELECT COUNT(*) FROM invoices i2
    WHERE i2.tenant_id = invoices.tenant_id
      AND (i2.created_at < invoices.created_at
           OR (i2.created_at = invoices.created_at AND i2.id <= invoices.id))
) WHERE invoice_number IS NULL;--> statement-breakpoint
-- Move each tenant's counter past what the backfill handed out, so the next
-- allocation cannot reissue a number that is already on a customer's invoice.
UPDATE tenant_configs SET invoice_seq = COALESCE((
    SELECT MAX(invoice_number) FROM invoices WHERE invoices.tenant_id = tenant_configs.tenant_id
), 1000);
