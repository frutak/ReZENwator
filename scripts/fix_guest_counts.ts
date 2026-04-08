
import { getDb } from "../server/db";
import { bookings } from "../drizzle/schema";
import { eq, sql, and, gt } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("Database not available");
    process.exit(1);
  }

  console.log("Checking for bookings with guestCount=0 but adults+children > 0...");
  
  // We look for guestCount=0 or null, where (adultsCount + childrenCount) > 0
  const candidates = await db.select().from(bookings).where(
    and(
      sql`(${bookings.guestCount} = 0 OR ${bookings.guestCount} IS NULL)`,
      sql`(${bookings.adultsCount} + ${bookings.childrenCount}) > 0`
    )
  );

  console.log(`Found ${candidates.length} candidates for update.`);
  
  let updatedCount = 0;

  for (const b of candidates) {
    const adults = b.adultsCount ?? 0;
    const children = b.childrenCount ?? 0;
    const total = adults + children;

    if (total > 0) {
      await db.update(bookings)
        .set({ guestCount: total })
        .where(eq(bookings.id, b.id));
      updatedCount++;
    }
  }

  console.log(`Finished. Updated ${updatedCount} bookings with corrected guest counts.`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
