ALTER TABLE `bank_transfers` MODIFY COLUMN `status` enum('pending','matched','ignored','split') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `bank_transfers` ADD `parentTransferId` int;--> statement-breakpoint
CREATE INDEX `idx_transfer_parent` ON `bank_transfers` (`parentTransferId`);