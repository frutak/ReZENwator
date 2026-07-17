/**
 * Audit: duplicate bank-transfer payments.
 *
 * READ-ONLY. Makes no changes — reports only.
 *
 * Background: until the `.ignore()` gate was added to BankTransferRepository,
 * re-processing the same bank-notification email (e.g. an email marked unread
 * again) re-ran applyTransferMatch, which does an unconditional
 * `amountPaid = currentPaid + transferAmount`. Booking #63 was hit by this in
 * April 2026: the same 1300 PLN transfer was applied three times.
 *
 * This script reconstructs every transfer application from `booking_activities`
 * and flags bookings where the same (sender, amount) was applied more than once
 * without an intervening reversal.
 *
 * Caveat: `bank_transfers` only exists from 2026-04-30 onward, so for bookings
 * before that the activity log is the only evidence and cross-checking is not
 * possible. Those are reported as UNVERIFIABLE for manual review.
 *
 * Usage: npx tsx scripts/audit_duplicate_payments.ts
 */
import "dotenv/config";
import mysql from "mysql2/promise";

/** First row in bank_transfers — before this, no transfer records exist to cross-check against. */
const TRANSFER_TABLE_EPOCH = new Date("2026-04-30T00:00:00Z");

type MatchEvent = {
  kind: "match" | "reversal";
  at: Date;
  sender: string;
  amount: number;
  score: number | null;
  raw: string;
};

const normalizeSender = (s: string) =>
  s.toUpperCase().replace(/[^A-Z\s]/g, "").split(/\s+/).filter(Boolean).sort().join(" ");

