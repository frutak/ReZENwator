CREATE TABLE `sync_status` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source` varchar(256) NOT NULL,
	`syncType` enum('ical','email') NOT NULL,
	`lastSuccess` timestamp,
	`lastAttempt` timestamp NOT NULL DEFAULT (now()),
	`lastError` text,
	`consecutiveFailures` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sync_status_id` PRIMARY KEY(`id`),
	CONSTRAINT `sync_status_source_unique` UNIQUE(`source`)
);
