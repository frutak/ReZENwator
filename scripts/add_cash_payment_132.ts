/**
 * One-off: record a CASH payment for booking #132 as a matched bank transfer.
 *
 * On 2026-07-17 the owner received 3430 PLN in cash from guest BORYS
 * BARYSHPOLSKYY (Sadoles, direct) covering the remaining stay balance (2930)
 * plus the deposit (500). There is no bank-notification email for cash, so we
 * synthesize a `bank_transfers` row and match it exactly the way `manualMatch`
 * does: applyTransferMatch (updates booking payment/status) + updateTransferStatus.
 *
 * Idempotent via the unique externalId — re-running is a no-op.
 *
 * Usage: npx tsx scripts/add_cash_payment_132.ts
 */
import "dotenv/config";
import { getDb, pool } from "../server/db";
import { bankTransfers, bookings } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { BankTransferRepository } from "../server/repositories/BankTransferRepository";
import { applyTransferMatch } from "../server/workers/bookingMatcher";
import { type ParsedBankData } from "../server/workers/emailParsers";

const BOOKING_ID = 132;
const AMOUNT = "3430.00";
const EXTERNAL_ID = "cash-132-2026-07-17";
const TRANSFER_DATE = new Date("2026-07-17T12:00:00Z");

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database not initialized");

  const before = await db.select().from(bookings).where(eq(bookings.id, BOOKING_ID));
  if (!before[0]) throw new Error(`Booking #${BOOKING_ID} not found`);
  console.log("Booking BEFORE:", {
    status: before[0].status,
    depositStatus: before[0].depositStatus,
    amountPaid: before[0].amountPaid,
  });

  const parsed: ParsedBankData = {
    amount: parseFloat(AMOUNT),
    currency: "PLN",
    senderName: "BORYS BARYSHPOLSKYY",
    transferTitle: "GOTOWKA / CASH - pobyt + kaucja #132",
    transferDate: TRANSFER_DATE,
    accountNumber: "",
  };

  // 1. Create the transfer ledger row (defaults to status=pending).
  const { inserted } = await BankTransferRepository.insertTransfer({
    externalId: EXTERNAL_ID,
    amount: AMOUNT,
    senderName: parsed.senderName,
    transferTitle: parsed.transferTitle,
    transferDate: TRANSFER_DATE,
    accountNumber: "",
    currency: "PLN",
    status: "pending",
  });

  if (!inserted) {
    console.log(`Transfer '${EXTERNAL_ID}' already exists — skipping (idempotent no-op).`);
    return;
  }

  const [row] = await db.select().from(bankTransfers).where(eq(bankTransfers.externalId, EXTERNAL_ID)).limit(1);

  // 2. Apply the match to the booking (mirrors manualMatch).
  await applyTransferMatch(BOOKING_ID, parsed, 100);
  await BankTransferRepository.updateTransferStatus(row.id, "matched", BOOKING_ID);

  const after = await db.select().from(bookings).where(eq(bookings.id, BOOKING_ID));
  console.log("Booking AFTER:", {
    status: after[0].status,
    depositStatus: after[0].depositStatus,
    amountPaid: after[0].amountPaid,
  });
  console.log(`Transfer #${row.id} created (${AMOUNT} PLN, ${TRANSFER_DATE.toISOString().slice(0, 10)}), matched to booking #${BOOKING_ID}.`);
}

main()
  .then(() => pool?.end())
  .catch((err) => {
    console.error(err);
    pool?.end();
    process.exit(1);
  });
