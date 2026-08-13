/**
 * Restates `amountPaid` on the bookings that still carry a pre-fix zaliczka.
 *
 * Before the accounting fix, a confirmation mail wrote the guest's portal
 * prepayment into `amountPaid` — money that went to the portal and never to the
 * owner. Those rows ended up holding the whole stay price (or more), which is
 * not what their account ever received.
 *
 * The owner read the bank statements back for seven of them, and they all run
 * the same way:
 *
 *   Suchocki    2446.50 (Stripe/Alohacamp, one payout)      +500 −500 kaucja
 *   Multan       326.86 (Slowhop)  + 2481 (guest: 1981+500)      −500 kaucja
 *   Makarewicz   209.60 (Stripe)   + 2900 (guest: 2400+500)      −500 kaucja
 *   Bujak        135.13 (Slowhop)  + 1319 (guest:  819+500)      −500 kaucja
 *   Małyszko     300.30 (Slowhop)  + 2320 (guest: 1820+500)      −500 kaucja
 *   Jalosinska   289.90 (Slowhop)  + 1757 + 500                  −500 kaucja
 *
 * which is the settlement this codebase already models — forward = zaliczka −
 * prowizja brutto, guest = cena − zaliczka, plus a kaucja that later goes back
 * out — and it sums to the same thing every time:
 *
 *     (zaliczka − prowizja) + (cena − zaliczka) + kaucja − kaucja = hostRevenue
 *
 * So on a finished stay whose kaucja has been returned (or never applied),
 * `amountPaid` is simply `hostRevenue`. Two more rows confirm it from their own
 * recorded transfers: Wysocka (466.62 + 3528 − 500 = 3494.62, pet fee included)
 * and Daniłowska (207.90 + 1760 − 500 = 1467.90).
 *
 * #98 Damian Kryński needs one more step before the rule reaches him. His flow
 * was 288.75 + 3050 − 500, which is 800 zł more than the rule predicts: the
 * party arrived on Thursday 15.01, a night ahead of the 16–18.01 Slowhop
 * reservation, and paid for that night directly. Slowhop charged its commission
 * on the 2500 it brokered, so the extra night is the owner's in full — the same
 * shape as Wysocka's 200 zł pet fee, which was handled by raising `totalPrice`
 * and leaving `commission` alone. So his stay price becomes 3300, his
 * hostRevenue 3300 − 461.25 = 2838.75, and the rule then applies as usual.
 *
 * Guarded: each row is written only if it still holds the exact value expected
 * here and its kaucja is settled. Re-running is a no-op.
 *
 * Usage:
 *   npx tsx scripts/fix_amount_paid_prefix.ts          # dry run
 *   npx tsx scripts/fix_amount_paid_prefix.ts --apply  # write
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");

/** `to` is hostRevenue in every case — stated explicitly so the guard is real. */
const CORRECTIONS: Array<{ id: number; guest: string; from: string; to: string; evidence: string }> = [
  { id: 113, guest: "Maciej Suchocki", from: "3000.00", to: "2446.50", evidence: "one Alohacamp/Stripe payout of 2446.50; kaucja +500 −500" },
  { id: 99, guest: "Marcin Multan", from: "2830.00", to: "2307.86", evidence: "326.86 Slowhop + 2481 guest (1981 + 500 kaucja) − 500 returned" },
  { id: 114, guest: "Dominika Makarewicz", from: "3200.00", to: "2609.60", evidence: "2900 guest (2400 + 500 kaucja) on 04.02 + 209.60 Stripe on 10.02 − 500 returned" },
  { id: 112, guest: "Sebastian Bujak", from: "1170.00", to: "954.13", evidence: "135.13 Slowhop + 1319 guest (819 + 500 kaucja) − 500 returned" },
  { id: 100, guest: "Dominika Małyszko", from: "2600.00", to: "2120.30", evidence: "300.30 Slowhop + 2320 guest (1820 + 500 kaucja) − 500 returned" },
  { id: 62, guest: "Agata Jalosinska", from: "2133.50", to: "2046.90", evidence: "289.90 Slowhop + 1757 + 500 kaucja − 500 returned" },
  { id: 24, guest: "Anna Daniłowska", from: "2300.00", to: "1467.90", evidence: "207.90 Slowhop + 1760 recorded transfer (1260 + 500 kaucja) − 500 returned" },
  { id: 23, guest: "Katarzyna Wysocka", from: "4240.00", to: "3494.62", evidence: "466.62 Slowhop + 3528 recorded transfer (3028 + 500 kaucja, incl. 200 pet fee) − 500 returned" },
  { id: 2, guest: "Gabriela Raczyńska", from: "3300.00", to: "2691.15", evidence: "2810 recorded transfer (2310 + 500 kaucja) + 381.15 Slowhop forward − 500 returned; no S2 mail survives, so the forward is derived" },
  { id: 26, guest: "Evelina De Lain", from: "1800.00", to: "1467.90", evidence: "no bank record survives; the rule applies — zaliczka 540, forward 207.90, balance 1260, kaucja returned" },
  { id: 69, guest: "Agata Bengel", from: "345.00", to: "937.82", evidence: "held her zaliczka as if received; S2 mail states a 132.82 forward, balance 805, kaucja returned" },
  { id: 98, guest: "Damian Kryński", from: "2500.00", to: "2838.75", evidence: "288.75 Slowhop + 3050 guest (1750 balance + 500 kaucja + 800 for the extra night of 15.01) − 500 returned" },
];

