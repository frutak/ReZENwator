import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

let _db: ReturnType<typeof drizzle> | null = null;
export let pool: mysql.Pool | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      pool = mysql.createPool({
        uri: process.env.DATABASE_URL,
        timezone: "Z"
      });
      
      // Force all database connections to use UTC time zone for NOW() and ON UPDATE NOW()
      pool.on("connection", (connection) => {
        connection.query("SET time_zone='+00:00'", (err) => {
          if (err) console.error("[Database] Failed to set time_zone:", err);
        });
      });

      _db = drizzle(pool);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}
