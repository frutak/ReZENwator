
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { syncLogs, bookingActivities, syncStatus } from "../../drizzle/schema";
import type { InsertBookingActivity } from "../../drizzle/schema";

/**
 * High-level system event types for sync logs.
 */
export type SystemEventType = "ical" | "email";

/**
 * Result of a system event.
 */
export interface SystemEventResult {
  source: string;
  newBookings?: number;
  updatedBookings?: number;
  success: boolean;
  errorMessage?: string | null;
  durationMs?: number;
}

/**
 * Unified Logger
 *
 * Provides a consistent interface for logging system-wide events (sync_logs)
 * and specific booking-related activities (booking_activities).
 */
export const Logger = {
  /**
   * Logs a high-level system event (e.g., iCal poll, Email poll).
   */
  async system(type: SystemEventType, result: SystemEventResult) {
    const db = await getDb();
    if (!db) return;

    try {
      await db.insert(syncLogs).values({
        syncType: type,
        source: result.source,
        newBookings: result.newBookings ?? 0,
        updatedBookings: result.updatedBookings ?? 0,
        success: result.success ? "true" : "false",
        errorMessage: result.errorMessage ?? null,
        durationMs: result.durationMs,
      });

      // Also update the summary status table
      await this.updateStatus(type, result);
    } catch (err) {
      console.error(`[Logger] Failed to write system log for ${type}:`, err);
    }
  },

  /**
   * Updates the sync_status table with the results of a sync run.
   */
  async updateStatus(type: SystemEventType, result: SystemEventResult) {
    const db = await getDb();
    if (!db) return;

    try {
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
    } catch (err) {
      console.error(`[Logger] Failed to update sync status for ${result.source}:`, err);
    }
  },

  /**
   * Logs a specific activity for a single booking.
   */
  async booking(activity: InsertBookingActivity) {
    const db = await getDb();
    if (!db) return;

    try {
      await db.insert(bookingActivities).values(activity);
    } catch (err) {
      console.error(`[Logger] Failed to log booking activity for #${activity.bookingId}:`, err);
    }
  },

  /**
   * Convenience helper for common booking actions.
   */
  async bookingAction(
    bookingId: number, 
    type: InsertBookingActivity["type"], 
    action: string, 
    details?: string
  ) {
    return this.booking({
      bookingId,
      type,
      action,
      details: details ?? null,
    });
  }
};
