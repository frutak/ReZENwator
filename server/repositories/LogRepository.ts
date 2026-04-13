import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { syncLogs, bookingActivities, syncStatus, type InsertBookingActivity } from "../../drizzle/schema";

export type SystemEventType = "ical" | "email";

export interface SystemEventResult {
  source: string;
  newBookings?: number;
  updatedBookings?: number;
  success: boolean;
  errorMessage?: string | null;
  durationMs?: number;
}

export class LogRepository {
  static async insertSystemLog(type: SystemEventType, result: SystemEventResult) {
    const db = await getDb();
    if (!db) return;

    await db.insert(syncLogs).values({
      syncType: type,
      source: result.source,
      newBookings: result.newBookings ?? 0,
      updatedBookings: result.updatedBookings ?? 0,
      success: result.success ? "true" : "false",
      errorMessage: result.errorMessage ?? null,
      durationMs: result.durationMs,
    });
  }

  static async updateSyncStatus(type: SystemEventType, result: SystemEventResult) {
    const db = await getDb();
    if (!db) return;

    const now = new Date();
    const insertValue = {
      source: result.source,
      syncType: type,
      lastSuccess: result.success ? now : null,
      lastAttempt: now,
      lastError: result.success ? null : (result.errorMessage ?? "Unknown error"),
      consecutiveFailures: result.success ? 0 : 1,
    };

    await db.insert(syncStatus).values(insertValue).onDuplicateKeyUpdate({
      set: {
        lastSuccess: result.success ? now : sql`lastSuccess`,
        lastAttempt: now,
        lastError: result.success ? null : (result.errorMessage ?? "Unknown error"),
        consecutiveFailures: result.success ? 0 : sql`consecutiveFailures + 1`,
      }
    });
  }

  static async insertBookingActivity(activity: InsertBookingActivity) {
    const db = await getDb();
    if (!db) return;
    await db.insert(bookingActivities).values(activity);
  }
}
