CREATE TABLE `expenses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`property` enum('Sadoles','Hacjenda') NOT NULL,
	`type` enum('utility','purchase') NOT NULL,
	`category` varchar(128) NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`paymentDate` datetime NOT NULL,
	`startDate` datetime,
	`endDate` datetime,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `expenses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `monthly_adjustments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`property` enum('Sadoles','Hacjenda') NOT NULL,
	`month` varchar(7) NOT NULL,
	`amount` decimal(10,2) NOT NULL DEFAULT '0.00',
	`category` varchar(128) NOT NULL DEFAULT 'extra_cleaning',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `monthly_adjustments_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_prop_month_cat` UNIQUE(`property`,`month`,`category`)
);
--> statement-breakpoint
ALTER TABLE `bookings` ADD `type` enum('normal','block','internal') DEFAULT 'normal' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_expense_property` ON `expenses` (`property`);--> statement-breakpoint
CREATE INDEX `idx_expense_type` ON `expenses` (`type`);--> statement-breakpoint
CREATE INDEX `idx_expense_payment_date` ON `expenses` (`paymentDate`);