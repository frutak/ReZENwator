import { and, desc, eq, gte, lte, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { bookings, syncLogs, users } from "../drizzle/schema";
import type { InsertUser, InsertBooking } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── User helpers ─────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }

  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
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

// ─── Booking helpers ──────────────────────────────────────────────────────────

export type BookingFilters = {
  property?: "Sadoles" | "Hacjenda";
  channel?: "slowhop" | "airbnb" | "booking" | "alohacamp" | "direct";
  status?: "pending" | "confirmed" | "paid" | "finished";
  depositStatus?: "pending" | "paid" | "returned" | "not_applicable";
  checkInFrom?: Date;
  checkInTo?: Date;
  limit?: number;
  offset?: number;
};

export async function getBookings(filters: BookingFilters = {}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (filters.property) conditions.push(eq(bookings.property, filters.property));
  if (filters.channel) conditions.push(eq(bookings.channel, filters.channel));
  if (filters.status) conditions.push(eq(bookings.status, filters.status));
  if (filters.depositStatus) conditions.push(eq(bookings.depositStatus, filters.depositStatus));
  if (filters.checkInFrom) conditions.push(gte(bookings.checkIn, filters.checkInFrom));
  if (filters.checkInTo) conditions.push(lte(bookings.checkIn, filters.checkInTo));

  const query = db
    .select()
    .from(bookings)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
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
  status: "pending" | "confirmed" | "paid" | "finished"
) {
  const db = await getDb();
  if (!db) return;
  await db.update(bookings).set({ status }).where(eq(bookings.id, id));
}

export async function updateDepositStatus(
  id: number,
  depositStatus: "pending" | "paid" | "returned" | "not_applicable"
) {
  const db = await getDb();
  if (!db) return;
  await db.update(bookings).set({ depositStatus }).where(eq(bookings.id, id));
}

export async function updateBookingNotes(id: number, notes: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(bookings).set({ notes }).where(eq(bookings.id, id));
}

export async function getBookingStats(filters: {
  property?: "Sadoles" | "Hacjenda";
  channel?: "slowhop" | "airbnb" | "booking" | "alohacamp" | "direct";
  timeRange?: "month" | "3months" | "6months" | "year" | "all";
} = {}) {
  const db = await getDb();
  if (!db) return null;

  let all = await db.select({
    id: bookings.id,
    status: bookings.status,
    property: bookings.property,
    channel: bookings.channel,
    checkIn: bookings.checkIn,
    checkOut: bookings.checkOut,
    totalPrice: bookings.totalPrice,
    hostRevenue: bookings.hostRevenue,
  }).from(bookings);

  const now = new Date();
  
  // Apply property/channel filters
  if (filters.property) {
    all = all.filter(b => b.property === filters.property);
  }
  if (filters.channel) {
    all = all.filter(b => b.channel === filters.channel);
  }

  // Determine time window
  let startDate: Date | null = null;
  let endDate: Date | null = null;

  if (filters.timeRange === "month") {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  } else if (filters.timeRange === "3months") {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 3, 0);
  } else if (filters.timeRange === "6months") {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 6, 0);
  } else if (filters.timeRange === "year" || !filters.timeRange) {
    startDate = new Date(now.getFullYear(), 0, 1);
    endDate = new Date(now.getFullYear(), 11, 31);
  }

  // Filter by time window if applicable
  const filtered = all.filter(b => {
    if (!startDate || !endDate) return true;
    const cin = new Date(b.checkIn);
    return cin >= startDate && cin <= endDate;
  });

  const upcoming = filtered.filter((b) => new Date(b.checkIn) > now && b.status !== "finished");
  const active = filtered.filter((b) => {
    const cin = new Date(b.checkIn);
    const cout = new Date(b.checkOut);
    return cin <= now && cout >= now;
  });
  
  const totalRevenue = filtered
    .filter((b) => ["confirmed", "paid", "finished"].includes(b.status))
    .reduce((sum, b) => sum + (parseFloat(String(b.hostRevenue ?? b.totalPrice ?? "0")) || 0), 0);

  return {
    total: filtered.length,
    upcoming: upcoming.length,
    active: active.length,
    paid: filtered.filter((b) => b.status === "paid" || b.status === "finished").length,
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
