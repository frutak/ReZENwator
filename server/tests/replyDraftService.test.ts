import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  stripQuotedText,
  looksAutomated,
  extractJsonObject,
  generateReplyDraft,
  DraftOutputSchema,
} from "../services/ReplyDraftService";
import { buildFactSheet } from "../services/GuestReplyContextService";
import { setLlmProvider } from "../services/llm";
import type { LlmProvider } from "../services/llm";

const booking = {
  id: 1,
  property: "Sadoles",
  channel: "direct",
  status: "confirmed",
  depositStatus: "pending",
  checkIn: new Date("2026-08-14T16:00:00Z"),
  checkOut: new Date("2026-08-17T10:00:00Z"),
  guestName: "Jan Kowalski",
  guestCountry: "PL",
  guestPhone: "600100200",
  guestCount: 6,
  adultsCount: 4,
  childrenCount: 2,
  animalsCount: 0,
  totalPrice: "4200.00",
  amountPaid: "1200.00",
  depositAmount: "500.00",
  currency: "PLN",
  purpose: "leisure",
  companyName: null,
} as any;

const VALID_OUTPUT = {
  shouldReply: true,
  intent: "question_logistics",
  needsHuman: false,
  missingInfo: [],
  language: "PL",
  subject: "Re: Pytanie o przyjazd",
  body: "Cześć, dom będzie dostępny od 16. pozdrawiam, Jan",
  notes: "Standardowe pytanie o godzinę przyjazdu.",
  proposedAnimalsCount: null,
};

function fakeProvider(text: string | null, available = true): LlmProvider {
  return {
    name: "fake",
    isAvailable: async () => available,
    generate: async () =>
      text === null ? null : { text, provider: "fake", model: "fake-model", durationMs: 1 },
  };
}

describe("stripQuotedText", () => {
  it("cuts the quoted history at a '>' block", () => {
    const body = "Czy możemy przyjechać wcześniej?\n\n> Witajcie, potwierdzam rezerwację\n> pozdrawiam";
    expect(stripQuotedText(body)).toBe("Czy możemy przyjechać wcześniej?");
  });

  it("cuts at a Polish reply header", () => {
    const body = "Dziękujemy!\n\nW dniu 2026-07-01 Jan napisał:\nStara treść";
    expect(stripQuotedText(body)).toBe("Dziękujemy!");
  });

  it("leaves a message with no quoted history untouched", () => {
    expect(stripQuotedText("Krótkie pytanie")).toBe("Krótkie pytanie");
  });
});

describe("looksAutomated", () => {
  it("flags an out-of-office reply", () => {
    expect(looksAutomated("Automatyczna odpowiedź", "Jestem na urlopie do 1 sierpnia")).toBe(true);
  });

  it("does not flag an ordinary guest question", () => {
    expect(looksAutomated("Pytanie", "O której możemy przyjechać?")).toBe(false);
  });
});

