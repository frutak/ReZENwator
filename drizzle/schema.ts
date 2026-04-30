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
  uniqueIndex,
  json,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  username: varchar("username", { length: 64 }).unique(),
  passwordHash: text("passwordHash"),
  openId: varchar("openId", { length: 64 }).unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  /** Optional restriction to a specific property: "Sadoles", "Hacjenda" or null for all */
  propertyAccess: varchar("propertyAccess", { length: 64 }),
  /** Optional restriction to a specific view: "cleaning", "bookings", "pricing" or null for all */
  viewAccess: varchar("viewAccess", { length: 64 }),
  /** User language preference: "PL" or "EN" */
  language: mysqlEnum("language", ["PL", "EN"]).default("EN").notNull(),
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
      "portal_paid",
      "paid",
      "finished",
      "cancelled",
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
    guestCountry: varchar("guestCountry", { length: 128 }),
    guestEmail: varchar("guestEmail", { length: 320 }),
    guestPhone: varchar("guestPhone", { length: 64 }),
    guestCount: int("guestCount"),
    adultsCount: int("adultsCount"),
    childrenCount: int("childrenCount"),
    animalsCount: int("animalsCount"),

    // New fields for contract and business bookings
    purpose: varchar("purpose", { length: 128 }).default("leisure"),
    companyName: varchar("companyName", { length: 256 }),
    nip: varchar("nip", { length: 32 }),

    // Payments
    /** Total amount paid by the guest so far */
    amountPaid: decimal("amountPaid", { precision: 10, scale: 2 }).default("0.00"),
    /** Security deposit amount required (Kaucja) */
    depositAmount: decimal("depositAmount", { precision: 10, scale: 2 }).default("500.00"),
    /** Reservation fee required to confirm (Zaliczka) */
    reservationFee: decimal("reservationFee", { precision: 10, scale: 2 }),

    // Pricing (populated from email parsing)
    /** Total price charged to the guest */
    totalPrice: decimal("totalPrice", { precision: 10, scale: 2 }),
    /** Portal commission amount */
    commission: decimal("commission", { precision: 10, scale: 2 }).default("0.00"),
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

    /** Whether the 2-week arrival reminder has been sent */
    reminderSent: int("reminderSent").default(0).notNull(),

    // Cleaning tracking
    /** Scheduled cleaning date */
    cleaningDate: datetime("cleaningDate"),
    /** Person assigned to cleaning: "Ala" or "Krysia" */
    cleaningStaff: mysqlEnum("cleaningStaff", ["Ala", "Krysia"]),

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

/**
 * Guest emails tracking — records automated guest communication.
 */
export const guestEmails = mysqlTable("guest_emails", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(),
  emailType: mysqlEnum("emailType", [
    "booking_pending",
    "booking_confirmed",
    "booking_cancelled_no_payment",
    "arrival_reminder",
    "stay_finished",
    "missing_data_alert",
  ]).notNull(),
  sentAt: timestamp("sentAt").defaultNow().notNull(),
  recipient: varchar("recipient", { length: 320 }).notNull(),
  success: mysqlEnum("success", ["true", "false"]).default("true").notNull(),
  errorMessage: text("errorMessage"),
});

export type GuestEmail = typeof guestEmails.$inferSelect;
export type InsertGuestEmail = typeof guestEmails.$inferInsert;

/**
 * Property ratings — stores average ratings and counts from external portals.
 */
export const propertyRatings = mysqlTable("property_ratings", {
  id: int("id").autoincrement().primaryKey(),
  property: mysqlEnum("property", ["Sadoles", "Hacjenda"]).notNull(),
  portal: mysqlEnum("portal", ["booking", "airbnb", "slowhop", "alohacamp", "google"]).notNull(),
  rating: decimal("rating", { precision: 3, scale: 2 }).notNull(),
  count: int("count").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("idx_property_portal").on(table.property, table.portal),
]);

export type PropertyRating = typeof propertyRatings.$inferSelect;
export type InsertPropertyRating = typeof propertyRatings.$inferInsert;

/**
 * Booking activities — records history of actions, enrichments and emails for a booking.
 */
export const bookingActivities = mysqlTable("booking_activities", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(),
  type: mysqlEnum("type", ["email", "enrichment", "manual_edit", "status_change", "system"]).notNull(),
  action: varchar("action", { length: 256 }).notNull(),
  details: text("details"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_booking_id").on(table.bookingId),
]);

export type BookingActivity = typeof bookingActivities.$inferSelect;
export type InsertBookingActivity = typeof bookingActivities.$inferInsert;

/**
 * Pricing plans — defines nightly prices and minimum stay requirements.
 */
export const pricingPlans = mysqlTable("pricing_plans", {
  id: int("id").autoincrement().primaryKey(),
  property: mysqlEnum("property", ["Sadoles", "Hacjenda"]).notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  nightlyPrice: int("nightlyPrice").notNull(),
  minStay: int("minStay").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("idx_property_name").on(table.property, table.name),
]);

export type PricingPlan = typeof pricingPlans.$inferSelect;
export type InsertPricingPlan = typeof pricingPlans.$inferInsert;

/**
 * Calendar pricing — assigns a pricing plan to every date for each property.
 */
