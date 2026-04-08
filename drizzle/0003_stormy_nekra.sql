CREATE TABLE `booking_activities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`type` enum('email','enrichment','manual_edit','status_change','system') NOT NULL,
	`action` varchar(256) NOT NULL,
	`details` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `booking_activities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `guest_emails` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`emailType` enum('booking_confirmed','arrival_reminder','stay_finished','missing_country_alert','missing_data_alert') NOT NULL,
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	`recipient` varchar(320) NOT NULL,
	`success` enum('true','false') NOT NULL DEFAULT 'true',
	`errorMessage` text,
	CONSTRAINT `guest_emails_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `property_ratings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`property` enum('Sadoles','Hacjenda') NOT NULL,
	`portal` enum('booking','airbnb','slowhop') NOT NULL,
	`rating` decimal(3,2) NOT NULL,
	`count` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `property_ratings_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_property_portal` UNIQUE(`property`,`portal`)
);
--> statement-breakpoint
ALTER TABLE `bookings` MODIFY COLUMN `status` enum('pending','confirmed','portal_paid','paid','finished','cancelled') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `bookings` ADD `guestCountry` varchar(128);--> statement-breakpoint
ALTER TABLE `bookings` ADD `depositAmount` decimal(10,2) DEFAULT '500.00';--> statement-breakpoint
ALTER TABLE `bookings` ADD `commission` decimal(10,2) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `bookings` ADD `reminderSent` int DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_booking_id` ON `booking_activities` (`bookingId`);