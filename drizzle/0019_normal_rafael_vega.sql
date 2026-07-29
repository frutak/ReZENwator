CREATE TABLE `guest_reply_drafts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`inboundMessageId` varchar(512) NOT NULL,
	`bookingId` int,
	`matchMethod` enum('email','ambiguous','none') NOT NULL,
	`inboundFrom` varchar(320) NOT NULL,
	`inboundSubject` varchar(512),
	`inboundBody` text,
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	`status` enum('new','scheduled','pending','sending','sent','cancelled','rejected','failed') NOT NULL DEFAULT 'new',
	`intent` varchar(64),
	`needsHuman` int NOT NULL DEFAULT 0,
	`missingInfo` json,
	`draftSubject` varchar(512),
	`draftBody` text,
	`draftLanguage` enum('PL','EN'),
	`provider` varchar(64),
	`modelNotes` text,
	`proposedAnimalsCount` int,
	`sendAfter` timestamp,
	`editedBody` text,
	`sentAt` timestamp,
	`sentMessageId` varchar(512),
	`cancelledBy` varchar(32),
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `guest_reply_drafts_id` PRIMARY KEY(`id`),
	CONSTRAINT `guest_reply_drafts_inboundMessageId_unique` UNIQUE(`inboundMessageId`)
);
--> statement-breakpoint
CREATE INDEX `idx_reply_status` ON `guest_reply_drafts` (`status`);--> statement-breakpoint
CREATE INDEX `idx_reply_booking` ON `guest_reply_drafts` (`bookingId`);--> statement-breakpoint
CREATE INDEX `idx_reply_received` ON `guest_reply_drafts` (`receivedAt`);--> statement-breakpoint
CREATE INDEX `idx_guestEmail` ON `bookings` (`guestEmail`);