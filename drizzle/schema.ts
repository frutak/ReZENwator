import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  decimal,
  datetime,
  index,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Bookings table — central entity of the rental management system.
 */
export const bookings = mysqlTable(
  "bookings",
  {
    id: int("id").autoincrement().primaryKey(),

    // Core booking identity
    /** Unique identifier from the iCal feed (UID field) */
    icalUid: varchar("icalUid", { length: 512 }).notNull().unique(),
    /** Property name: "Sadoles" or "Hacjenda" */
    property: mysqlEnum("property", ["Sadoles", "Hacjenda"]).notNull(),
    /** Booking channel */
    channel: mysqlEnum("channel", [
      "slowhop",
      "airbnb",
      "booking",
      "alohacamp",
      "direct",
    ]).notNull(),

    // Dates
    checkIn: datetime("checkIn").notNull(),
    checkOut: datetime("checkOut").notNull(),

    // Booking status workflow
    status: mysqlEnum("status", [
      "pending",
      "confirmed",
      "paid_to_intermediary",
      "paid",
      "finished",
    ])
      .default("pending")
      .notNull(),

    // Deposit tracking (separate from booking payment)
    depositStatus: mysqlEnum("depositStatus", [
      "pending",
      "paid",
      "returned",
      "not_applicable",
    ])
      .default("pending")
      .notNull(),

    // Guest details (populated from email parsing)
    guestName: varchar("guestName", { length: 256 }),
    guestEmail: varchar("guestEmail", { length: 320 }),
    guestPhone: varchar("guestPhone", { length: 64 }),
    guestCount: int("guestCount"),
    adultsCount: int("adultsCount"),
    childrenCount: int("childrenCount"),
    animalsCount: int("animalsCount"),

    // Payments
    /** Total amount paid by the guest so far */
    amountPaid: decimal("amountPaid", { precision: 10, scale: 2 }).default("0.00"),

    // Pricing (populated from email parsing)
    /** Total price charged to the guest */
    totalPrice: decimal("totalPrice", { precision: 10, scale: 2 }),
    /** Net revenue to the host after commission */
    hostRevenue: decimal("hostRevenue", { precision: 10, scale: 2 }),
    /** Currency code, default PLN */
    currency: varchar("currency", { length: 8 }).default("PLN"),

    // Bank transfer matching
    /** Amount received via bank transfer */
    transferAmount: decimal("transferAmount", { precision: 10, scale: 2 }),
    /** Sender name from bank transfer */
    transferSender: varchar("transferSender", { length: 256 }),
    /** Transfer title/description from bank email */
    transferTitle: varchar("transferTitle", { length: 512 }),
    /** Date of bank transfer */
    transferDate: datetime("transferDate"),
    /** Fuzzy match confidence score 0-100 */
    matchScore: int("matchScore"),

    // Source tracking
    /** Raw iCal summary line */
    icalSummary: text("icalSummary"),
    /** Email message ID that enriched this booking */
    emailMessageId: varchar("emailMessageId", { length: 512 }),

    // Notes
    notes: text("notes"),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("idx_property").on(table.property),
    index("idx_channel").on(table.channel),
    index("idx_status").on(table.status),
    index("idx_checkIn").on(table.checkIn),
    index("idx_checkOut").on(table.checkOut),
  ]
);

export type Booking = typeof bookings.$inferSelect;
export type InsertBooking = typeof bookings.$inferInsert;

/**
 * Sync log — records each background polling run for observability.
 */
export const syncLogs = mysqlTable("sync_logs", {
  id: int("id").autoincrement().primaryKey(),
  /** Type of sync: ical or email */
  syncType: mysqlEnum("syncType", ["ical", "email"]).notNull(),
  /** Which feed/source was polled */
  source: varchar("source", { length: 256 }).notNull(),
  /** Number of new bookings created */
  newBookings: int("newBookings").default(0).notNull(),
  /** Number of existing bookings updated */
  updatedBookings: int("updatedBookings").default(0).notNull(),
  /** Whether the sync completed without errors */
  success: mysqlEnum("success", ["true", "false"]).default("true").notNull(),
  /** Error message if sync failed */
  errorMessage: text("errorMessage"),
  /** Duration in milliseconds */
  durationMs: int("durationMs"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SyncLog = typeof syncLogs.$inferSelect;
export type InsertSyncLog = typeof syncLogs.$inferInsert;
