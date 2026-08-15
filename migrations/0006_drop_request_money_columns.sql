-- Two write-only money columns on `inspection_requests`.
--
-- `total_amount_cents` held what the sub-services summed to at booking. Its only
-- reader was its own accumulator — the incremental add in
-- `inspection-request.service.ts` read the current value to add the next
-- service's price to it. Nothing else consulted it: no first-party client, no
-- billing path, not even a test. It also did not follow a reprice, an override
-- or an invoice, so it could not have been trusted if something had. What an
-- order costs is `getEffectivePriceCents()` — invoice, then the sum of
-- `inspection_services` snapshots, then the `inspections.price` cache.
--
-- `payment_status` had no reader at all. Payment state anyone acts on lives on
-- the ORDER (`inspections.payment_status`) and in the `order_payments` ledger.
--
-- These two survived the earlier column sweep, which took only columns with no
-- reference anywhere, because both were published in the OpenAPI/MCP contract
-- (`InspectionRequestResponseSchema`, and `payment_status` was writable through
-- the update schema as well). Removing them is therefore a CONTRACT change and
-- not merely a column drop: an MCP client reading `totalAmount` off a request
-- will stop seeing the field. That is the intent — the number it was reading was
-- a booking-time quote that no part of this system treats as authoritative.
--
-- Native DROP COLUMN: neither column is indexed, in a key, or named by a
-- constraint. Hand-written, per the Schema Rules — a generated drop emits a
-- twelve-step table rebuild that D1 cannot run.

ALTER TABLE `inspection_requests` DROP COLUMN `total_amount_cents`;--> statement-breakpoint
ALTER TABLE `inspection_requests` DROP COLUMN `payment_status`;
