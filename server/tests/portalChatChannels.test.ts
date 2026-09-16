import { describe, it, expect, vi, beforeEach } from "vitest";
import { contactsGuestViaPortal, isGuestEmailMissing } from "@shared/config";

/**
 * Channels whose guest is reachable only inside the portal (Airbnb, Alohacamp).
 *
 * Alohacamp's confirmation carries a name and nothing else: the phone is held
 * back until the free-cancellation window closes and an address is never sent,
 * so the owner answers through the portal's reservation chat. Guest mail for
 * these bookings is therefore addressed to the owner, who pastes it in by hand
 * — and a blank `guestEmail` must not read as a data gap that blocks sending.
 */

process.env.OWNER_NAME = "Szymon Furtak";
process.env.BUSINESS_NAME = "Furtka - Szymon Furtak";
process.env.BANK_ACCOUNT_NUMBER = "11 1870 1045 2078 1067 6998 0001";
process.env.BLIK_NUMBER = "571525563";
process.env.SADOLES_MANAGER_NAME = "Iwona";
process.env.SADOLES_MANAGER_PHONE = "695-757-149";
process.env.SADOLES_ADDRESS = "Sadoleś 66, 07-130 Sadoleś";
process.env.SADOLES_GUIDE_PL = "https://example.invalid/pl";
process.env.SADOLES_GUIDE_EN = "https://example.invalid/en";

const { sendMailMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn().mockResolvedValue({ messageId: "1" }),
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn().mockReturnValue({ sendMail: sendMailMock }) },
}));
vi.mock("../repositories/SettingRepository", () => ({
  SettingRepository: { getAdminEmail: vi.fn().mockResolvedValue("owner@example.com") },
}));
vi.mock("../repositories/GuestEmailRepository", () => ({
  GuestEmailRepository: {
    insertEmailLog: vi.fn().mockResolvedValue(undefined),
    findEmailsByBookingId: vi.fn().mockResolvedValue([]),
  },
}));

import { EmailTemplateService } from "../services/EmailTemplateService";
import { getRecipientForEmail } from "../_core/email";

const alohaBooking: any = {
  id: 181,
  icalUid: "8896f74f8bae75f74a962fe6c56ebf83@alohacamp.com",
  property: "Sadoles",
  channel: "alohacamp",
  type: "normal",
  checkIn: new Date("2026-10-02T14:00:00Z"),
  checkOut: new Date("2026-10-04T08:00:00Z"),
  status: "confirmed",
  depositStatus: "pending",
  guestName: "Serhii Kozachenko",
  guestEmail: "", // Alohacamp never sends one
  guestPhone: "791018243",
  guestCountry: "PL",
  guestCount: 12,
  adultsCount: 10,
  childrenCount: 2,
  animalsCount: 0,
  purpose: "leisure",
  companyName: null,
  nip: null,
  totalPrice: "2700.00",
  amountPaid: "0.00",
  reservationFee: "675.00",
  depositAmount: "500.00",
  commission: "498.15",
  hostRevenue: "2201.85",
  currency: "PLN",
};

describe("channels with no guest address", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMailMock.mockResolvedValue({ messageId: "1" });
  });

  it("counts Airbnb and Alohacamp as portal-chat channels, and nothing else", () => {
    expect(contactsGuestViaPortal("airbnb")).toBe(true);
    expect(contactsGuestViaPortal("alohacamp")).toBe(true);
    expect(contactsGuestViaPortal("slowhop")).toBe(false);
    expect(contactsGuestViaPortal("booking")).toBe(false);
    expect(contactsGuestViaPortal("direct")).toBe(false);
  });

  it("does not call a blank Alohacamp address a missing one", () => {
    expect(isGuestEmailMissing(alohaBooking)).toBe(false);
    // A channel that does hand over an address still has to carry one.
    expect(isGuestEmailMissing({ ...alohaBooking, channel: "slowhop" })).toBe(true);
    expect(isGuestEmailMissing({ ...alohaBooking, channel: "direct" })).toBe(true);
    // And a booking that has an address is never missing it.
    expect(isGuestEmailMissing({ ...alohaBooking, channel: "direct", guestEmail: "a@b.pl" })).toBe(false);
  });

  it("sends an Alohacamp guest's mail to the owner, to be pasted into the portal chat", async () => {
    const recipient = await getRecipientForEmail("booking_confirmed", alohaBooking);
    expect(recipient).toBe("owner@example.com");
  });

  it("leaves Email off the missing-data alert for an Alohacamp booking", () => {
    const { html } = EmailTemplateService.getTemplates("missing_data_alert", alohaBooking, "PL");
    expect(html).not.toContain("<li>Email</li>");

    // The same booking on Slowhop genuinely is missing it.
    const slowhop = EmailTemplateService.getTemplates(
      "missing_data_alert",
      { ...alohaBooking, channel: "slowhop" },
      "PL",
    );
    expect(slowhop.html).toContain("<li>Email</li>");
  });

  it("names the portal in the owner's copy instead of showing a blank address", () => {
    const { html } = EmailTemplateService.getTemplates("booking_pending", alohaBooking, "PL");
    expect(html).toContain("Alohacamp - no guest email, reply via portal chat");
    expect(html).not.toContain("Airbnb - no guest email");
  });

  it("still asks an Alohacamp guest for the balance the portal has not collected", () => {
    // Contactability and settlement are separate: Alohacamp took only the
    // 675 zaliczka here, so the guest owes the rest — unlike an Airbnb guest,
    // who owes nothing. Routing mail to the owner must not change the money.
    const { html } = EmailTemplateService.getTemplates("arrival_reminder", alohaBooking, "PL", {
      isEarlyArrival: false,
    });
    expect(html).toContain("2025 zł oraz 500 zł depozytu");
  });
});

describe("guestEmailWorker on portal-chat channels", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not skip an Alohacamp booking just because it has no guest address", async () => {
    vi.resetModules();
    vi.doMock("../repositories/BookingRepository", () => ({
      BookingRepository: {
        findActiveBookingsForEmails: vi.fn().mockResolvedValue([
          {
            ...alohaBooking,
            checkIn: new Date(Date.now() + 86400000 * 30),
            checkOut: new Date(Date.now() + 86400000 * 35),
          },
        ]),
      },
    }));
    vi.doMock("../_core/logger", () => ({ Logger: { bookingAction: vi.fn() } }));
    const sendGuestEmail = vi.fn().mockResolvedValue({ success: true, recipient: "owner@example.com" });
    vi.doMock("../_core/email", () => ({
      sendGuestEmail,
      getRecipientForEmail: vi.fn().mockResolvedValue("owner@example.com"),
    }));

    const { processGuestEmails } = await import("../workers/guestEmailWorker");
    const summary = await processGuestEmails();

    expect(summary.details.some((d) => d.includes("#181"))).toBe(true);
    expect(sendGuestEmail).toHaveBeenCalledWith("booking_confirmed", expect.objectContaining({ id: 181 }));
  });
});
