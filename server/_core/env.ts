import dotenv from "dotenv";
import path from "path";
import { z } from "zod";

// Load environment variables from .env in the root directory
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

export const ENV = {
  get appId() { return process.env.VITE_APP_ID ?? ""; },
  get cookieSecret() { return process.env.JWT_SECRET ?? ""; },
  get databaseUrl() { return process.env.DATABASE_URL ?? ""; },
  get oAuthServerUrl() { return process.env.OAUTH_SERVER_URL ?? ""; },
  get ownerOpenId() { return process.env.OWNER_OPEN_ID ?? ""; },
  get isProduction() { return process.env.NODE_ENV === "production"; },
  get forgeApiUrl() { return process.env.BUILT_IN_FORGE_API_URL ?? ""; },
  get forgeApiKey() { return process.env.BUILT_IN_FORGE_API_KEY ?? ""; },

  // System emails
  get adminEmail() { return process.env.ADMIN_EMAIL ?? "admin@example.com"; },
  get gmailUser() { return process.env.GMAIL_USER ?? "user@gmail.com"; },

  // Business info
  get ownerName() { return process.env.OWNER_NAME ?? "Owner Name"; },
  get businessName() { return process.env.BUSINESS_NAME ?? "Business Name"; },
  get businessAddress() { return process.env.BUSINESS_ADDRESS ?? "Business Address"; },
  get businessNip() { return process.env.BUSINESS_NIP ?? "__________"; },
  get businessRegon() { return process.env.BUSINESS_REGON ?? "__________"; },
  get bankAccountNumber() { return process.env.BANK_ACCOUNT_NUMBER ?? "00 0000 0000 0000 0000 0000 0000"; },
  get bankNotificationEmail() { return process.env.BANK_NOTIFICATION_EMAIL ?? "nestinfo@powiadomienia.nestbank.pl"; },
  get blikNumber() { return process.env.BLIK_NUMBER ?? ""; },

  // Property details
  get sadolesAddress() { return process.env.SADOLES_ADDRESS ?? "Sadoles Address"; },
  get hacjendaAddress() { return process.env.HACJENDA_ADDRESS ?? "Hacjenda Address"; },
  get hacjendaManagerPhone() { return process.env.HACJENDA_MANAGER_PHONE ?? ""; },
  get hacjendaKeylockCode() { return process.env.HACJENDA_KEYLOCK_CODE ?? "0000"; },
  get sadolesKeylockCode() { return process.env.SADOLES_KEYLOCK_CODE ?? "0809"; },
  get hacjendaManagerName() { return process.env.HACJENDA_MANAGER_NAME ?? "Manager"; },
  get sadolesManagerName() { return process.env.SADOLES_MANAGER_NAME ?? "Manager"; },
  get sadolesManagerPhone() { return process.env.SADOLES_MANAGER_PHONE ?? ""; },

  get sadolesGuidePl() { return process.env.SADOLES_GUIDE_PL ?? "#"; },
  get sadolesGuideEn() { return process.env.SADOLES_GUIDE_EN ?? "#"; },
  get hacjendaGuidePl() { return process.env.HACJENDA_GUIDE_PL ?? "#"; },
  get hacjendaGuideEn() { return process.env.HACJENDA_GUIDE_EN ?? "#"; },

  // Portal property IDs
  get hacjendaBookingId() { return process.env.HACJENDA_BOOKING_ID ?? ""; },
  get sadolesBookingId() { return process.env.SADOLES_BOOKING_ID ?? ""; },

  // iCal feeds
  get icalSadolesSlowhop() { return process.env.ICAL_SADOLES_SLOWHOP ?? ""; },
  get icalSadolesAlohacamp() { return process.env.ICAL_SADOLES_ALOHACAMP ?? ""; },
  get icalSadolesBooking() { return process.env.ICAL_SADOLES_BOOKING ?? ""; },
  get icalSadolesAirbnb() { return process.env.ICAL_SADOLES_AIRBNB ?? ""; },
  get icalHacjendaSlowhop() { return process.env.ICAL_HACJENDA_SLOWHOP ?? ""; },
  get icalHacjendaBooking() { return process.env.ICAL_HACJENDA_BOOKING ?? ""; },
  get icalHacjendaAirbnb() { return process.env.ICAL_HACJENDA_AIRBNB ?? ""; },

  // Google Places API (ratings)
  get googlePlacesApiKey() { return process.env.GOOGLE_PLACES_API_KEY ?? ""; },
};

/**
 * Fail-fast environment validation, run once at boot.
 *
 * Almost every ENV getter above falls back to a placeholder default, so a
 * missing variable used to produce *wrong behavior* silently (emails sent from
 * the wrong account, sessions signed with an empty secret) rather than a clear
 * startup error. This validates the variables whose absence is a real fault.
 *
 * DATABASE_URL is required everywhere. The session-signing secret and the Gmail
 * IMAP credentials are enforced only in production so local dev (and the test
 * suite) can run without a full secrets file.
 *
 * Deliberately NOT required: OAUTH_SERVER_URL / OWNER_OPEN_ID / VITE_APP_ID.
 * The live deployment runs without them — login uses password auth and OAuth
 * degrades gracefully — so requiring them here would fail-fast a working system.
 */
export function validateEnv(): void {
  const isProd = process.env.NODE_ENV === "production";

  // In production these must be real; in dev (or tests) they may be absent.
  const requiredInProd = (label: string) =>
    z.string().optional().refine((v) => !isProd || (v?.trim().length ?? 0) > 0, {
      message: `${label} is required in production`,
    });

  const schema = z.object({
    DATABASE_URL: z
      .string({ message: "DATABASE_URL is required" })
      .min(1, "DATABASE_URL is required"),
    JWT_SECRET: requiredInProd("JWT_SECRET"),
    GMAIL_USER: requiredInProd("GMAIL_USER"),
    GMAIL_APP_PASSWORD: requiredInProd("GMAIL_APP_PASSWORD"),
  });

  const result = schema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    console.error(`[env] Invalid environment configuration:\n${issues}`);
    throw new Error("Environment validation failed — see errors above.");
  }
}
