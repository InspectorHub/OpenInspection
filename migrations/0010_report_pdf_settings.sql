ALTER TABLE `tenant_configs` ADD `company_address` text;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `pdf_show_footer` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `pdf_show_page_numbers` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `pdf_show_license` integer DEFAULT true NOT NULL;