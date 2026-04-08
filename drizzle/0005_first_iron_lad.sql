ALTER TABLE `property_settings` ADD `petFee` int DEFAULT 200 NOT NULL;--> statement-breakpoint
ALTER TABLE `property_settings` ADD `peopleDiscount` json;--> statement-breakpoint
ALTER TABLE `property_settings` ADD `lastMinuteDiscount` decimal(4,2) DEFAULT '0.05' NOT NULL;--> statement-breakpoint
ALTER TABLE `property_settings` ADD `lastMinuteDays` int DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE `property_settings` ADD `stayDurationDiscounts` json;--> statement-breakpoint
ALTER TABLE `pricing_plans` ADD CONSTRAINT `idx_property_name` UNIQUE(`property`,`name`);