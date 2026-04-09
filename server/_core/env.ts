import dotenv from "dotenv";
import path from "path";

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
};
