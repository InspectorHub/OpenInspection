ALTER TABLE `messaging_compliance` RENAME COLUMN "messaging_service_sid" TO "messaging_resource_sid";--> statement-breakpoint
ALTER TABLE `messaging_compliance` ADD `provider_meta` text;