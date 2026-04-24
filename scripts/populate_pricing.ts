import { getDb } from "../server/db.ts";
import { pricingPlans, calendarPricing, propertySettings } from "../drizzle/schema.ts";
import { eq, and, sql } from "drizzle-orm";
import { addDays, format, isSameDay } from "date-fns";

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

  await db.insert(propertySettings).values([
    { property: "Sadoles", fixedBookingPrice: 800 },
    { property: "Hacjenda", fixedBookingPrice: 800 },
  ]).onDuplicateKeyUpdate({ set: { fixedBookingPrice: 800 } });

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

  let currentTs = startDate.getTime();
  const endTs = endDate.getTime();
  const oneDay = 24 * 60 * 60 * 1000;
  
  let batch: any[] = [];
  let holidaysCache: Record<number, any> = {};
  
  while (currentTs <= endTs) {
    const d = new Date(currentTs);
    const year = d.getUTCFullYear();
    if (!holidaysCache[year]) {
      holidaysCache[year] = getPolishHolidays(year);
    }
    const holidays = holidaysCache[year];
    const dayOfWeek = d.getUTCDay(); // 0 = Sun, 5 = Fri, 6 = Sat
    
    // --- SPECIAL HOLIDAY LOGIC ---
    const isEaster = isSameDay(d, holidays.easter) || isSameDay(d, holidays.easterMonday);
    
    const isMay1to3 = (d >= holidays.may1 && d <= holidays.may3);
    
    let isMayWeekendAdjacency = false;
    if (dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0) {
      if (isSameDay(addDays(d, 1), holidays.may1) || isSameDay(addDays(d, 2), holidays.may1)) {
        isMayWeekendAdjacency = true;
      }
      if (isSameDay(addDays(d, -1), holidays.may3) || isSameDay(addDays(d, -2), holidays.may3)) {
        isMayWeekendAdjacency = true;
      }
    }

    const isMayHoliday = isMay1to3 || isMayWeekendAdjacency;
    const isCorpusChristiSpan = (d >= holidays.corpusChristi && d <= addDays(holidays.corpusChristi, 3));
    const isChristmas = (d.getUTCMonth() === 11 && (d.getUTCDate() === 24 || d.getUTCDate() === 25));

    const isSpecial = isEaster || isMayHoliday || isCorpusChristiSpan || isChristmas;
    const isNY = d.getUTCMonth() === 11 && d.getUTCDate() === 31;
    
    // --- WEEKEND LOGIC ---
    const isPublicHoliday = Object.values(holidays).some(h => isSameDay(d, h as Date));
    
    // REVISED LOGIC FOR SUNDAY HOLIDAYS:
    // If it's a Sunday (0) and a public holiday, but NOT a "Special Holiday" (like May 1-3 or Easter),
    // it should probably be a Weekday plan if we want consistency.
    // However, the user specifically asked about May 3rd. May 3rd IS a Special Holiday.
    // If it's a Special Holiday, it gets S7/H6. 
    // If it was just a regular Sunday holiday, it would get S4/H4 in the old logic.
    
    const isWeekendDay = dayOfWeek === 5 || dayOfWeek === 6 || isPublicHoliday;
    
    const season = getSeason(d);

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
    } else {
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

    batch.push({ property: "Sadoles", date: d, planId: sPlan! });
    batch.push({ property: "Hacjenda", date: d, planId: hPlan! });

    if (batch.length >= 200) {
      console.log(`Processing up to ${format(d, "yyyy-MM-dd")}...`);
      await db.insert(calendarPricing).values(batch).onDuplicateKeyUpdate({
        set: { planId: sql`VALUES(planId)` }
      });
      batch = [];
    }

    currentTs += oneDay;
  }

  if (batch.length > 0) {
    await db.insert(calendarPricing).values(batch).onDuplicateKeyUpdate({
      set: { planId: sql`VALUES(planId)` }
    });
  }

  console.log("Done!");
  process.exit(0);
}

populate();
