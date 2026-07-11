CREATE TABLE `cost_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`building_id` text,
	`instance_index` integer,
	`unit_id` text,
	`finding_key` text,
	`system` text NOT NULL,
	`component` text NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`action` text NOT NULL,
	`cost_method` text NOT NULL,
	`quantity` integer,
	`uom` text,
	`unit_cost_cents` integer,
	`lump_sum_cents` integer,
	`eul` integer,
	`eff_age` integer,
	`rul` integer,
	`suggested_remedy` text DEFAULT '' NOT NULL,
	`bucket` text NOT NULL,
	`section_ref` text,
	`photo_ref` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cost_items_tenant_inspection` ON `cost_items` (`tenant_id`,`inspection_id`);--> statement-breakpoint
CREATE INDEX `idx_cost_items_finding_key` ON `cost_items` (`finding_key`);