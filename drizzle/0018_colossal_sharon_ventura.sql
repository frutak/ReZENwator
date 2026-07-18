ALTER TABLE `bookings` ADD `depositReturnedAt` timestamp;
--> statement-breakpoint
-- Backfill: existing returned deposits have no explicit return date (there is
-- no status-change history for these rows, and updatedAt is polluted by a
-- one-time bulk cleanup). Estimate the return as checkout + 3 days, which is
-- when deposits are returned in normal operation. Going forward
-- updateDepositStatus stamps this column at the actual moment of the change.
UPDATE `bookings` SET `depositReturnedAt` = DATE_ADD(`checkOut`, INTERVAL 3 DAY) WHERE `depositStatus` = 'returned';
