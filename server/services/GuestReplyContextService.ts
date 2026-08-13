import fs from "fs/promises";
import path from "path";
import { format, differenceInCalendarDays } from "date-fns";
import { pl } from "date-fns/locale";
import type { Booking } from "../../drizzle/schema";
import { ENV } from "../_core/env";
import { getGuestName } from "../_core/utils/booking";
import type { Property } from "@shared/config";
import { calculateAmountsDue } from "@shared/utils";

const KNOWLEDGE_DIR = path.resolve(process.cwd(), "knowledge");

/**
 * Property knowledge, read from disk on every call.
 *
 * Deliberately uncached: the owner edits these files to correct what the model
 * tells guests, and a stale cache would mean an edit silently not taking effect
 * until the next restart. At a few generations a month the read is free, and
 * `knowledge/README.md` promises this behaviour to whoever edits the files.
 *
 * Returns null when the file is missing — the caller must treat that as "no
 * knowledge", not as an empty house.
 */
export async function loadPropertyKnowledge(property: Property): Promise<string | null> {
  const file = path.join(KNOWLEDGE_DIR, `${property.toLowerCase()}.md`);
  try {
    const text = await fs.readFile(file, "utf8");
    return text.trim() || null;
  } catch (err) {
    console.error(`[GuestReplyContext] Missing or unreadable knowledge file ${file}:`, err);
    return null;
  }
}

function money(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function line(label: string, value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  return `- ${label}: ${value}`;
}

/** Per-property contacts and codes, all sourced from ENV like the templates. */
function propertyFacts(property: Property): string[] {
  if (property === "Sadoles") {
    return [
      `- Adres: ${ENV.sadolesAddress}`,
      `- Kod do keylocka: ${ENV.sadolesKeylockCode}`,
      `- Opiekun obiektu: ${ENV.sadolesManagerName}${ENV.sadolesManagerPhone ? `, tel. ${ENV.sadolesManagerPhone}` : ""}`,
      `- Przewodnik dla gości (PL): ${ENV.sadolesGuidePl}`,
      `- Przewodnik dla gości (EN): ${ENV.sadolesGuideEn}`,
    ];
  }
  return [
    `- Adres: ${ENV.hacjendaAddress}`,
    `- Kod do keylocka: ${ENV.hacjendaKeylockCode}`,
    `- Manager obiektu: ${ENV.hacjendaManagerName}${ENV.hacjendaManagerPhone ? `, tel. ${ENV.hacjendaManagerPhone}` : ""}`,
    `- Przewodnik dla gości (PL): ${ENV.hacjendaGuidePl}`,
    `- Przewodnik dla gości (EN): ${ENV.hacjendaGuideEn}`,
  ];
}

export interface FactSheetOptions {
  /** True when no booking blocks the day before check-in. */
  earlyArrivalPossible?: boolean;
  now?: Date;
}

/**
 * The authoritative facts for one booking, rendered for the prompt.
 *
 * This is the only place the model may take numbers, dates and codes from. Every
 * value here comes from the database row or ENV — the same sources the outbound
 * templates use — so a reply cannot contradict a confirmation the guest already
 * received.
 *
 * Amounts that are genuinely unknown are rendered as "brak danych" rather than
 * omitted: a missing line reads as "not applicable", while an explicit unknown
 * is what should stop the model from inventing a figure.
 */
export function buildFactSheet(booking: Booking, options: FactSheetOptions = {}): string {
  const now = options.now ?? new Date();
  const checkIn = new Date(booking.checkIn);
  const checkOut = new Date(booking.checkOut);
  const nights = differenceInCalendarDays(checkOut, checkIn);

  const total = money(booking.totalPrice);
  const paid = money(booking.amountPaid) ?? 0;
  const deposit = money(booking.depositAmount);
  const currency = booking.currency ?? "PLN";
  // What the guest still owes, which on a portal booking is not the account
  // balance: `amountPaid` counts only money that reached the owner and excludes
  // the zaliczka the guest paid the portal, while part of what is still due may
  // be the portal's forward rather than the guest's to send.
  const due = calculateAmountsDue(booking);
  const prepaidToPortal = money(booking.reservationFee) ?? 0;

  const stayPhase =
    checkOut < now ? "pobyt zakończony" : checkIn > now ? "pobyt jeszcze przed nami" : "gość jest teraz na miejscu";

  const rows: Array<string | null> = [
    `- Obiekt: ${booking.property}`,
    ...propertyFacts(booking.property as Property),
    `- Kanał rezerwacji: ${booking.channel}`,
    `- Status rezerwacji: ${booking.status}`,
    `- Faza pobytu: ${stayPhase}`,
    "",
    `- Gość: ${getGuestName(booking)}`,
    line("Kraj gościa", booking.guestCountry),
    line("Telefon", booking.guestPhone),
    "",
    `- Przyjazd: ${format(checkIn, "EEEE, d MMMM yyyy", { locale: pl })}, od godziny 16:00`,
    `- Wyjazd: ${format(checkOut, "EEEE, d MMMM yyyy", { locale: pl })}, do godziny 10:00`,
    `- Liczba nocy: ${nights}`,
    options.earlyArrivalPossible === undefined
      ? null
      : options.earlyArrivalPossible
        ? "- Dzień przed przyjazdem obiekt jest wolny, więc wcześniejszy przyjazd jest technicznie możliwy — ale wymaga naszego potwierdzenia i NIE wolno go obiecywać w odpowiedzi."
        : "- Dzień przed przyjazdem obiekt jest zajęty przez inną rezerwację — wcześniejszy przyjazd NIE jest możliwy.",
    "",
    line("Liczba osób", booking.guestCount),
    line("Dorośli", booking.adultsCount),
    line("Dzieci", booking.childrenCount),
    `- Zwierzęta zgłoszone przy rezerwacji: ${booking.animalsCount ?? 0}`,
    "",
    `- Kwota całkowita: ${total === null ? "brak danych" : `${total.toFixed(2)} ${currency}`}`,
    prepaidToPortal > 0
      ? `- Zaliczka zapłacona portalowi: ${prepaidToPortal.toFixed(2)} ${currency} — gość ma ją już z głowy, na nasze konto trafia pomniejszona o prowizję`
      : null,
    `- Wpłynęło na nasze konto: ${paid.toFixed(2)} ${currency}` +
      (prepaidToPortal > 0 ? " (łącznie z przelewem portalu — to NIE jest to, co wpłacił gość)" : ""),
    `- Pozostało do zapłaty przez gościa: ${total === null ? "brak danych" : `${due.guestStayDue.toFixed(2)} ${currency}`}`,
    total !== null && due.depositDue > 0
      ? `- Razem z depozytem gość ma do zapłaty: ${due.guestDue.toFixed(2)} ${currency}`
      : null,
    due.portalDue > 0
      ? `- Czekamy jeszcze na przelew od portalu: ${due.portalDue.toFixed(2)} ${currency} — tego NIE żądamy od gościa`
      : null,
    `- Depozyt: ${deposit === null ? "brak danych" : `${deposit.toFixed(2)} ${currency}`}, status: ${booking.depositStatus}`,
    `- Numer konta do wpłat: ${ENV.bankAccountNumber}`,
    `- Nazwisko do przelewu: ${ENV.ownerName}`,
    ENV.blikNumber ? `- BLIK: ${ENV.blikNumber}` : null,
  ];

  return rows.filter((r) => r !== null).join("\n");
}
