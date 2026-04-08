ALTER TABLE `users` MODIFY COLUMN `openId` varchar(64);--> statement-breakpoint
ALTER TABLE `bookings` ADD `purpose` varchar(128) DEFAULT 'leisure';--> statement-breakpoint
ALTER TABLE `bookings` ADD `companyName` varchar(256);--> statement-breakpoint
ALTER TABLE `bookings` ADD `nip` varchar(32);--> statement-breakpoint
ALTER TABLE `bookings` ADD `reservationFee` decimal(10,2);--> statement-breakpoint
ALTER TABLE `users` ADD `username` varchar(64);--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` text;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_username_unique` UNIQUE(`username`);