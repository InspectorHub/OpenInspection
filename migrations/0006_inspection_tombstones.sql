CREATE TABLE `inspection_tombstones` (
	`tenant_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`deleted_at` integer NOT NULL,
	PRIMARY KEY(`tenant_id`, `inspection_id`)
);
