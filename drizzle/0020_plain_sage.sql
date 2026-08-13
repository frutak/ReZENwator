-- Trimmed to what was actually applied.
--
-- `drizzle-kit generate` also emitted a CREATE TABLE for `processed_emails` and
-- a MODIFY on `guest_reply_drafts.matchMethod`; both already exist on the live
-- database. That is the known journal drift documented in DEPLOYMENT.md — the
-- generator replays from an out-of-sync baseline, and `drizzle-kit migrate`
-- fails on it. These two statements were applied by hand with the backfill in
-- scripts/backfill_transfer_content_key.ts.

ALTER TABLE `bank_transfers` ADD `contentKey` varchar(64);--> statement-breakpoint
ALTER TABLE `bank_transfers` ADD CONSTRAINT `bank_transfers_contentKey_unique` UNIQUE(`contentKey`);
