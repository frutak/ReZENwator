CREATE TABLE `bank_transfers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`externalId` varchar(512) NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`senderName` varchar(256) NOT NULL,
	`transferTitle` varchar(512) NOT NULL,
	`transferDate` datetime NOT NULL,
	`accountNumber` varchar(64),
	`currency` varchar(8) NOT NULL DEFAULT 'PLN',
	`status` enum('pending','matched','ignored') NOT NULL DEFAULT 'pending',
	`matchedBookingId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bank_transfers_id` PRIMARY KEY(`id`),
	CONSTRAINT `bank_transfers_externalId_unique` UNIQUE(`externalId`)
);
--> statement-breakpoint
CREATE INDEX `idx_transfer_status` ON `bank_transfers` (`status`);--> statement-breakpoint
CREATE INDEX `idx_transfer_date` ON `bank_transfers` (`transferDate`);