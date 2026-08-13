/**
 * Sets the arrival and departure hours on bookings that were stored at midnight.
 *
 * The house convention is check-in 16:00, check-out 10:00 local time — what the
 * iCal poller writes for an all-day event (icalPoller.ts:139) and what
 * `normalizeBookingDates` applies on every manual create or edit. A batch of
 * older rows predates that and sits at 00:00 local, which the app shows as
 * "16 Jan 2026 00:00 → 18 Jan 2026 00:00".
 *
 * Only the hours move. The calendar dates are correct and are preserved exactly:
 * this reads each stored instant in Europe/Warsaw, keeps its local date, and
 * writes 16:00 / 10:00 on that same local date.
 *
 * Note the DST handling. Times are stored as naive UTC (the pool runs with
 * `timezone: "Z"`), so 16:00 local is 15:00 in the row for a winter stay and
 * 14:00 for a summer one — which is exactly what the 80 correct rows in the
 * table already hold. That conversion is done through the IANA zone rather than
 * a fixed offset, so a stay either side of the changeover lands right.
 *
 * Guarded: a row is written only if it still holds the exact instants recorded
 * here, so re-running is a no-op.
 *
 * Usage:
 *   npx tsx scripts/fix_midnight_times.ts          # dry run
 *   npx tsx scripts/fix_midnight_times.ts --apply  # write
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const ZONE = "Europe/Warsaw";
const CHECK_IN_HOUR = 16;
const CHECK_OUT_HOUR = 10;

/** Anything landing before this hour local is a time that was never set. */
const SUSPECT_BEFORE = "06:00";

const naiveUtcToDate = (naive: string) => new Date(naive.replace(" ", "T") + "Z");

const dateToNaiveUtc = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

/** How far ahead of UTC the zone runs at this instant, in minutes. */
function zoneOffsetMinutes(date: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: ZONE,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  return (asUtc - date.getTime()) / 60000;
}

/** "2026-01-16 00:00" in Warsaw for an instant. */
function localParts(date: Date): { date: string; time: string } {
  const s = new Intl.DateTimeFormat("sv-SE", {
    timeZone: ZONE,
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
  const [d, t] = s.split(" ");
  return { date: d, time: t };
}

/** The instant of `hour:00` local on `localDate`, as a naive UTC string. */
function localHourToNaiveUtc(localDate: string, hour: number): string {
  const wallClock = new Date(`${localDate}T${String(hour).padStart(2, "0")}:00:00Z`);
  let utc = new Date(wallClock.getTime() - zoneOffsetMinutes(wallClock) * 60000);
  // The offset at the resulting instant is the authoritative one — it differs
  // from the first guess only for a stay that starts within hours of a DST
  // changeover, which is precisely when a fixed +1/+2 would be wrong.
  const settled = zoneOffsetMinutes(utc);
  utc = new Date(wallClock.getTime() - settled * 60000);
  return dateToNaiveUtc(utc);
}

async function main() {
  const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL!, timezone: "Z" });
  console.log(APPLY ? "MODE: APPLY (writing changes)\n" : "MODE: DRY RUN (no changes — pass --apply to write)\n");

  const [rows]: any = await conn.query(
    `SELECT id, channel, type, status, guestName, property,
            DATE_FORMAT(checkIn,'%Y-%m-%d %H:%i:%s')  AS inRaw,
            DATE_FORMAT(checkOut,'%Y-%m-%d %H:%i:%s') AS outRaw
       FROM bookings ORDER BY checkIn`
  );

  const planned = rows
    .map((b: any) => {
      const inLocal = localParts(naiveUtcToDate(b.inRaw));
      const outLocal = localParts(naiveUtcToDate(b.outRaw));
      return { ...b, inLocal, outLocal };
    })
    .filter((b: any) => b.inLocal.time < SUSPECT_BEFORE || b.outLocal.time < SUSPECT_BEFORE)
    .map((b: any) => ({
      ...b,
      inNew: localHourToNaiveUtc(b.inLocal.date, CHECK_IN_HOUR),
      outNew: localHourToNaiveUtc(b.outLocal.date, CHECK_OUT_HOUR),
    }));

  console.table(
    planned.map((b: any) => ({
      id: b.id,
      kanal: b.channel,
      status: b.status,
      gosc: (b.guestName || "").trim(),
      "daty (bez zmian)": `${b.inLocal.date} → ${b.outLocal.date}`,
      "godziny teraz": `${b.inLocal.time} → ${b.outLocal.time}`,
      "godziny po": `${String(CHECK_IN_HOUR).padStart(2, "0")}:00 → ${String(CHECK_OUT_HOUR).padStart(2, "0")}:00`,
      "w bazie po (UTC)": `${b.inNew} → ${b.outNew}`,
    }))
  );

  if (!APPLY) {
    console.log(`\n${planned.length} rezerwacji do poprawy (dry run — nothing written)`);
    await conn.end();
    return;
  }

  let written = 0;
  for (const b of planned) {
    await conn.beginTransaction();
    try {
      const [res]: any = await conn.query(
        "UPDATE bookings SET checkIn = ?, checkOut = ? WHERE id = ? AND checkIn = ? AND checkOut = ?",
        [b.inNew, b.outNew, b.id, b.inRaw, b.outRaw]
      );
      if (res.affectedRows !== 1) throw new Error(`#${b.id}: expected 1 row updated, got ${res.affectedRows}`);

      await conn.query("INSERT INTO booking_activities (bookingId, type, action, details) VALUES (?,?,?,?)", [
        b.id,
        "manual_edit",
        "Arrival and departure hours set to 16:00 / 10:00",
        `Dates unchanged (${b.inLocal.date} → ${b.outLocal.date}); the row had been stored at ` +
          `${b.inLocal.time} → ${b.outLocal.time} local, from before check-in and check-out hours were normalised.`,
      ]);
      await conn.commit();
      written++;
    } catch (err) {
      await conn.rollback();
      console.error(`#${b.id} FAILED, rolled back: ${String(err)}`);
      throw err;
    }
  }

  console.log(`\nWritten: ${written} rows`);

  const [after]: any = await conn.query(
    "SELECT TIME(checkIn) AS przyjazd, TIME(checkOut) AS wyjazd, COUNT(*) AS ile " +
      "FROM bookings GROUP BY przyjazd, wyjazd ORDER BY ile DESC"
  );
  console.log("=== rozkład godzin po zmianie (UTC — 15/09 to zima, 14/08 to lato) ===");
  console.table(after);

  await conn.end();
}

main();
