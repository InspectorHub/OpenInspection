ALTER TABLE `tenants` RENAME COLUMN `subdomain` TO `slug`;--> statement-breakpoint
DROP INDEX `tenants_subdomain_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_slug_unique` ON `tenants` (`slug`);
