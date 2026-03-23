CREATE TABLE `bookings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`icalUid` varchar(512) NOT NULL,
	`property` enum('Sadoles','Hacjenda') NOT NULL,
	`channel` enum('slowhop','airbnb','booking','alohacamp','direct') NOT NULL,
	`checkIn` datetime NOT NULL,
	`checkOut` datetime NOT NULL,
	`status` enum('pending','confirmed','paid','finished') NOT NULL DEFAULT 'pending',
	`depositStatus` enum('pending','paid','returned','not_applicable') NOT NULL DEFAULT 'pending',
	`guestName` varchar(256),
	`guestEmail` varchar(320),
	`guestPhone` varchar(64),
	`guestCount` int,
	`adultsCount` int,
	`childrenCount` int,
	`animalsCount` int,
	`totalPrice` decimal(10,2),
	`hostRevenue` decimal(10,2),
	`currency` varchar(8) DEFAULT 'PLN',
	`transferAmount` decimal(10,2),
	`transferSender` varchar(256),
	`transferTitle` varchar(512),
	`transferDate` datetime,
	`matchScore` int,
	`icalSummary` text,
	`emailMessageId` varchar(512),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bookings_id` PRIMARY KEY(`id`),
	CONSTRAINT `bookings_icalUid_unique` UNIQUE(`icalUid`)
);
--> statement-breakpoint
CREATE TABLE `sync_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`syncType` enum('ical','email') NOT NULL,
	`source` varchar(256) NOT NULL,
	`newBookings` int NOT NULL DEFAULT 0,
	`updatedBookings` int NOT NULL DEFAULT 0,
	`success` enum('true','false') NOT NULL DEFAULT 'true',
	`errorMessage` text,
	`durationMs` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sync_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_property` ON `bookings` (`property`);--> statement-breakpoint
CREATE INDEX `idx_channel` ON `bookings` (`channel`);--> statement-breakpoint
CREATE INDEX `idx_status` ON `bookings` (`status`);--> statement-breakpoint
CREATE INDEX `idx_checkIn` ON `bookings` (`checkIn`);--> statement-breakpoint
CREATE INDEX `idx_checkOut` ON `bookings` (`checkOut`);