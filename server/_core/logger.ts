import { LogRepository, type SystemEventType, type SystemEventResult } from "../repositories/LogRepository";
import type { InsertBookingActivity } from "../../drizzle/schema";

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
    try {
      await LogRepository.insertSystemLog(type, result);
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
    try {
      await LogRepository.updateSyncStatus(type, result);
    } catch (err) {
      console.error(`[Logger] Failed to update sync status for ${result.source}:`, err);
    }
  },

  /**
   * Logs a specific activity for a single booking.
   */
  async booking(activity: InsertBookingActivity) {
    try {
      await LogRepository.insertBookingActivity(activity);
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
