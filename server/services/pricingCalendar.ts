/**
 * Which pricing plan each night gets — the rules behind `calendar_pricing`.
 *
 * A night is named by the date it starts on: the night of 10 Nov is 10 → 11 Nov.
 * What makes a night valuable is the day that follows it. Friday night is a
 * weekend night because Saturday is free; Sunday night is not, because Monday is
 * a working day. Holidays follow the same logic: the premium belongs to the eve
 * of a day off, which is when guests arrive (Corpus Christi on Wednesday evening,
 * 11 November on the evening before). Pricing the holiday's own night instead
 * charged a weekend rate for the night before a working day and sold the real
 * arrival night at the weekday rate.
 */

export type Season = "Low" | "Mixed" | "High";
export type NightKind = "newYear" | "special" | "weekend" | "weekday";

export const SADOLES_PLAN: Record<Season | "special" | "newYear", { weekday: string; weekend: string } | string> = {
  Low: { weekday: "S1: Low Weekday", weekend: "S2: Low Weekend" },
  Mixed: { weekday: "S3: Mid Weekday", weekend: "S4: Mid Weekend" },
  High: { weekday: "S5: High Weekday", weekend: "S6: High Weekend" },
  special: "S7: Special Holiday",
  newYear: "S8: New Year",
};

export const HACJENDA_PLAN: Record<Season | "special" | "newYear", { weekday: string; weekend: string } | string> = {
  Low: { weekday: "H1: Low Weekday", weekend: "H3: Standard" },
  Mixed: { weekday: "H2: Mid Weekday", weekend: "H4: Mid Weekend" },
  High: { weekday: "H3: Standard", weekend: "H5: High Weekend" },
  special: "H6: Special Holiday",
  newYear: "H7: New Year",
};

/**
 * Plans that keep their old price for nights before a date. A price change on a
 * plan reaches every night assigned to it; a holdover keeps the nights still on
 * sale at the old price. First use: the 2026 low-season weekends stayed at 900
 * when S2 went to 1,100 from 2027, because the portals kept their 2026 prices
 * and direct must stay the cheapest channel.
 */
export const PLAN_HOLDOVERS: { plan: string; before: string; holdover: string }[] = [
  { plan: "S2: Low Weekend", before: "2027-01-01", holdover: "S2: Low Weekend 2026" },
];

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const key = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Whole days in UTC. date-fns `addDays` works in local time, and across the
 * spring DST change (Easter 2027 is that very Sunday) it lands an hour short of
 * midnight UTC — on the previous calendar day.
 */
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Easter Sunday (Meeus/Jones/Butcher). */
export function getEaster(year: number): Date {
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
  return utc(year, month - 1, day);
}

/** Polish statutory days off in a year. Christmas Eve is one from 2025 on. */
export function getPublicHolidays(year: number): Date[] {
  const easter = getEaster(year);
  const days = [
    utc(year, 0, 1),
    utc(year, 0, 6),
    easter,
    addDays(easter, 1),
    utc(year, 4, 1),
    utc(year, 4, 3),
    addDays(easter, 60), // Corpus Christi
    utc(year, 7, 15),
    utc(year, 10, 1),
    utc(year, 10, 11),
    utc(year, 11, 25),
    utc(year, 11, 26),
  ];
  if (year >= 2025) days.push(utc(year, 11, 24));
  return days;
}

/**
 * Days whose eve is priced as a long-weekend holiday (S7/H6) rather than an
 * ordinary weekend: Easter, the May days with the weekend they touch, Corpus
 * Christi through Sunday, and Christmas Day and Boxing Day.
 */
export function getSpecialDays(year: number): Date[] {
  const easter = getEaster(year);
  const days: Date[] = [easter, addDays(easter, 1)];

  const may1 = utc(year, 4, 1);
  const may3 = utc(year, 4, 3);
  for (let d = may1; d <= may3; d = addDays(d, 1)) days.push(d);
  // Weekend days touching the May block (e.g. 1 May on a Monday pulls in Sat–Sun before it).
  for (const offset of [-1, -2]) {
    const d = addDays(may1, offset);
    if (d.getUTCDay() === 6 || d.getUTCDay() === 0) days.push(d);
  }
  for (const offset of [1, 2]) {
    const d = addDays(may3, offset);
    if (d.getUTCDay() === 6 || d.getUTCDay() === 0) days.push(d);
  }
  const corpus = addDays(easter, 60);
  for (let i = 0; i <= 3; i++) days.push(addDays(corpus, i));

  days.push(utc(year, 11, 25), utc(year, 11, 26));
  return days;
}

function season(date: Date): Season {
  const month = date.getUTCMonth();
  if ([0, 1, 2, 9, 10, 11].includes(month)) return "Low";
  if ([3, 4, 5, 8].includes(month)) return "Mixed";
  return "High";
}

const holidayCache = new Map<number, { off: Set<string>; special: Set<string> }>();
function holidaysOf(year: number) {
  let h = holidayCache.get(year);
  if (!h) {
    h = {
      off: new Set(getPublicHolidays(year).map(key)),
      special: new Set(getSpecialDays(year).map(key)),
    };
    holidayCache.set(year, h);
  }
  return h;
}

/** Kind of the night starting on `night` (a UTC midnight date). */
export function nightKind(night: Date): NightKind {
  if (night.getUTCMonth() === 11 && night.getUTCDate() === 31) return "newYear";

  const next = addDays(night, 1);
  const h = holidaysOf(next.getUTCFullYear());
  if (h.special.has(key(next))) return "special";

  const nextIsWeekend = next.getUTCDay() === 6 || next.getUTCDay() === 0;
  if (nextIsWeekend || h.off.has(key(next))) return "weekend";
  return "weekday";
}

/** Plan name for a property on the night starting on `night`. */
export function planFor(property: "Sadoles" | "Hacjenda", night: Date): string {
  const plans = property === "Sadoles" ? SADOLES_PLAN : HACJENDA_PLAN;
  const kind = nightKind(night);
  if (kind === "newYear") return plans.newYear as string;
  if (kind === "special") return plans.special as string;
  const s = plans[season(night)] as { weekday: string; weekend: string };
  const name = kind === "weekend" ? s.weekend : s.weekday;
  const held = PLAN_HOLDOVERS.find((h) => h.plan === name && key(night) < h.before);
  return held ? held.holdover : name;
}
