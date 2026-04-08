
import { getDb } from "../server/db";
import { bookings } from "../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { setHours, setMinutes } from "date-fns";

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("Database not available");
    process.exit(1);
  }

  console.log("Fetching all bookings...");
  const allBookings = await db.select().from(bookings);
  
  let updatedCount = 0;

  for (const b of allBookings) {
    let needsUpdate = false;
    let newCheckIn = new Date(b.checkIn);
    let newCheckOut = new Date(b.checkOut);

    // If time is 00:00, set to default 16:00
    if (newCheckIn.getHours() === 0 && newCheckIn.getMinutes() === 0) {
      newCheckIn = setMinutes(setHours(newCheckIn, 16), 0);
      needsUpdate = true;
    }

    // If time is 00:00, set to default 10:00
    if (newCheckOut.getHours() === 0 && newCheckOut.getMinutes() === 0) {
      newCheckOut = setMinutes(setHours(newCheckOut, 10), 0);
      needsUpdate = true;
    }

    if (needsUpdate) {
      await db.update(bookings)
        .set({ 
          checkIn: newCheckIn, 
          checkOut: newCheckOut 
        })
        .where(eq(bookings.id, b.id));
      updatedCount++;
    }
  }

  console.log(`Finished. Updated ${updatedCount} bookings with default times.`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
