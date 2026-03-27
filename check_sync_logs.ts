import { getDb } from "./server/db";
import { syncLogs } from "./drizzle/schema";
import { desc } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("No DB");
    return;
  }
  const logs = await db.select()
    .from(syncLogs)
    .where((table) => ({
      syncType: "email"
    }))
    .orderBy(desc(syncLogs.createdAt))
    .limit(5);
    
  console.log(JSON.stringify(logs, null, 2));
}
main();