const SETTLED_DEPOSIT = ["returned", "not_applicable"];

/**
 * The extra night Kryński's party paid for directly, which has to be on the
 * booking before its `amountPaid` can equal `hostRevenue`. Commission stays as
 * Slowhop charged it, on the 2500 it brokered.
 */
const EXTRA_NIGHT = {
  id: 98,
  guest: "Damian Kryński",
  totalPrice: ["2500.00", "3300.00"] as [string, string],
  hostRevenue: ["2038.75", "2838.75"] as [string, string],
  reason:
    "Guests arrived Thursday 15.01, a night ahead of the 16–18.01 Slowhop reservation, and paid the " +
    "800 zł for it directly (bank: 288.75 Slowhop + 3050 guest − 500 kaucja returned = 2838.75). " +
    "Slowhop's commission of 461.25 was charged on the 2500 it brokered and is unchanged, so the " +
    "extra night is the owner's in full.",
};

async function applyExtraNight(conn: mysql.Connection): Promise<void> {
  const [rows]: any = await conn.query(
    "SELECT id, guestName, totalPrice, commission, hostRevenue FROM bookings WHERE id = ?",
    [EXTRA_NIGHT.id]
  );
  if (rows.length === 0) return;
  const b = rows[0];

  if (b.totalPrice !== EXTRA_NIGHT.totalPrice[0] || b.hostRevenue !== EXTRA_NIGHT.hostRevenue[0]) {
    console.log(
      `#${EXTRA_NIGHT.id} (${EXTRA_NIGHT.guest}): totalPrice ${b.totalPrice} / hostRevenue ${b.hostRevenue} — ` +
        "already corrected or changed. SKIPPED (extra night).\n"
    );
    return;
  }

  console.log(`#${EXTRA_NIGHT.id} (${EXTRA_NIGHT.guest}) — extra night`);
  console.log(`   totalPrice   ${EXTRA_NIGHT.totalPrice[0]}  ->  ${EXTRA_NIGHT.totalPrice[1]}`);
  console.log(`   hostRevenue  ${EXTRA_NIGHT.hostRevenue[0]}  ->  ${EXTRA_NIGHT.hostRevenue[1]}`);
  console.log(`   commission   ${b.commission} (unchanged — charged on the 2500 Slowhop brokered)`);
  console.log(`   ${EXTRA_NIGHT.reason}`);

  if (!APPLY) {
    console.log("   (dry run — nothing written)\n");
    return;
  }

  await conn.beginTransaction();
  try {
    const [res]: any = await conn.query(
      "UPDATE bookings SET totalPrice = ?, hostRevenue = ? WHERE id = ? AND totalPrice = ? AND hostRevenue = ?",
      [EXTRA_NIGHT.totalPrice[1], EXTRA_NIGHT.hostRevenue[1], EXTRA_NIGHT.id, EXTRA_NIGHT.totalPrice[0], EXTRA_NIGHT.hostRevenue[0]]
    );
    if (res.affectedRows !== 1) throw new Error(`expected 1 row updated, got ${res.affectedRows}`);

    await conn.query("INSERT INTO booking_activities (bookingId, type, action, details) VALUES (?,?,?,?)", [
      EXTRA_NIGHT.id,
      "manual_edit",
      "Extra night added to the stay price",
      `totalPrice: ${EXTRA_NIGHT.totalPrice[0]} -> ${EXTRA_NIGHT.totalPrice[1]}, ` +
        `hostRevenue: ${EXTRA_NIGHT.hostRevenue[0]} -> ${EXTRA_NIGHT.hostRevenue[1]}. ${EXTRA_NIGHT.reason}`,
    ]);
    await conn.commit();
    console.log("   WRITTEN + logged to booking_activities\n");
  } catch (err) {
    await conn.rollback();
    console.error(`   FAILED, rolled back: ${String(err)}\n`);
    throw err;
  }
}

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  console.log(APPLY ? "MODE: APPLY (writing changes)\n" : "MODE: DRY RUN (no changes — pass --apply to write)\n");

  const written: number[] = [];

  // Must run before the amountPaid pass below, which checks against hostRevenue.
  await applyExtraNight(conn);

  for (const fix of CORRECTIONS) {
    const [rows]: any = await conn.query(
      "SELECT id, guestName, status, depositStatus, totalPrice, hostRevenue, amountPaid FROM bookings WHERE id = ?",
      [fix.id]
    );
    if (rows.length === 0) {
      console.log(`#${fix.id}: NOT FOUND — skipped\n`);
      continue;
    }
    const b = rows[0];

    if (b.amountPaid !== fix.from) {
      console.log(`#${fix.id} (${fix.guest}): amountPaid is ${b.amountPaid}, expected ${fix.from} — already corrected or changed. SKIPPED.\n`);
      continue;
    }
    if (b.hostRevenue !== fix.to) {
      console.log(`#${fix.id} (${fix.guest}): hostRevenue is ${b.hostRevenue}, expected ${fix.to} — refusing to guess. SKIPPED.\n`);
      continue;
    }
    if (!SETTLED_DEPOSIT.includes(b.depositStatus)) {
      console.log(`#${fix.id} (${fix.guest}): kaucja is ${b.depositStatus}, not settled — the rule does not apply. SKIPPED.\n`);
      continue;
    }

    console.log(`#${fix.id} (${fix.guest}, ${b.status}, kaucja ${b.depositStatus})`);
    console.log(`   amountPaid  ${fix.from}  ->  ${fix.to}   (= hostRevenue)`);
    console.log(`   ${fix.evidence}`);

    if (!APPLY) {
      console.log("   (dry run — nothing written)\n");
      continue;
    }

    await conn.beginTransaction();
    try {
      const [res]: any = await conn.query(
        "UPDATE bookings SET amountPaid = ? WHERE id = ? AND amountPaid = ? AND hostRevenue = ?",
        [fix.to, fix.id, fix.from, fix.to]
      );
      if (res.affectedRows !== 1) throw new Error(`expected 1 row updated, got ${res.affectedRows}`);

      await conn.query("INSERT INTO booking_activities (bookingId, type, action, details) VALUES (?,?,?,?)", [
        fix.id,
        "manual_edit",
        "amountPaid restated to money actually received",
        `amountPaid: ${fix.from} -> ${fix.to} (= hostRevenue). The old figure counted the portal zaliczka, ` +
          `which never reached the account. Reconstructed from the bank statement: ${fix.evidence}.`,
      ]);
      await conn.commit();
      written.push(fix.id);
      console.log("   WRITTEN + logged to booking_activities\n");
    } catch (err) {
      await conn.rollback();
      console.error(`   FAILED, rolled back: ${String(err)}\n`);
      throw err;
    }
  }

  const [after]: any = await conn.query(
    "SELECT id, guestName, status, depositStatus, totalPrice, hostRevenue, amountPaid, " +
      "ROUND(amountPaid - hostRevenue, 2) AS overstated " +
      "FROM bookings WHERE channel IN ('slowhop','alohacamp') AND totalPrice > 0 ORDER BY checkIn"
  );
  console.log("=== Slowhop / Alohacamp after the pass ===");
  console.table(after);
  if (APPLY) console.log(`Written: ${written.length} rows (${written.join(", ")})`);

  await conn.end();
}

main();
