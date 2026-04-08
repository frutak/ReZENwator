ALTER TABLE `property_ratings` MODIFY COLUMN `portal` enum('booking','airbnb','slowhop','alohacamp','google') NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `propertyAccess` varchar(64);--> statement-breakpoint
ALTER TABLE `users` ADD `viewAccess` varchar(64);