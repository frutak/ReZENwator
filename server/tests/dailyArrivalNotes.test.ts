import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMail = vi.fn().mockResolvedValue({ messageId: "<test>" });

vi.mock("../_core/email", () => ({
  GMAIL_USER: "app@example.com",
  getTransporter: () => ({ sendMail }),
  getRecipientForEmail: async () => "owner@example.com",
  sendAlertEmail: vi.fn(),
  sendGuestEmail: vi.fn(),
}));

import { sendConsolidatedAlertEmail } from "../workers/dailyAlerts";

const TODAY = new Date();
const TOMORROW = new Date(TODAY.getTime() + 24 * 60 * 60 * 1000);

function at(day: Date, hour: number) {
  const d = new Date(day);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function emptyData(overrides: Record<string, any> = {}) {
  return {
    stalePending: [],
    upcomingUnpaid: [],
    upcomingPendingDeposits: [],
    depositsToReturn: [],
    stalePortalPaid: [],
    bookingsMissingData: [],
    arrivalNotes: [],
    transitions: [],
    guestEmailSummary: { sentCount: 0, failedCount: 0, details: [] },
    failedSyncs: [],
    failedGuestEmails: [],
    latestSyncs: [],
    portalStats: [],
    ...overrides,
  } as any;
}

function lastMail() {
  return sendMail.mock.calls[sendMail.mock.calls.length - 1][0];
}

describe("daily report — arrival notes", () => {
  beforeEach(() => {
    sendMail.mockClear();
  });

  it("shows the note of a booking arriving today, labelled DZIŚ", async () => {
    await sendConsolidatedAlertEmail(
      emptyData({
        arrivalNotes: [
          {
            id: 72,
            property: "Sadoles",
            guestName: "Maja Gibalska",
            type: "normal",
            checkIn: at(TODAY, 12),
            checkOut: at(TOMORROW, 10),
            notes: "Zgoda na przyjazd pierwszej grupy ok 12, zeby podekorować",
          },
        ],
      })
    );

    const { html, subject } = lastMail();
    expect(html).toContain("Notatki do przyjazdów");
    expect(html).toContain("Zgoda na przyjazd pierwszej grupy ok 12");
    expect(html).toContain("DZIŚ");
    expect(html).not.toContain("JUTRO");
    expect(subject).toContain("1 notatki do przyjazdów");
  });

  it("labels an arrival the day after as JUTRO", async () => {
    await sendConsolidatedAlertEmail(
      emptyData({
        arrivalNotes: [
          {
            id: 21,
            property: "Hacjenda",
            guestName: "Kimberly Gorski",
            type: "normal",
            checkIn: at(TOMORROW, 15),
            checkOut: at(new Date(TOMORROW.getTime() + 86400000), 10),
            notes: "Dostęp do piwnicy",
          },
        ],
      })
    );

    expect(lastMail().html).toContain("JUTRO");
  });

  it("escapes note text so a stray tag cannot break the mail", async () => {
    await sendConsolidatedAlertEmail(
      emptyData({
        arrivalNotes: [
          {
            id: 1,
            property: "Sadoles",
            guestName: "Jan Kowalski",
            type: "block",
            checkIn: at(TODAY, 16),
            checkOut: at(TOMORROW, 10),
            notes: "ekipa <b>remontowa</b> & pies",
          },
        ],
      })
    );

    const { html } = lastMail();
    expect(html).toContain("ekipa &lt;b&gt;remontowa&lt;/b&gt; &amp; pies");
    // A block is a real thing happening at the property, but it is not a guest.
    expect(html).toContain("[block]");
  });

  it("says nothing at all when no arrival carries a note", async () => {
    await sendConsolidatedAlertEmail(emptyData());

    const { html, subject } = lastMail();
    expect(html).not.toContain("Notatki do przyjazdów");
    expect(subject).not.toContain("notatki");
  });
});