describe("extractJsonObject", () => {
  it("parses a bare object", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("recovers an object wrapped in a code fence", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("recovers an object surrounded by prose", () => {
    expect(extractJsonObject('Oto odpowiedź:\n{"a":1}\nGotowe.')).toEqual({ a: 1 });
  });

  it("returns null when there is no object", () => {
    expect(extractJsonObject("nie ma tu JSON-a")).toBeNull();
  });
});

describe("buildFactSheet", () => {
  it("states the outstanding balance rather than leaving it to be inferred", () => {
    const sheet = buildFactSheet(booking);
    expect(sheet).toContain("Kwota całkowita: 4200.00 PLN");
    expect(sheet).toContain("Wpłynęło na nasze konto: 1200.00 PLN");
    expect(sheet).toContain("Pozostało do zapłaty przez gościa: 3000.00 PLN");
    // Direct booking: every złoty goes to the owner, so nothing is owed by a portal.
    expect(sheet).not.toContain("przelew od portalu");
  });

  it("marks an unknown total as missing instead of dropping the line", () => {
    const sheet = buildFactSheet({ ...booking, totalPrice: null });
    expect(sheet).toContain("Kwota całkowita: brak danych");
    expect(sheet).toContain("Pozostało do zapłaty przez gościa: brak danych");
  });

  it("asks a Slowhop guest for their own balance, not for the account's", () => {
    // Booking #172 as it stood when its reminder went out: the portal's forward
    // of 161.70 had landed, the guest still owed 980 for the stay plus the
    // kaucja. The old sheet said 1238.30 — totalPrice minus what the account had
    // received — and the owner had to correct that figure by hand.
    const sheet = buildFactSheet({
      ...booking,
      channel: "slowhop",
      totalPrice: "1400.00",
      hostRevenue: "1141.70",
      reservationFee: "420.00",
      amountPaid: "161.70",
      depositStatus: "pending",
    });

    expect(sheet).toContain("Pozostało do zapłaty przez gościa: 980.00 PLN");
    expect(sheet).toContain("Razem z depozytem gość ma do zapłaty: 1480.00 PLN");
    expect(sheet).toContain("Zaliczka zapłacona portalowi: 420.00 PLN");
    expect(sheet).not.toContain("1238.30");
    // The forward is in, so nothing is outstanding from Slowhop's side.
    expect(sheet).not.toContain("przelew od portalu");
  });

  it("separates what the portal still owes from what the guest owes", () => {
    // Alohacamp #181: nothing has arrived yet. The account is waiting for
    // 2701.85, but 176.85 of that is Alohacamp's forward — asking the guest for
    // it would overcharge them.
    const sheet = buildFactSheet({
      ...booking,
      channel: "alohacamp",
      status: "pending",
      totalPrice: "2700.00",
      hostRevenue: "2201.85",
      reservationFee: "675.00",
      amountPaid: "0.00",
      depositStatus: "pending",
    });

    expect(sheet).toContain("Pozostało do zapłaty przez gościa: 2025.00 PLN");
    expect(sheet).toContain("Razem z depozytem gość ma do zapłaty: 2525.00 PLN");
    expect(sheet).toContain("Czekamy jeszcze na przelew od portalu: 176.85 PLN");
  });

  it("forbids promising an early arrival even when the day before is free", () => {
    const sheet = buildFactSheet(booking, { earlyArrivalPossible: true });
    expect(sheet).toContain("NIE wolno go obiecywać");
  });

  it("rules out an early arrival when the day before is taken", () => {
    const sheet = buildFactSheet(booking, { earlyArrivalPossible: false });
    expect(sheet).toContain("NIE jest możliwy");
  });

  it("always states the declared animal count, including zero", () => {
    expect(buildFactSheet(booking)).toContain("Zwierzęta zgłoszone przy rezerwacji: 0");
  });
});

describe("generateReplyDraft", () => {
  afterEach(() => setLlmProvider(null));

  const call = () =>
    generateReplyDraft({
      booking,
      guestSubject: "Pytanie o przyjazd",
      guestBody: "O której możemy przyjechać?",
    });

  it("returns a validated draft", async () => {
    setLlmProvider(fakeProvider(JSON.stringify(VALID_OUTPUT)));
    const outcome = await call();
    expect(outcome?.draft.intent).toBe("question_logistics");
    expect(outcome?.provider).toBe("fake");
  });

  it("returns null when the provider is unavailable", async () => {
    setLlmProvider(fakeProvider(JSON.stringify(VALID_OUTPUT), false));
    expect(await call()).toBeNull();
  });

  it("returns null when generation fails", async () => {
    setLlmProvider(fakeProvider(null));
    expect(await call()).toBeNull();
  });

  it("returns null rather than a half-draft when the schema is not satisfied", async () => {
    setLlmProvider(fakeProvider(JSON.stringify({ ...VALID_OUTPUT, intent: "wymyslona_intencja" })));
    expect(await call()).toBeNull();
  });

  it("returns null when the model answers with prose instead of JSON", async () => {
    setLlmProvider(fakeProvider("Jasne, napiszę im że mogą przyjechać od 16!"));
    expect(await call()).toBeNull();
  });
});

describe("DraftOutputSchema", () => {
  it("rejects an unknown intent", () => {
    expect(DraftOutputSchema.safeParse({ ...VALID_OUTPUT, intent: "nope" }).success).toBe(false);
  });

  it("accepts a definite animal count as a proposal", () => {
    const parsed = DraftOutputSchema.safeParse({ ...VALID_OUTPUT, proposedAnimalsCount: 1 });
    expect(parsed.success).toBe(true);
  });

  it("requires the animal count to be explicit or explicitly absent", () => {
    const { proposedAnimalsCount, ...withoutField } = VALID_OUTPUT as any;
    expect(DraftOutputSchema.safeParse(withoutField).success).toBe(false);
  });

  it("accepts a draft that flags missing facts", () => {
    const parsed = DraftOutputSchema.safeParse({
      ...VALID_OUTPUT,
      needsHuman: true,
      missingInfo: ["liczba łazienek"],
    });
    expect(parsed.success).toBe(true);
  });
});
