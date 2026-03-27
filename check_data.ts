import { getDb } from "./server/db";
import { bookings } from "./drizzle/schema";

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("No DB");
    return;
  }
  const data = await db.select().from(bookings).limit(5);
  console.log(JSON.stringify(data, null, 2));
}
main();
