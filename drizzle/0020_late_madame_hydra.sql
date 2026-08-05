CREATE TABLE `processed_emails` (
	`id` int AUTO_INCREMENT NOT NULL,
	`messageId` varchar(512) NOT NULL,
	`subject` varchar(512),
	`processedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `processed_emails_id` PRIMARY KEY(`id`),
	CONSTRAINT `processed_emails_messageId_unique` UNIQUE(`messageId`)
);
--> statement-breakpoint
CREATE INDEX `idx_processed_at` ON `processed_emails` (`processedAt`);--> statement-breakpoint
ALTER TABLE `guest_reply_drafts` MODIFY COLUMN `matchMethod` enum('email','name','ambiguous','none') NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_guestName` ON `bookings` (`guestName`);
