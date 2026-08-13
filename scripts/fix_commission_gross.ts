/**
 * Brings every Slowhop commission in the database onto the same basis: gross.
 *
 * Slowhop's S2 mail states the commission **netto**; what the portal actually
 * keeps is netto × 1.23, and every forward proves it (rez. 1249415: 753 − 289.90
 * = 463.10 = 376.50 × 1.23). Both parsers already store gross, so these rows are
 * hand-edits and one mis-filled field left over from older code.
 *
 *   #62 Agata Jalosinska   376.50 is the netto from the S2 mail   → 463.10
 *   #70 Zuzanna Seroczyńska 676.50 likewise                        → 832.10
 *   #69 Agata Bengel        180.00 is neither netto nor gross      → 212.18
 *   #26 Evelina De Lain     540.00 is her zaliczka in the wrong field → 332.10
 *
 * `hostRevenue` follows from totalPrice − commission in each case.
 *
 * #23 Katarzyna Wysocka is deliberately absent: her 745.38 is already gross
 * (606 netto × 1.23, and 1212 − 466.62 = 745.38). It only looks off as a
 * percentage because her totalPrice was later raised from 4040 to 4240 for a
 * pet fee that the guest paid the owner directly and Slowhop took no cut of.
 *
 * #70 also gets `amountPaid` corrected — alone among these, what reached the
 * account is fully documented by two matched transfers (520.90 forward on 13.04,
 * 3657 from the guest on 10.08 = 3157 balance + 500 kaucja = 4177.90). The other
 * three keep their `amountPaid`: those rows predate the accounting fix and what
 * landed on them cannot be reconstructed without a bank statement.
 *
 * Guarded: each field is written only if it still holds the exact value this
 * script expects, so re-running is a no-op. Every change is logged to
 * booking_activities.
 *
 * Usage:
 *   npx tsx scripts/fix_commission_gross.ts          # dry run
 *   npx tsx scripts/fix_commission_gross.ts --apply  # write
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");

type Correction = {
  id: number;
  guest: string;
  fields: { commission: [string, string]; hostRevenue: [string, string]; amountPaid?: [string, string] };
  evidence: string;
};

const CORRECTIONS: Correction[] = [
  {
    id: 62,
    guest: "Agata Jalosinska",
    fields: { commission: ["376.50", "463.10"], hostRevenue: ["2133.50", "2046.90"] },
    evidence:
      "S2 mail rez. 1249415: cena 2510, zaliczka 753, prowizja netto 376.50, przelew 289.90. " +
      "Prowizja brutto = 376.50 × 1.23 = 463.10 = 753 − 289.90.",
  },
  {
    id: 70,
    guest: "Zuzanna Seroczyńska",
    fields: {
      commission: ["676.50", "832.10"],
      hostRevenue: ["3833.50", "3677.90"],
      amountPaid: ["5010.00", "4177.90"],
    },
    evidence:
      "S2 mail rez. 1253761: cena 4510, zaliczka 1353, prowizja netto 676.50, przelew 520.90. " +
      "Prowizja brutto = 676.50 × 1.23 = 832.10 = 1353 − 520.90. " +
      "amountPaid: 520.90 (13.04) + 3657 (10.08, = 3157 balance + 500 kaucja) = 4177.90.",
  },
  {
    id: 69,
    guest: "Agata Bengel",
    fields: { commission: ["180.00", "212.18"], hostRevenue: ["970.00", "937.82"] },
    evidence:
      "S2 mail rez. 1215701: cena 1150, zaliczka 345, prowizja netto 172.50, przelew 132.82. " +
      "Prowizja brutto = 172.50 × 1.23 = 212.18 = 345 − 132.82. The stored 180.00 matched neither.",
  },
  {
    id: 26,
    guest: "Evelina De Lain",
    fields: { commission: ["540.00", "332.10"], hostRevenue: ["1260.00", "1467.90"] },
    evidence:
      "S1 mail rez. 1222769: cena 1800, zaliczka 540. The stored commission of 540.00 was the " +
      "zaliczka written into the wrong field. No S2 mail survives, so the gross commission is the " +
      "standard 15% × 1.23 = 18.45% of 1800 = 332.10.",
  },
];

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  console.log(APPLY ? "MODE: APPLY (writing changes)\n" : "MODE: DRY RUN (no changes — pass --apply to write)\n");

  for (const fix of CORRECTIONS) {
    const [rows]: any = await conn.query(
      "SELECT id, guestName, status, totalPrice, reservationFee, commission, hostRevenue, amountPaid " +
        "FROM bookings WHERE id = ?",
      [fix.id]
    );
    if (rows.length === 0) {
      console.log(`#${fix.id}: NOT FOUND — skipped\n`);
      continue;
    }
    const b = rows[0];
    const entries = Object.entries(fix.fields) as Array<[string, [string, string]]>;

    const stale = entries.filter(([field, [expect]]) => b[field] !== expect);
    if (stale.length > 0) {
      console.log(
        `#${fix.id} (${fix.guest}): ` +
          stale.map(([f, [e]]) => `${f} is ${b[f]}, expected ${e}`).join("; ") +
          " — already corrected or changed. SKIPPED (no write).\n"
      );
      continue;
    }

    console.log(`#${fix.id} (${fix.guest}, ${b.status}, cena ${b.totalPrice}, zaliczka ${b.reservationFee ?? "—"})`);
    for (const [field, [from, to]] of entries) console.log(`   ${field.padEnd(12)} ${from}  ->  ${to}`);
    console.log(`   ${fix.evidence}`);

    if (!APPLY) {
      console.log("   (dry run — nothing written)\n");
      continue;
    }

    await conn.beginTransaction();
    try {
      for (const [field, [from, to]] of entries) {
        const [res]: any = await conn.query(
          `UPDATE bookings SET ${field} = ? WHERE id = ? AND ${field} = ?`,
          [to, fix.id, from]
        );
        if (res.affectedRows !== 1) throw new Error(`${field}: expected 1 row updated, got ${res.affectedRows}`);
      }
      await conn.query("INSERT INTO booking_activities (bookingId, type, action, details) VALUES (?,?,?,?)", [
        fix.id,
        "manual_edit",
        "Commission restated gross (netto × 1.23)",
        entries.map(([f, [from, to]]) => `${f}: ${from} -> ${to}`).join("; ") + ". " + fix.evidence,
      ]);
      await conn.commit();
      console.log("   WRITTEN + logged to booking_activities\n");
    } catch (err) {
      await conn.rollback();
      console.error(`   FAILED, rolled back: ${String(err)}\n`);
      throw err;
    }
  }

  const [after]: any = await conn.query(
    "SELECT id, guestName, totalPrice, commission, hostRevenue, amountPaid, " +
      "ROUND(commission / totalPrice * 100, 2) AS pctOfTotal " +
      "FROM bookings WHERE channel IN ('slowhop','alohacamp') AND totalPrice > 0 AND commission > 0 ORDER BY id"
  );
  console.log("=== Every Slowhop/Alohacamp commission now ===");
  console.table(after);

  await conn.end();
}

main();
