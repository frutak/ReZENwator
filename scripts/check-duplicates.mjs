import { drizzle } from "drizzle-orm/mysql2";
import { and, gte, lte } from "drizzle-orm";
import * as dotenv from "dotenv";
dotenv.config();

const db = drizzle(process.env.DATABASE_URL);

// Inline the bookings table definition to avoid TS import issues
import { createRequire } from "module";

// Use raw SQL via mysql2 directly
import mysql from "mysql2/promise";

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const [rows] = await conn.execute(
  `SELECT id, property, channel, checkIn, checkOut, icalUid 
   FROM bookings 
   WHERE property = 'Sadoles' 
   AND checkIn >= '2026-03-12' AND checkIn <= '2026-03-22'
   ORDER BY checkIn, id`
);

console.log("Duplicate candidates:");
console.table(rows);

// Also show all bookings with same property+checkIn+checkOut
const [dupes] = await conn.execute(
  `SELECT property, checkIn, checkOut, COUNT(*) as cnt, GROUP_CONCAT(id) as ids, GROUP_CONCAT(channel) as channels, GROUP_CONCAT(SUBSTRING(icalUid,1,60)) as uids
   FROM bookings
   GROUP BY property, checkIn, checkOut
   HAVING cnt > 1
   ORDER BY checkIn`
);
console.log("\nAll duplicate date groups:");
console.table(dupes);

await conn.end();