export const calendarPricing = mysqlTable("calendar_pricing", {
  id: int("id").autoincrement().primaryKey(),
  property: mysqlEnum("property", ["Sadoles", "Hacjenda"]).notNull(),
  date: datetime("date").notNull(),
  planId: int("planId").notNull(),
}, (table) => [
  uniqueIndex("idx_property_date").on(table.property, table.date),
  index("idx_plan_id").on(table.planId),
]);

export type CalendarPricing = typeof calendarPricing.$inferSelect;
export type InsertCalendarPricing = typeof calendarPricing.$inferInsert;

/**
 * Property settings — stores global configuration per property (e.g. fixed booking price).
 */
export const propertySettings = mysqlTable("property_settings", {
  property: mysqlEnum("property", ["Sadoles", "Hacjenda"]).primaryKey(),
  fixedBookingPrice: int("fixedBookingPrice").default(800).notNull(),
  petFee: int("petFee").default(200).notNull(),
  /** JSON array of { maxGuests: number, multiplier: number } sorted by maxGuests asc */
  peopleDiscount: json("peopleDiscount"),
  lastMinuteDiscount: decimal("lastMinuteDiscount", { precision: 4, scale: 2 }).default("0.05").notNull(),
  lastMinuteDays: int("lastMinuteDays").default(14).notNull(),
  /** JSON array of { minNights: number, discount: number } sorted by minNights desc */
  stayDurationDiscounts: json("stayDurationDiscounts"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PropertySettings = typeof propertySettings.$inferSelect;
export type InsertPropertySettings = typeof propertySettings.$inferInsert;

/**
 * System settings — stores global configuration (e.g. admin email).
 */
export const systemSettings = mysqlTable("system_settings", {
  key: varchar("key", { length: 256 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SystemSetting = typeof systemSettings.$inferSelect;
export type InsertSystemSetting = typeof systemSettings.$inferInsert;

/**
 * Sync status — tracks the latest success and attempt for each source.
 */
export const syncStatus = mysqlTable("sync_status", {
  id: int("id").autoincrement().primaryKey(),
  /** Source name (e.g. "Sadoles / Slowhop") */
  source: varchar("source", { length: 256 }).notNull().unique(),
  /** Type of sync: ical or email */
  syncType: mysqlEnum("syncType", ["ical", "email"]).notNull(),
  /** Last successful sync time */
  lastSuccess: timestamp("lastSuccess"),
  /** Last sync attempt time (success or failure) */
  lastAttempt: timestamp("lastAttempt").defaultNow().notNull(),
  /** Error message from the last failed attempt */
  lastError: text("lastError"),
  /** Number of consecutive failures */
  consecutiveFailures: int("consecutiveFailures").default(0).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SyncStatus = typeof syncStatus.$inferSelect;
export type InsertSyncStatus = typeof syncStatus.$inferInsert;

/**
 * Portal analytics — tracks unique IP addresses per page per day.
 */
export const portalAnalytics = mysqlTable("portal_analytics", {
  id: int("id").autoincrement().primaryKey(),
  /** Date of the visit */
  date: timestamp("date").notNull(),
  /** Page identifier: "main", "Sadoles", "Hacjenda" */
  page: varchar("page", { length: 64 }).notNull(),
  /** Hashed IP address for privacy-preserving unique counting */
  ipHash: varchar("ipHash", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("idx_date_page_ip").on(table.date, table.page, table.ipHash),
]);

export type PortalAnalytics = typeof portalAnalytics.$inferSelect;
export type InsertPortalAnalytics = typeof portalAnalytics.$inferInsert;

/**
 * Price audits — stores raw prices and statuses scraped from portals for comparison.
 */
export const priceAudits = mysqlTable("price_audits", {
  id: int("id").autoincrement().primaryKey(),
  property: mysqlEnum("property", ["Sadoles", "Hacjenda"]).notNull(),
  checkIn: datetime("checkIn").notNull(),
  checkOut: datetime("checkOut").notNull(),
  dateScraped: timestamp("dateScraped").defaultNow().notNull(),

  // Scraped data per portal
  bookingPrice: decimal("bookingPrice", { precision: 10, scale: 2 }),
  bookingStatus: varchar("bookingStatus", { length: 64 }), // e.g. "OK", "SOLD_OUT", "MIN_STAY_VIOLATION"

  airbnbPrice: decimal("airbnbPrice", { precision: 10, scale: 2 }),
  airbnbStatus: varchar("airbnbStatus", { length: 64 }),

  slowhopPrice: decimal("slowhopPrice", { precision: 10, scale: 2 }),
  slowhopStatus: varchar("slowhopStatus", { length: 64 }),

  alohacampPrice: decimal("alohacampPrice", { precision: 10, scale: 2 }),
  alohacampStatus: varchar("alohacampStatus", { length: 64 }),

  /** Whether this probe was specifically intended to test a minimum stay violation */
  isMinStayTest: int("isMinStayTest").default(0).notNull(),
}, (table) => [
  index("idx_audit_property_dates").on(table.property, table.checkIn, table.checkOut),
  index("idx_audit_date_scraped").on(table.dateScraped),
]);

export type PriceAudit = typeof priceAudits.$inferSelect;
export type InsertPriceAudit = typeof priceAudits.$inferInsert;
