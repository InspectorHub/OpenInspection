ALTER TABLE `inspections` ADD `require_defect_fields_override` text;--> statement-breakpoint
ALTER TABLE `tenant_configs` ADD `require_defect_fields` text DEFAULT 'none' NOT NULL;