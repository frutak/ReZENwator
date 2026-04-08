import { getDb } from "../server/db.ts";
import { pricingPlans, calendarPricing, propertySettings } from "../drizzle/schema.ts";
import { eq, and, sql } from "drizzle-orm";
import { addDays, startOfDay } from "date-fns";

/**
 * Calculates Easter Sunday for a given year using the Meeus/Jones/Butcher algorithm.
 */
function getEaster(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  // month returned is 3 for March, 4 for April.
  // In JS Date constructor, month is 0-indexed, so we use month - 1.
  return new Date(Date.UTC(year, month - 1, day));
}

function getPolishHolidays(year: number) {
  const easter = getEaster(year);
  const easterMonday = addDays(easter, 1);
  const corpusChristi = addDays(easter, 60);

  return {
    newYear: new Date(Date.UTC(year, 0, 1)),
    epiphany: new Date(Date.UTC(year, 0, 6)),
    easter,
    easterMonday,
    may1: new Date(Date.UTC(year, 4, 1)),
    may3: new Date(Date.UTC(year, 4, 3)),
    corpusChristi,
    assumption: new Date(Date.UTC(year, 7, 15)),
    allSaints: new Date(Date.UTC(year, 10, 1)),
    independence: new Date(Date.UTC(year, 10, 11)),
    christmas1: new Date(Date.UTC(year, 11, 25)),
    christmas2: new Date(Date.UTC(year, 11, 26)),
  };
}

function getSeason(date: Date): "Low" | "Mixed" | "High" {
  const month = date.getUTCMonth(); // 0-indexed
  if ([0, 1, 2, 9, 10, 11].includes(month)) return "Low";
  if ([3, 4, 5, 8].includes(month)) return "Mixed";
  return "High";
}

