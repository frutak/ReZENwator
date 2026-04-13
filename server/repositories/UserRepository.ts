import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { users, type InsertUser } from "../../drizzle/schema";
import { ENV } from "../_core/env";

export class UserRepository {
  static async upsertUser(user: InsertUser): Promise<void> {
    const db = await getDb();
    if (!db) {
      console.warn("[UserRepository] Cannot upsert user: database not available");
      return;
    }

    try {
      const values: InsertUser = { ...user };
      const updateSet: Record<string, unknown> = {};
      const fields = ["name", "email", "loginMethod", "username", "passwordHash", "role", "lastSignedIn"] as const;
      
      fields.forEach((field) => {
        const value = (user as any)[field];
        if (value !== undefined) {
          updateSet[field] = value ?? null;
        }
      });

      if (user.openId === ENV.ownerOpenId && !user.role) {
        values.role = "admin";
        updateSet.role = "admin";
      }

      if (!values.lastSignedIn) values.lastSignedIn = new Date();
      if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

      await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
    } catch (error) {
      console.error("[UserRepository] Failed to upsert user:", error);
      throw error;
    }
  }

  static async getUserByOpenId(openId: string) {
    const db = await getDb();
    if (!db) return undefined;
    const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
    return result.length > 0 ? result[0] : undefined;
  }

  static async getUserByUsername(username: string) {
    const db = await getDb();
    if (!db) return undefined;
    const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
    return result.length > 0 ? result[0] : undefined;
  }
}
