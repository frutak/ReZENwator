CREATE TABLE `calendar_pricing` (
	`id` int AUTO_INCREMENT NOT NULL,
	`property` enum('Sadoles','Hacjenda') NOT NULL,
	`date` datetime NOT NULL,
	`planId` int NOT NULL,
	CONSTRAINT `calendar_pricing_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_property_date` UNIQUE(`property`,`date`)
);
--> statement-breakpoint
CREATE TABLE `pricing_plans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`property` enum('Sadoles','Hacjenda') NOT NULL,
	`name` varchar(128) NOT NULL,
	`nightlyPrice` int NOT NULL,
	`minStay` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pricing_plans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `property_settings` (
	`property` enum('Sadoles','Hacjenda') NOT NULL,
	`fixedBookingPrice` int NOT NULL DEFAULT 800,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `property_settings_property` PRIMARY KEY(`property`)
);
--> statement-breakpoint
CREATE INDEX `idx_plan_id` ON `calendar_pricing` (`planId`);