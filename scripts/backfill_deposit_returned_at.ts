/**
 * One-off: give the nine returned kaucje that have no cash-out date one.
 *
 * `depositReturnedAt` is what the free-cashflow view reads, and until
 * 2026-09-02 only `updateDepositStatus` stamped it — a method the dashboard
 * never calls. The modal saves the whole form through `updateBookingDetails`,
 * which wrote the column raw, so every kaucja returned from the UI ended up
 * `returned` with no date: nine bookings, 4500 zł that never left the cashflow.
 * The stamp now lives on the column (BookingRepository.withDepositReturnStamp),
 * which fixes it going forward but not backwards — and worse, the first save of
 * any of these nine would now stamp *today*, dropping a July return into
 * September.
 *
 * The true dates are not recoverable. The convention is the one already applied
 * to the eleven older rows, to the hour: checkout + 3 days.
 *
 * #157 is the one exception, and deliberately: checkout + 3 days would fall on
 * 1 September, while its activity log (entry 2655) and the price refund recorded
 * against it both put the correction on 31 August. Splitting one bank transfer
 * across two months to satisfy a convention would be the wrong trade.
 *
 * Idempotent: only ever fills a NULL, never moves an existing date.
 *
 * Usage: npx tsx scripts/backfill_deposit_returned_at.ts [--apply]
 */
import "dotenv/config";
import { getDb, pool } from "../server/db";
import { bookings } from "../drizzle/schema";
import { and, eq, isNull, sql } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");
const DAYS_AFTER_CHECKOUT = 3;
/** Booking #157: the day the correction was actually made. See above. */
const OVERRIDES: Record<number, Date> = { 157: new Date("2026-08-31T12:00:00Z") };

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database not initialized");

  const rows = await db
    .select({
      id: bookings.id,
      guestName: bookings.guestName,
      checkOut: bookings.checkOut,
      depositAmount: bookings.depositAmount,
    })
    .from(bookings)
    .where(and(eq(bookings.depositStatus, "returned"), isNull(bookings.depositReturnedAt)));

  if (rows.length === 0) {
    console.log("Nothing to backfill — every returned kaucja already has a date.");
    return;
  }

  const plan = rows.map((r) => {
    const fallback = new Date(new Date(r.checkOut).getTime() + DAYS_AFTER_CHECKOUT * 86_400_000);
    const at = OVERRIDES[r.id] ?? fallback;
    return { ...r, at, overridden: r.id in OVERRIDES };
  });

  console.table(
    plan.map((p) => ({
      id: p.id,
      guest: p.guestName,
      checkOut: p.checkOut.toISOString().slice(0, 16).replace("T", " "),
      returnedAt: p.at.toISOString().slice(0, 16).replace("T", " "),
      month: p.at.toISOString().slice(0, 7),
      zl: p.depositAmount,
      note: p.overridden ? "override" : "",
    }))
  );

  if (!APPLY) {
    console.log(`DRY RUN — ${plan.length} bookings. Re-run with --apply to write.`);
    return;
  }

  for (const p of plan) {
    // The NULL guard makes a re-run a no-op and stops this racing a real return
    // stamped between the read above and the write here.
    await db
      .update(bookings)
      .set({ depositReturnedAt: p.at })
      .where(and(eq(bookings.id, p.id), isNull(bookings.depositReturnedAt)));
  }

  const left = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(bookings)
    .where(and(eq(bookings.depositStatus, "returned"), isNull(bookings.depositReturnedAt)));
  console.log(`Backfilled ${plan.length}. Returned kaucje still without a date: ${left[0].n}`);
}

main()
  .then(() => pool?.end())
  .catch((err) => {
    console.error(err);
    pool?.end();
    process.exit(1);
  });
