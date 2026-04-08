import { and, desc, eq, gte, lte, or, ne, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { bookings, syncLogs, users, propertyRatings, bookingActivities, systemSettings } from "../drizzle/schema";
import type { InsertUser, InsertBooking } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { Logger } from "./_core/logger";

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

// ─── User helpers ─────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }

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
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByUsername(username: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Booking helpers ──────────────────────────────────────────────────────────

export type BookingFilters = {
  property?: "Sadoles" | "Hacjenda";
  channel?: "slowhop" | "airbnb" | "booking" | "alohacamp" | "direct";
  status?: "pending" | "confirmed" | "portal_paid" | "paid" | "finished" | "cancelled";
  depositStatus?: "pending" | "paid" | "returned" | "not_applicable";
  checkInFrom?: Date;
  checkInTo?: Date;
  timeRange?: "month" | "next_month" | "3months" | "6months" | "year" | "all";
  limit?: number;
  offset?: number;
};

export async function getBookings(filters: BookingFilters = {}) {
  const db = await getDb();
  if (!db) return [];

  const now = new Date();
  let startDate = filters.checkInFrom;
  let endDate = filters.checkInTo;

  if (filters.timeRange === "month") {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  } else if (filters.timeRange === "next_month") {
    startDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59);
  } else if (filters.timeRange === "3months") {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 3, 0, 23, 59, 59);
  } else if (filters.timeRange === "6months") {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 6, 0, 23, 59, 59);
  } else if (filters.timeRange === "year") {
    startDate = new Date(now.getFullYear(), 0, 1);
    endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
  }

  const conditions = [];
  if (filters.property) conditions.push(eq(bookings.property, filters.property));
  if (filters.channel) conditions.push(eq(bookings.channel, filters.channel));
  if (filters.status) {
    conditions.push(eq(bookings.status, filters.status));
  }
  if (filters.depositStatus) conditions.push(eq(bookings.depositStatus, filters.depositStatus));
  if (startDate) conditions.push(gte(bookings.checkIn, startDate));
  if (endDate) conditions.push(lte(bookings.checkIn, endDate));

  const query = db
    .select()
    .from(bookings)
    .where(
      and(
        ...conditions,
        // If no status filter is provided, exclude cancelled by default.
        !filters.status ? ne(bookings.status, "cancelled") : undefined
      )
    )
    .orderBy(desc(bookings.checkIn))
    .limit(filters.limit ?? 200)
    .offset(filters.offset ?? 0);

  return query;
}

export async function getBookingById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
  return result[0] ?? null;
}

export async function updateBookingStatus(
  id: number,
  status: "pending" | "confirmed" | "portal_paid" | "paid" | "finished" | "cancelled"
) {
  const db = await getDb();
  if (!db) return;
  await db.update(bookings).set({ status }).where(eq(bookings.id, id));
  
  await Logger.bookingAction(id, "status_change", `Status updated to ${status}`);
}

export async function updateDepositStatus(
  id: number,
  depositStatus: "pending" | "paid" | "returned" | "not_applicable"
) {
  const db = await getDb();
  if (!db) return;
  await db.update(bookings).set({ depositStatus }).where(eq(bookings.id, id));

  await Logger.bookingAction(id, "status_change", `Deposit status updated to ${depositStatus}`);
}

export async function updateBookingNotes(id: number, notes: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(bookings).set({ notes }).where(eq(bookings.id, id));

  await Logger.bookingAction(id, "manual_edit", "Updated booking notes");
}

