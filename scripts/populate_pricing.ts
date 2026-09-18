/**
 * Assigns a pricing plan to every night in `calendar_pricing`, following the rules
 * in server/services/pricingCalendar.ts.
 *
 * Only the calendar is touched. Plan prices and property settings (fixed fee,
 * discounts) are edited in the admin Pricing page; this script used to reset them
 * to hard-coded values on every run, silently undoing changes made there.
 *
 * Past nights are left alone — they describe what was sold, and the revenue
 * analysis reads their plans as seasons. By default the run starts today.
 *
 * Dry run by default: prints every night whose plan would change. Pass --apply to
 * write, in one transaction.
 *
 * Usage:
 *   npx tsx scripts/populate_pricing.ts                    # dry run from today
 *   npx tsx scripts/populate_pricing.ts --apply
 *   npx tsx scripts/populate_pricing.ts --from=2027-01-01 --to=2027-12-31
 */
import "dotenv/config";
import { getDb } from "../server/db";
import { pricingPlans, calendarPricing } from "../drizzle/schema";
import { sql } from "drizzle-orm";
import { planFor } from "../server/services/pricingCalendar";

const PROPERTIES = ["Sadoles", "Hacjenda"] as const;
const DAY = 86_400_000;

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const toUtcDay = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const apply = process.argv.includes("--apply");
  const today = iso(new Date());
  const from = toUtcDay(arg("from") ?? today);
  // Default horizon: two years from 1 January, as the calendar has always been filled.
  const to = toUtcDay(arg("to") ?? `${new Date().getUTCFullYear() + 2}-01-31`);
  if (iso(from) < today && !process.argv.includes("--allow-past")) {
    throw new Error(`--from ${iso(from)} is in the past; pass --allow-past if you really mean to rewrite sold nights`);
  }

  const db = await getDb();
  if (!db) throw new Error("No DB");

  const plans = await db.select().from(pricingPlans);
  const idOf = new Map(plans.map((p) => [`${p.property}|${p.name}`, p.id]));
  const nameOf = new Map(plans.map((p) => [p.id, p.name]));

  const existing = await db
    .select({ property: calendarPricing.property, date: sql<string>`DATE_FORMAT(${calendarPricing.date}, '%Y-%m-%d')`, planId: calendarPricing.planId })
    .from(calendarPricing)
    .where(sql`${calendarPricing.date} >= ${iso(from)} AND ${calendarPricing.date} <= ${iso(to)}`);
  const current = new Map(existing.map((r) => [`${r.property}|${r.date}`, r.planId]));

  const rows: { property: (typeof PROPERTIES)[number]; date: Date; planId: number }[] = [];
  const changes: string[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += DAY) {
    const night = new Date(t);
    for (const property of PROPERTIES) {
      const name = planFor(property, night);
      const planId = idOf.get(`${property}|${name}`);
      if (!planId) throw new Error(`No plan "${name}" for ${property}`);
      const was = current.get(`${property}|${iso(night)}`);
      if (was === planId) continue;
      rows.push({ property, date: night, planId });
      const weekday = night.toLocaleDateString("pl-PL", { weekday: "short", timeZone: "UTC" });
      changes.push(`${property.padEnd(8)} ${iso(night)} ${weekday.padEnd(4)} ${was ? nameOf.get(was) : "(none)"} → ${name}`);
    }
  }

  console.log(`Range ${iso(from)} … ${iso(to)}: ${changes.length} night(s) change.`);
  for (const c of changes) console.log("  " + c);

  if (!apply) {
    console.log("\nDry run — nothing written. Re-run with --apply.");
    process.exit(0);
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += 200) {
      await tx.insert(calendarPricing).values(rows.slice(i, i + 200)).onDuplicateKeyUpdate({
        set: { planId: sql`VALUES(planId)` },
      });
    }
  });
  console.log(`\nWritten ${rows.length} night(s).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
