import { startOfDay } from "date-fns";
import { BookingRepository } from "../repositories/BookingRepository";
import { GuestReplyRepository } from "../repositories/GuestReplyRepository";
import { generateReplyDraft, looksAutomated } from "../services/ReplyDraftService";
import { sendDraftForApproval } from "../_core/email";
import { Logger } from "../_core/logger";
import { getGuestName } from "../_core/utils/booking";
import type { Property } from "@shared/config";

export interface GuestReplyDraftSummary {
  considered: number;
  drafted: number;
  skipped: number;
  failed: number;
  details: string[];
}

/**
 * Turns recorded guest emails into drafted replies.
 *
 * Runs as a pass separate from the poller so that a slow or unavailable model
 * never delays reading the mailbox, and so a failure here can be retried
 * without re-fetching mail.
 *
 * Nothing reaches the guest. Every draft lands in `pending` and is mailed to the
 * owner for review — the auto-send path arrives with the approval UI, and until
 * the owner has seen enough drafts to trust them there is nothing to automate.
 */
export async function processGuestReplyDrafts(limit = 20): Promise<GuestReplyDraftSummary> {
  const summary: GuestReplyDraftSummary = { considered: 0, drafted: 0, skipped: 0, failed: 0, details: [] };

  const pending = await GuestReplyRepository.findPendingDrafting(limit);
  console.log(`[GuestReplyWorker] ${pending.length} inbound emails awaiting a draft.`);

  for (const row of pending) {
    summary.considered++;

    try {
      // An out-of-office bounce is not a guest asking a question. The poller
      // records it because it cannot see headers; this is where it stops.
      if (looksAutomated(row.inboundSubject ?? "", row.inboundBody ?? "")) {
        await GuestReplyRepository.update(row.id, {
          status: "cancelled",
          cancelledBy: "system",
          errorMessage: "Wiadomość wygląda na automatyczną (autoresponder lub powiadomienie).",
        });
        summary.skipped++;
        summary.details.push(`#${row.id}: pominięty jako automatyczny`);
        continue;
      }

      // An ambiguous match has no single booking to build a fact sheet from, so
      // there is nothing to ground a draft in. It goes straight to the owner.
      if (!row.bookingId) {
        await GuestReplyRepository.update(row.id, {
          status: "pending",
          needsHuman: 1,
          errorMessage: "Brak jednoznacznego dopasowania do rezerwacji — wymaga ręcznego przypisania.",
        });
        summary.skipped++;
        summary.details.push(`#${row.id}: bez rezerwacji, do ręcznego przypisania`);
        continue;
      }

      const booking = await BookingRepository.getBookingById(row.bookingId);
      if (!booking) {
        await GuestReplyRepository.update(row.id, {
          status: "failed",
          errorMessage: `Rezerwacja #${row.bookingId} już nie istnieje.`,
        });
        summary.failed++;
        continue;
      }

      // Same check the arrival reminder uses, so the draft and the reminder
      // cannot disagree about whether the day before is free.
      let earlyArrivalPossible: boolean | undefined;
      if (new Date(booking.checkIn) > new Date()) {
        const blocking = await BookingRepository.findBlockingBookingsForEarlyArrival(
          booking.property as Property,
          booking.id,
          startOfDay(new Date(booking.checkIn))
        );
        earlyArrivalPossible = blocking.length === 0;
      }

      const outcome = await generateReplyDraft({
        booking,
        guestSubject: row.inboundSubject ?? "",
        guestBody: row.inboundBody ?? "",
        factSheetOptions: { earlyArrivalPossible },
      });

      if (!outcome) {
        await GuestReplyRepository.update(row.id, {
          status: "failed",
          errorMessage: "Model nie zwrócił poprawnego draftu — szczegóły w logach.",
        });
        summary.failed++;
        summary.details.push(`#${row.id}: generowanie nieudane`);
        continue;
      }

      const d = outcome.draft;

      await GuestReplyRepository.update(row.id, {
        status: "pending",
        intent: d.intent,
        needsHuman: d.needsHuman ? 1 : 0,
        missingInfo: d.missingInfo,
        draftSubject: d.subject,
        draftBody: d.body,
        draftLanguage: d.language,
        proposedAnimalsCount: d.proposedAnimalsCount,
        provider: outcome.provider,
        modelNotes: d.notes,
        errorMessage: null,
      });

      await sendDraftForApproval({
        draftId: row.id,
        bookingId: booking.id,
        property: booking.property,
        guestName: getGuestName(booking),
        guestEmail: row.inboundFrom,
        guestSubject: row.inboundSubject ?? "",
        guestBody: row.inboundBody ?? "",
        intent: d.intent,
        needsHuman: d.needsHuman,
        missingInfo: d.missingInfo,
        proposedAnimalsCount: d.proposedAnimalsCount,
        notes: d.notes,
        draftSubject: d.subject,
        draftBody: d.body,
        shouldReply: d.shouldReply,
      });

      await Logger.bookingAction(
        booking.id,
        "email",
        "Drafted reply to guest email",
        `Intent: ${d.intent}, needsHuman: ${d.needsHuman}, model: ${outcome.model} (${outcome.durationMs}ms)`
      );

      summary.drafted++;
      summary.details.push(`#${row.id}: ${d.intent}${d.needsHuman ? " (wymaga Ciebie)" : ""}`);
    } catch (err) {
      console.error(`[GuestReplyWorker] Failed on draft #${row.id}:`, err);
      summary.failed++;
      summary.details.push(`#${row.id}: błąd — ${String(err)}`);
      try {
        await GuestReplyRepository.update(row.id, { status: "failed", errorMessage: String(err) });
      } catch {
        // The row stays `new` and the next run retries it. Nothing else to do.
      }
    }
  }

  console.log(
    `[GuestReplyWorker] Done: ${summary.drafted} drafted, ${summary.skipped} skipped, ${summary.failed} failed.`
  );
  return summary;
}