export async function getBookingStats(filters: {
  property?: "Sadoles" | "Hacjenda";
  channel?: "slowhop" | "airbnb" | "booking" | "alohacamp" | "direct";
  status?: ("pending" | "confirmed" | "portal_paid" | "paid" | "finished" | "cancelled")[];
  timeRange?: "month" | "next_month" | "3months" | "6months" | "year" | "all";
} = {}) {
  const db = await getDb();
  if (!db) return null;

  const now = new Date();
  let startDate: Date | null = null;
  let endDate: Date | null = null;

  if (filters.timeRange === "month") {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  } else if (filters.timeRange === "next_month") {
    startDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59);
  } else if (filters.timeRange === "3months") {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 3, 0, 23, 59, 59);
  } else if (filters.timeRange === "6months") {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 6, 0, 23, 59, 59);
  } else if (filters.timeRange === "year" || !filters.timeRange) {
    startDate = new Date(now.getFullYear(), 0, 1);
    endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
  }

  const conditions = [];
  if (filters.property) conditions.push(eq(bookings.property, filters.property));
  if (filters.channel) conditions.push(eq(bookings.channel, filters.channel));
  if (filters.status && filters.status.length > 0) {
    conditions.push(inArray(bookings.status, filters.status));
  }
  if (startDate) conditions.push(gte(bookings.checkIn, startDate));
  if (endDate) conditions.push(lte(bookings.checkIn, endDate));

  const filtered = await db.select({
    id: bookings.id,
    status: bookings.status,
    property: bookings.property,
    channel: bookings.channel,
    checkIn: bookings.checkIn,
    checkOut: bookings.checkOut,
    guestCountry: bookings.guestCountry,
    totalPrice: bookings.totalPrice,
    hostRevenue: bookings.hostRevenue,
  }).from(bookings).where(
    and(
      ...conditions,
      // If no status filter is provided, exclude cancelled by default.
      // If a specific status IS provided (even 'cancelled'), we use it.
      !filters.status || filters.status.length === 0 ? ne(bookings.status, "cancelled") : undefined
    )
  );

  const upcoming = filtered.filter((b) => new Date(b.checkIn) > now && b.status !== "finished");
  const active = filtered.filter((b) => {
    const cin = new Date(b.checkIn);
    const cout = new Date(b.checkOut);
    return cin <= now && cout >= now;
  });
  
  const totalRevenue = filtered
    .filter((b) => ["confirmed", "portal_paid", "paid", "finished"].includes(b.status as string))
    .reduce((sum, b) => sum + (parseFloat(String(b.hostRevenue ?? b.totalPrice ?? "0")) || 0), 0);

  return {
    total: filtered.length,
    upcoming: upcoming.length,
    active: active.length,
    paid: filtered.filter((b) => b.status === "paid" || b.status === "finished" || b.status === "portal_paid").length,
    pending: filtered.filter((b) => b.status === "pending").length,
    confirmed: filtered.filter((b) => b.status === "confirmed").length,
    finished: filtered.filter((b) => b.status === "finished").length,
    totalRevenue: Math.round(totalRevenue),
  };
}

// ─── Sync log helpers ─────────────────────────────────────────────────────────

export async function getRecentSyncLogs(limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(syncLogs)
    .orderBy(desc(syncLogs.createdAt))
    .limit(limit);
}

export async function getLastSyncTime(syncType: "ical" | "email") {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select({ createdAt: syncLogs.createdAt })
    .from(syncLogs)
    .where(and(eq(syncLogs.syncType, syncType), eq(syncLogs.success, "true")))
    .orderBy(desc(syncLogs.createdAt))
    .limit(1);
  return result[0]?.createdAt ?? null;
}

export async function getPropertyRatings(property: "Sadoles" | "Hacjenda") {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(propertyRatings)
    .where(eq(propertyRatings.property, property));
}

export async function getBookingActivities(bookingId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(bookingActivities)
    .where(eq(bookingActivities.bookingId, bookingId))
    .orderBy(desc(bookingActivities.createdAt));
}

// ─── System settings helpers ──────────────────────────────────────────────────

export async function getSystemSetting(key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  return result[0]?.value ?? null;
}

export async function setSystemSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(systemSettings).values({ key, value }).onDuplicateKeyUpdate({ set: { value } });
}

import { ENV } from "./_core/env";

/**
 * Gets the admin email from system settings, falling back to a configured default.
 */
export async function getAdminEmail(): Promise<string> {
  const email = await getSystemSetting("ADMIN_EMAIL");
  return email || ENV.adminEmail;
}
