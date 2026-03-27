import { getDb } from "./server/db";
import { bookings } from "./drizzle/schema";
import { like, or } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("No DB");
    return;
  }
  const data = await db.select().from(bookings).where(
    or(
      like(bookings.guestName, "%Harasimiuk%"),
      like(bookings.icalSummary, "%Harasimiuk%")
    )
  );
  console.log(JSON.stringify(data, null, 2));
}
main();