async function populate() {
  const db = await getDb();
  if (!db) throw new Error("No DB");

  console.log("Cleaning old assignments...");
  await db.delete(calendarPricing);

  console.log("Populating Pricing Plans...");

  // 1. Initialise Property Settings
  await db.insert(propertySettings).values([
    { property: "Sadoles", fixedBookingPrice: 800 },
    { property: "Hacjenda", fixedBookingPrice: 800 },
  ]).onDuplicateKeyUpdate({ set: { fixedBookingPrice: 800 } });

  // 2. Define Pricing Plans (same definitions as requested)
  const sadolesPlans = [
    { name: "S1: Low Weekday", nightlyPrice: 500, minStay: 1 },
    { name: "S2: Low Weekend", nightlyPrice: 900, minStay: 2 },
    { name: "S3: Mid Weekday", nightlyPrice: 700, minStay: 1 },
    { name: "S4: Mid Weekend", nightlyPrice: 1100, minStay: 2 },
    { name: "S5: High Weekday", nightlyPrice: 900, minStay: 2 },
    { name: "S6: High Weekend", nightlyPrice: 1700, minStay: 2 },
    { name: "S7: Special Holiday", nightlyPrice: 1700, minStay: 3 },
    { name: "S8: New Year", nightlyPrice: 4000, minStay: 2 },
  ];

  const hacjendaPlans = [
    { name: "H1: Low Weekday", nightlyPrice: 300, minStay: 1 },
    { name: "H2: Mid Weekday", nightlyPrice: 500, minStay: 1 },
    { name: "H3: Standard", nightlyPrice: 600, minStay: 1 },
    { name: "H4: Mid Weekend", nightlyPrice: 750, minStay: 1 },
    { name: "H5: High Weekend", nightlyPrice: 900, minStay: 1 },
    { name: "H6: Special Holiday", nightlyPrice: 900, minStay: 3 },
    { name: "H7: New Year", nightlyPrice: 4000, minStay: 2 },
  ];

  const sadolesMap: Record<string, number> = {};
  for (const p of sadolesPlans) {
    const [res] = await db.insert(pricingPlans).values({ ...p, property: "Sadoles" }).onDuplicateKeyUpdate({
      set: { nightlyPrice: p.nightlyPrice, minStay: p.minStay }
    });
    const id = (res as any).insertId || (await db.select().from(pricingPlans).where(and(eq(pricingPlans.property, "Sadoles"), eq(pricingPlans.name, p.name))).limit(1))[0].id;
    sadolesMap[p.name] = id;
  }

  const hacjendaMap: Record<string, number> = {};
  for (const p of hacjendaPlans) {
    const [res] = await db.insert(pricingPlans).values({ ...p, property: "Hacjenda" }).onDuplicateKeyUpdate({
      set: { nightlyPrice: p.nightlyPrice, minStay: p.minStay }
    });
    const id = (res as any).insertId || (await db.select().from(pricingPlans).where(and(eq(pricingPlans.property, "Hacjenda"), eq(pricingPlans.name, p.name))).limit(1))[0].id;
    hacjendaMap[p.name] = id;
  }

  console.log("Generating assignments for 2 years...");

  const now = new Date();
  const startDate = new Date(Date.UTC(now.getFullYear(), 0, 1));
  const endDate = addDays(startDate, 365 * 2 + 31); 

  let current = startDate;
  while (current <= endDate) {
    const year = current.getUTCFullYear();
    const holidays = getPolishHolidays(year);
    const dayOfWeek = current.getUTCDay(); // 0 = Sun, 5 = Fri, 6 = Sat
    
    // --- SPECIAL HOLIDAY LOGIC ---
    
    // Easter: Sunday and Monday
    const isEaster = isSameDay(current, holidays.easter) || isSameDay(current, holidays.easterMonday);
    
    // May Holidays: May 1-3 plus any adjacent weekend days (Fri-Sun)
    const may1 = new Date(Date.UTC(year, 4, 1));
    const may3 = new Date(Date.UTC(year, 4, 3));
    const isMay1to3 = (current >= may1 && current <= may3);
    
    // Check if current day is a weekend day (Fri-Sun) adjacent to May 1 or May 3
    let isMayWeekendAdjacency = false;
    if (dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0) {
      // If it's a Friday or Saturday before May 1
      if (isSameDay(addDays(current, 1), may1) || isSameDay(addDays(current, 2), may1)) {
        isMayWeekendAdjacency = true;
      }
      // If it's a Saturday or Sunday after May 3
      if (isSameDay(addDays(current, -1), may3) || isSameDay(addDays(current, -2), may3)) {
        isMayWeekendAdjacency = true;
      }
    }

    const isMayHoliday = isMay1to3 || isMayWeekendAdjacency;

    // Corpus Christi: Thursday to Sunday
    const isCorpusChristiSpan = (current >= holidays.corpusChristi && current <= addDays(holidays.corpusChristi, 3));
    
    // Christmas: Dec 24 and Dec 25
    const isChristmas = (current.getUTCMonth() === 11 && (current.getUTCDate() === 24 || current.getUTCDate() === 25));

    const isSpecial = isEaster || isMayHoliday || isCorpusChristiSpan || isChristmas;
    const isNY = current.getUTCMonth() === 11 && current.getUTCDate() === 31;
    
    // --- WEEKEND LOGIC ---
    // Friday, Saturday, or Polish Public Holiday (standard weekend price)
    const isPublicHoliday = Object.values(holidays).some(h => isSameDay(current, h));
    const isWeekendDay = dayOfWeek === 5 || dayOfWeek === 6 || isPublicHoliday;
    
    const season = getSeason(current);

    // Assignment Logic
    let sPlan, hPlan;

    if (isNY) {
      sPlan = sadolesMap["S8: New Year"];
      hPlan = hacjendaMap["H7: New Year"];
    } else if (isSpecial) {
      sPlan = sadolesMap["S7: Special Holiday"];
      hPlan = hacjendaMap["H6: Special Holiday"];
    } else if (isWeekendDay) {
      if (season === "Low") {
        sPlan = sadolesMap["S2: Low Weekend"];
        hPlan = hacjendaMap["H3: Standard"];
      } else if (season === "Mixed") {
        sPlan = sadolesMap["S4: Mid Weekend"];
        hPlan = hacjendaMap["H4: Mid Weekend"];
      } else {
        sPlan = sadolesMap["S6: High Weekend"];
        hPlan = hacjendaMap["H5: High Weekend"];
      }
    } else { // Weekday (Sun, Mon, Tue, Wed, Thu)
      if (season === "Low") {
        sPlan = sadolesMap["S1: Low Weekday"];
        hPlan = hacjendaMap["H1: Low Weekday"];
      } else if (season === "Mixed") {
        sPlan = sadolesMap["S3: Mid Weekday"];
        hPlan = hacjendaMap["H2: Mid Weekday"];
      } else {
        sPlan = sadolesMap["S5: High Weekday"];
        hPlan = hacjendaMap["H3: Standard"];
      }
    }

    await db.insert(calendarPricing).values([
      { property: "Sadoles", date: current, planId: sPlan! },
      { property: "Hacjenda", date: current, planId: hPlan! },
    ]).onDuplicateKeyUpdate({
      set: { planId: sql`VALUES(planId)` }
    });

    current = addDays(current, 1);
  }

  console.log("Done!");
  process.exit(0);
}

function isSameDay(d1: Date, d2: Date) {
  return d1.getUTCFullYear() === d2.getUTCFullYear() &&
         d1.getUTCMonth() === d2.getUTCMonth() &&
         d1.getUTCDate() === d2.getUTCDate();
}

populate();