function parseMatch(action: string, details: string | null, at: Date): MatchEvent | null {
  if (/Manual match reversal|Manual transfer un-match/i.test(action)) {
    const amt = details?.match(/Removed\s+([\d.]+)\s*PLN/i);
    return {
      kind: "reversal",
      at,
      sender: "",
      amount: amt ? parseFloat(amt[1]) : 0,
      score: null,
      raw: `${action} — ${details ?? ""}`,
    };
  }
  if (!/Auto-matched bank transfer|Manual transfer match/i.test(action)) return null;
  if (!details) return null;

  const sender = details.match(/Sender:\s*(.+?),\s*Amount:/i);
  const amount = details.match(/Amount:\s*([\d.]+)\s*PLN/i);
  if (!sender || !amount) return null;

  const score = action.match(/Score:\s*(\d+)/i);
  return {
    kind: "match",
    at,
    sender: sender[1].trim(),
    amount: parseFloat(amount[1]),
    score: score ? parseInt(score[1], 10) : null,
    raw: `${action} — ${details}`,
  };
}

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  const [bookingRows]: any = await conn.query(
    `SELECT id, guestName, property, channel, status, checkIn,
            totalPrice, amountPaid, depositAmount, hostRevenue, createdAt
     FROM bookings ORDER BY id`
  );
  const [actRows]: any = await conn.query(
    `SELECT bookingId, action, details, createdAt
     FROM booking_activities
     WHERE action LIKE 'Auto-matched bank transfer%'
        OR action LIKE 'Manual transfer%'
        OR action = 'Manual match reversal'
     ORDER BY bookingId, createdAt`
  );
  const [transferRows]: any = await conn.query(
    `SELECT matchedBookingId, externalId, amount, senderName, transferDate
     FROM bank_transfers WHERE matchedBookingId IS NOT NULL`
  );

  const eventsByBooking = new Map<number, MatchEvent[]>();
  for (const r of actRows) {
    const ev = parseMatch(r.action, r.details, new Date(r.createdAt));
    if (!ev) continue;
    if (!eventsByBooking.has(r.bookingId)) eventsByBooking.set(r.bookingId, []);
    eventsByBooking.get(r.bookingId)!.push(ev);
  }

  const transfersByBooking = new Map<number, any[]>();
  for (const t of transferRows) {
    if (!transfersByBooking.has(t.matchedBookingId)) transfersByBooking.set(t.matchedBookingId, []);
    transfersByBooking.get(t.matchedBookingId)!.push(t);
  }

  const suspects: any[] = [];

  for (const b of bookingRows) {
    const events = eventsByBooking.get(b.id) ?? [];
    const matches = events.filter((e) => e.kind === "match");
    if (matches.length < 2) continue;

    // Group applications by (normalized sender, amount).
    const groups = new Map<string, MatchEvent[]>();
    for (const m of matches) {
      const key = `${normalizeSender(m.sender)}|${m.amount.toFixed(2)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }

    const dupGroups: any[] = [];
    for (const [key, group] of groups) {
      if (group.length < 2) continue;

      // A reversal between two applications makes the re-apply legitimate.
      const reversals = events.filter(
        (e) => e.kind === "reversal" && Math.abs(e.amount - group[0].amount) < 1.0
      );
      const explained = reversals.filter(
        (r) => r.at > group[0].at && r.at < group[group.length - 1].at
      ).length;
      const suspectCount = group.length - 1 - explained;
      if (suspectCount < 1) continue;

      // Cross-check: how many real transfer rows exist for this amount?
      const transfers = (transfersByBooking.get(b.id) ?? []).filter(
        (t: any) => Math.abs(parseFloat(t.amount) - group[0].amount) < 1.0
      );
      const preEpoch = group[0].at < TRANSFER_TABLE_EPOCH;

      let verdict: string;
      if (preEpoch) verdict = "UNVERIFIABLE (pre-dates bank_transfers table)";
      else if (transfers.length === 0) verdict = "UNVERIFIABLE (no transfer rows)";
      else if (group.length > transfers.length)
        verdict = `CONFIRMED (${group.length} applications vs ${transfers.length} real transfer${transfers.length === 1 ? "" : "s"})`;
      else verdict = "LIKELY GENUINE (one transfer row per application)";

      dupGroups.push({
        sender: group[0].sender,
        amount: group[0].amount,
        applications: group.length,
        explainedByReversal: explained,
        overcountedBy: suspectCount * group[0].amount,
        transferRows: transfers.length,
        verdict,
        dates: group.map((g) => g.at.toISOString().slice(0, 16).replace("T", " ")),
      });
    }

    if (dupGroups.length === 0) continue;

    const loggedSum = matches.reduce((s, m) => s + m.amount, 0);
    const overcount = dupGroups.reduce((s, g) => s + g.overcountedBy, 0);
    suspects.push({ booking: b, dupGroups, loggedSum, overcount });
  }

  // ─── Report ────────────────────────────────────────────────────────────────
  console.log("=".repeat(78));
  console.log("DUPLICATE PAYMENT AUDIT (read-only)");
  console.log(`Bookings scanned: ${bookingRows.length} | with >=2 transfer applications: ` +
    `${[...eventsByBooking.values()].filter((e) => e.filter((x) => x.kind === "match").length >= 2).length}`);
  console.log(`bank_transfers cross-check available from: ${TRANSFER_TABLE_EPOCH.toISOString().slice(0, 10)}`);
  console.log("=".repeat(78));

  if (suspects.length === 0) {
    console.log("\nNo bookings with repeated same-sender/same-amount applications found.\n");
  }

  for (const s of suspects) {
    const b = s.booking;
    console.log(`\n── Booking #${b.id} — ${b.guestName ?? "?"} (${b.property}, ${b.channel})`);
    console.log(`   check-in: ${new Date(b.checkIn).toISOString().slice(0, 10)} | status: ${b.status}`);
    console.log(`   totalPrice: ${b.totalPrice} | amountPaid (current): ${b.amountPaid}`);
    console.log(`   sum of all logged applications: ${s.loggedSum.toFixed(2)}`);
    for (const g of s.dupGroups) {
      console.log(`   ⚠ ${g.amount.toFixed(2)} PLN from "${g.sender}" applied ${g.applications}x` +
        (g.explainedByReversal ? ` (${g.explainedByReversal} explained by reversal)` : ""));
      console.log(`     dates: ${g.dates.join(" | ")}`);
      console.log(`     real transfer rows: ${g.transferRows} | overcounted by: ${g.overcountedBy.toFixed(2)} PLN`);
      console.log(`     verdict: ${g.verdict}`);
    }
    const implied = parseFloat(b.amountPaid) ;
    console.log(`   → if never double-counted, amountPaid would be ~${(s.loggedSum - s.overcount).toFixed(2)}` +
      ` (currently ${implied.toFixed(2)})`);
  }

  console.log("\n" + "=".repeat(78));
  console.log(`Bookings flagged: ${suspects.length}`);
  console.log(`Total apparent overcount: ${suspects.reduce((t, s) => t + s.overcount, 0).toFixed(2)} PLN`);
  console.log("NOTE: 'amountPaid (current)' may already reflect a manual correction.");

  // ─── Secondary sweep: overpayment ──────────────────────────────────────────
  // The grouping above keys on (sender, amount), so it only catches a replay
  // that re-parsed identically. A parser change between two reads of the same
  // email could yield a different amount and slip through. Any double-count
  // still inflates amountPaid, so sweep for that independently.
  console.log("\n" + "=".repeat(78));
  console.log("SECONDARY SWEEP: amountPaid exceeds what could plausibly be owed");
  console.log("(catches double-counts the sender/amount grouping would miss)");
  console.log("=".repeat(78));

  const flaggedIds = new Set(suspects.map((s) => s.booking.id));
  let overpaidCount = 0;
  for (const b of bookingRows) {
    const paid = parseFloat(b.amountPaid || "0");
    if (paid <= 0) continue;
    const total = parseFloat(b.totalPrice || "0");
    const revenue = parseFloat(b.hostRevenue || "0");
    const deposit = parseFloat(b.depositAmount || "0");
    if (total <= 0 && revenue <= 0) continue;

    // Most a booking could legitimately have received: full price (or the
    // portal payout, whichever is larger) plus the refundable deposit.
    const ceiling = Math.max(total, revenue) + deposit;
    if (paid <= ceiling + 1.0) continue;

    overpaidCount++;
    const ratio = ceiling > 0 ? paid / ceiling : 0;
    console.log(`\n#${b.id} — ${b.guestName ?? "?"} (${b.property}, ${b.channel}, ${b.status})` +
      `${flaggedIds.has(b.id) ? "  [also flagged above]" : ""}`);
    console.log(`   totalPrice: ${total.toFixed(2)} | hostRevenue: ${revenue.toFixed(2)} | deposit: ${deposit.toFixed(2)}`);
    console.log(`   amountPaid: ${paid.toFixed(2)} — exceeds ceiling ${ceiling.toFixed(2)} by ` +
      `${(paid - ceiling).toFixed(2)} PLN (${ratio.toFixed(2)}x)`);
  }
  if (overpaidCount === 0) console.log("\nNone — no booking shows an implausible amountPaid.\n");

  console.log("\n" + "=".repeat(78));
  console.log(`Overpaid bookings: ${overpaidCount}`);

  // ─── Third sweep: same transfer applied across different bookings ──────────
  // A re-read email is re-scored from scratch, so it can land on a *different*
  // booking the second time. That is not caught above (each booking sees only
  // one application) but is the same root cause and the same lost money.
  console.log("\n" + "=".repeat(78));
  console.log("THIRD SWEEP: same (sender, amount) applied to MULTIPLE bookings within 7 days");
  console.log("(a transfer credited to more than one booking — misattribution)");
  console.log("=".repeat(78));

  type Applied = { bookingId: number; at: Date; sender: string; amount: number; score: number | null };
  const liveBookingIds = new Set<number>(bookingRows.map((b: any) => b.id));
  const all: Applied[] = [];
  for (const [bookingId, evs] of eventsByBooking) {
    // Deleted bookings keep their activity rows; their history is not actionable.
    if (!liveBookingIds.has(bookingId)) continue;
    for (const e of evs) {
      if (e.kind === "match") all.push({ bookingId, at: e.at, sender: e.sender, amount: e.amount, score: e.score });
    }
  }
  const crossGroups = new Map<string, Applied[]>();
  for (const a of all) {
    const key = `${normalizeSender(a.sender)}|${a.amount.toFixed(2)}`;
    if (!crossGroups.has(key)) crossGroups.set(key, []);
    crossGroups.get(key)!.push(a);
  }

  let crossCount = 0;
  for (const [, group] of crossGroups) {
    const bookingIds = new Set(group.map((g) => g.bookingId));
    if (bookingIds.size < 2) continue;
    const sorted = [...group].sort((a, b) => a.at.getTime() - b.at.getTime());
    const spanDays = (sorted[sorted.length - 1].at.getTime() - sorted[0].at.getTime()) / 86_400_000;
    if (spanDays > 7) continue; // far apart — plausibly genuine separate payments

    // A re-assignment (revert on the old booking, then apply to the new one) is
    // a deliberate correction, not a misattribution. Drop applications that a
    // later reversal on the same booking undid.
    const stillCredited = sorted.filter((a) => {
      const reversals = (eventsByBooking.get(a.bookingId) ?? []).filter(
        (e) => e.kind === "reversal" && Math.abs(e.amount - a.amount) < 1.0 && e.at > a.at
      );
      return reversals.length === 0;
    });
    if (new Set(stillCredited.map((a) => a.bookingId)).size < 2) continue;

    crossCount++;
    console.log(`\n⚠ ${sorted[0].amount.toFixed(2)} PLN from "${sorted[0].sender}" credited to ${bookingIds.size} bookings:`);
    for (const g of sorted) {
      const bk = bookingRows.find((b: any) => b.id === g.bookingId);
      console.log(`   #${g.bookingId} (${bk?.guestName ?? "?"}) at ${g.at.toISOString().slice(0, 16).replace("T", " ")}` +
        ` — score ${g.score ?? "?"}`);
    }
    console.log(`   span: ${spanDays.toFixed(1)} days — at most one of these can be correct`);
  }
  if (crossCount === 0) console.log("\nNone — no transfer credited to more than one booking.\n");

  console.log("\n" + "=".repeat(78));
  console.log(`Cross-booking misattributions: ${crossCount}`);
  console.log("=".repeat(78));

  await conn.end();
}

main();
