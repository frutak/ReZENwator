/**
 * Deletes price audits whose only price came from AlohaCamp.
 *
 * These are the rows where Booking, Airbnb and Slowhop all reported SOLD_OUT while
 * AlohaCamp quoted a price for the same dates. Almost all of them are one-night
 * min-stay tests: the three portals were correctly refusing a stay below the
 * minimum, and AlohaCamp — which was not enforcing one — sold it. The dashboard
 * reads that mismatch as a scraper anomaly and paints the day red, blaming the
 * three channels that behaved correctly.
 *
 * The AlohaCamp minimum has since been set. Verified before writing this script:
 * one-night probes for Sadoles on 8, 22 and 28 September now come back SOLD_OUT
 * from AlohaCamp too, so the mismatch is settled and the stored rows only survive
 * as false reds.
 *
 * Guarded: rows are matched by id captured in the dry run and the condition is
 * re-checked inside the DELETE, so a row that changed in between is left alone and
 * re-running is a no-op. The whole batch is one transaction and is refused outright
 * if it would touch more rows than could plausibly match.
 *
 * Usage:
 *   npx tsx scripts/drop_alohacamp_only_audits.ts          # dry run
 *   npx tsx scripts/drop_alohacamp_only_audits.ts --apply  # delete
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");

/** A batch larger than this means the condition is wrong, not that the data is. */
const MAX_EXPECTED = 200;

const ALOHACAMP_ONLY = `
  alohacampStatus = 'OK'
  AND COALESCE(bookingStatus, '') <> 'OK'
  AND COALESCE(airbnbStatus, '')  <> 'OK'
  AND COALESCE(slowhopStatus, '') <> 'OK'
`;

async function main() {
  const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL!, timezone: "Z" });
  console.log(APPLY ? "MODE: APPLY (deleting rows)\n" : "MODE: DRY RUN (no changes — pass --apply to delete)\n");

  const [total]: any = await conn.query("SELECT COUNT(*) AS n FROM price_audits");
  const [rows]: any = await conn.query(
    `SELECT id, property, isMinStayTest,
            DATE_FORMAT(checkIn,  '%Y-%m-%d') AS ci,
            DATE_FORMAT(checkOut, '%Y-%m-%d') AS co,
            DATE_FORMAT(dateScraped, '%Y-%m-%d') AS ds,
            bookingStatus, airbnbStatus, slowhopStatus, alohacampPrice
       FROM price_audits
      WHERE ${ALOHACAMP_ONLY}
      ORDER BY id`
  );

  console.table(
    rows.map((r: any) => ({
      id: r.id,
      obiekt: r.property,
      pobyt: `${r.ci} → ${r.co}`,
      "test min-stay": r.isMinStayTest ? "tak" : "nie",
      zbadane: r.ds,
      Booking: r.bookingStatus ?? "-",
      Airbnb: r.airbnbStatus ?? "-",
      Slowhop: r.slowhopStatus ?? "-",
      "AlohaCamp zł": r.alohacampPrice,
    }))
  );

  console.log(`\n${rows.length} z ${total[0].n} wierszy do usunięcia`);

  if (rows.length > MAX_EXPECTED) {
    throw new Error(`Refusing to delete ${rows.length} rows — over the ${MAX_EXPECTED} row guard.`);
  }

  if (!APPLY) {
    console.log("(dry run — nothing written)");
    await conn.end();
    return;
  }

  if (rows.length === 0) {
    console.log("Nothing to do.");
    await conn.end();
    return;
  }

  await conn.beginTransaction();
  try {
    let deleted = 0;
    for (const r of rows) {
      const [res]: any = await conn.query(
        `DELETE FROM price_audits WHERE id = ? AND ${ALOHACAMP_ONLY}`,
        [r.id]
      );
      if (res.affectedRows !== 1) {
        throw new Error(`#${r.id}: expected 1 row deleted, got ${res.affectedRows}`);
      }
      deleted++;
    }

    await conn.query(
      `INSERT INTO sync_logs (syncType, source, newBookings, updatedBookings, success, errorMessage, durationMs)
       VALUES (?, ?, 0, 0, ?, ?, 0)`,
      [
        "ical",
        "Pricing Auditor",
        "true",
        `Removed ${deleted} audits whose only price came from AlohaCamp (min-stay mismatch, ` +
          `settled once the AlohaCamp minimum was set).`,
      ]
    );

    await conn.commit();
    console.log(`\nDeleted: ${deleted} rows`);
  } catch (err) {
    await conn.rollback();
    console.error(`FAILED, rolled back: ${String(err)}`);
    throw err;
  }

  const [after]: any = await conn.query(
    `SELECT COUNT(*) AS pozostalo FROM price_audits WHERE ${ALOHACAMP_ONLY}`
  );
  console.log(`Rows still matching the condition: ${after[0].pozostalo}`);

  await conn.end();
}

main();
