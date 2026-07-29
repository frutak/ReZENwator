import { z } from "zod";
import type { Booking } from "../../drizzle/schema";
import { getLlmProvider } from "./llm";
import { buildFactSheet, loadPropertyKnowledge, type FactSheetOptions } from "./GuestReplyContextService";
import { ENV } from "../_core/env";
import type { Property } from "@shared/config";

/**
 * Intents that never send themselves, whatever the model's confidence.
 *
 * Each one can cost real money or a relationship if answered wrongly: a quoted
 * figure the guest then holds us to, a date change we cannot honour, a
 * complaint that needs a human tone. Everything else is fair game for the
 * auto-send path.
 */
export const AUTO_SEND_BLOCKED_INTENTS = ["question_payment", "change_request", "complaint"] as const;

export const DRAFT_INTENTS = [
  "question_logistics",
  "question_facilities",
  "question_area",
  "question_payment",
  "change_request",
  "complaint",
  "thanks_only",
  "info_provided",
  "other",
] as const;

export const DraftOutputSchema = z.object({
  /** False for messages that need no answer at all — a bare thank-you. */
  shouldReply: z.boolean(),
  intent: z.enum(DRAFT_INTENTS),
  /** True when the answer needed a fact the model did not have. */
  needsHuman: z.boolean(),
  missingInfo: z.array(z.string()).max(10),
  language: z.enum(["PL", "EN"]),
  subject: z.string().max(500),
  body: z.string().max(8000),
  /** One or two sentences for the owner, never sent to the guest. */
  notes: z.string().max(1000),
  /**
   * Animal count the message implies, or null when it says nothing definite.
   * A proposal for the owner to accept — never written to the booking here.
   */
  proposedAnimalsCount: z.number().int().min(0).max(10).nullable(),
});

export type DraftOutput = z.infer<typeof DraftOutputSchema>;

export interface DraftGenerationOutcome {
  draft: DraftOutput;
  provider: string;
  model: string;
  durationMs: number;
}

/**
 * Removes the quoted history a mail client appends when the guest hits reply.
 *
 * Without this the model receives our own template back as though the guest had
 * written it, and answers questions nobody asked. Cutting at the first quote
 * marker loses nothing that matters: the guest's own words are always above it.
 */
export function stripQuotedText(body: string): string {
  const lines = body.split(/\r?\n/);
  const cutMarkers = [
    /^>/,
    /^\s*-{2,}\s*Original Message\s*-{2,}/i,
    /^\s*_{5,}\s*$/,
    /^\s*On .+ wrote:\s*$/i,
    /^\s*(W )?dniu .+ (napisał|napisała|pisze)/i,
    /^\s*Od:\s/i,
    /^\s*From:\s/i,
    /^\s*Wiadomość napisana przez/i,
  ];

  const cutAt = lines.findIndex((l) => cutMarkers.some((m) => m.test(l)));
  const kept = cutAt === -1 ? lines : lines.slice(0, cutAt);
  return kept.join("\n").trim();
}

/**
 * Cheap check for machine-generated mail we should never answer.
 *
 * Header-based detection (`Auto-Submitted`, `X-Autoreply`) is strictly better
 * but the poller does not retain headers yet; these phrases catch the common
 * out-of-office replies until it does.
 */
export function looksAutomated(subject: string, body: string): boolean {
  const haystack = `${subject}\n${body}`.toLowerCase();
  return [
    "automatyczna odpowiedź",
    "auto-reply",
    "autoreply",
    "out of office",
    "poza biurem",
    "jestem na urlopie",
    "nie odpowiadaj na tę wiadomość",
    "do not reply",
    "delivery status notification",
    "undelivered mail",
  ].some((needle) => haystack.includes(needle));
}

function buildSystemPrompt(): string {
  const ownerFirstName = ENV.ownerName.split(" ")[0];

  return `Jesteś asystentem właściciela dwóch domów na wynajem krótkoterminowy. Twoim zadaniem jest przygotowanie odpowiedzi na wiadomość od gościa — odpowiedzi, którą właściciel wyśle pod swoim nazwiskiem.

# Ton
Piszesz tak, jak właściciel pisze do gości: ciepło, bezpośrednio, po ludzku.

**Zawsze zwracasz się per „Wy", nieformalnie i luźno** — tak, jak pisze się do znajomych. Nigdy „Pan", „Pani", „Państwo", nigdy formy typu „uprzejmie informujemy" czy „proszę Pani". Nie zmieniaj rejestru w zależności od tego, jak napisał gość: nawet jeśli on pisze oficjalnie, Ty odpisujesz na „Wy".

Bez korporacyjnego żargonu. Krótko — gość zadał pytanie, dostaje odpowiedź, a nie broszurę. Podpis: „pozdrawiam, ${ownerFirstName}".

# Zasada nadrzędna: tylko fakty, które dostałeś
Wolno Ci opierać się WYŁĄCZNIE na dwóch źródłach podanych niżej: opisie obiektu i danych rezerwacji. Nie wolno Ci:
- podawać żadnej liczby, kwoty, daty ani godziny, której tam nie ma,
- domyślać się wyposażenia, zasad ani cen na podstawie tego, jak zwykle bywa w takich domach,
- potwierdzać niczego z sekcji „Czego NIE obiecywać".

Jeśli odpowiedź wymaga informacji, której nie masz — ustaw needsHuman na true, wypisz brakującą informację w missingInfo i napisz treść odpowiedzi tak, żeby właściciel musiał tylko uzupełnić tę jedną rzecz. Nigdy nie zgaduj. Brak odpowiedzi jest zawsze lepszy niż odpowiedź nieprawdziwa.

Jeśli w opisie obiektu widzisz linijkę zaczynającą się od „BRAK:", to znaczy, że tej informacji nie mamy nigdzie — traktuj ją jako brakującą.

# Pieniądze zawsze wracają do właściciela
Jeśli wiadomość **w jakikolwiek sposób** dotyka pieniędzy — ceny pobytu, dopłaty, zwrotu, depozytu, faktury, opłaty za zwierzaka, terminu płatności, rozliczenia — ustaw intent na „question_payment", **niezależnie od tego, czego jeszcze dotyczy**. Wiadomość o trzech sprawach, z których jedna to pieniądze, jest wiadomością o pieniądzach.

Ta reguła istnieje po to, żeby żadna kwota nie trafiła do gościa bez przeczytania przez właściciela. Nie omijaj jej dlatego, że pytanie o pieniądze wydaje Ci się drobne albo że znasz odpowiedź.

# Język
Odpowiadasz w języku, w którym napisał gość. Jeśli nie da się tego jednoznacznie stwierdzić, kieruj się krajem gościa z danych rezerwacji, a w ostateczności pisz po polsku.

# Kiedy nie odpowiadać
Jeśli wiadomość nie wymaga odpowiedzi — samo „dziękujemy", potwierdzenie odbioru, informacja bez pytania — ustaw shouldReply na false. Zalewanie gości uprzejmościami jest gorsze niż milczenie.

# Format odpowiedzi
Zwracasz WYŁĄCZNIE obiekt JSON, bez markdown, bez komentarza, bez bloku kodu. Pola:
- shouldReply: boolean
- intent: jedna z wartości: ${DRAFT_INTENTS.join(", ")}
- needsHuman: boolean
- missingInfo: tablica krótkich opisów brakujących informacji (pusta, jeśli nic nie brakuje)
- language: "PL" albo "EN"
- subject: temat odpowiedzi (z prefiksem "Re: ", jeśli odpowiadasz na wiadomość)
- body: treść odpowiedzi jako czysty tekst, z podpisem
- notes: jedno-dwa zdania dla właściciela wyjaśniające, na co zwrócić uwagę; tego gość nie zobaczy
- proposedAnimalsCount: liczba zwierząt, z którymi gość faktycznie przyjedzie, albo null

# Kiedy wypełnić proposedAnimalsCount
Tylko wtedy, gdy z wiadomości **jednoznacznie** wynika, ile zwierząt gość przywiezie — na przykład „przyjedziemy z psem" albo „będą z nami dwa koty". Wpisujesz wtedy łączną liczbę zwierząt na cały pobyt, wliczając te już zgłoszone przy rezerwacji.

We wszystkich pozostałych przypadkach wpisujesz null. W szczególności null, gdy gość dopiero się zastanawia („zastanawiamy się nad zabraniem psa"), pyta o zasadę („czy można z psem?") albo mówi o zwierzęciu bez deklaracji przyjazdu z nim. Różnica między pytaniem a deklaracją to często jedno słowo — jeśli masz wątpliwość, wpisz null. To pole jest propozycją zmiany w rezerwacji, którą właściciel zatwierdza ręcznie; błędna propozycja kosztuje go więcej pracy niż jej brak.`;
}

function buildUserPrompt(input: {
  knowledge: string | null;
  factSheet: string;
  guestSubject: string;
  guestBody: string;
}): string {
  const knowledgeBlock = input.knowledge
    ? input.knowledge
    : "BRAK OPISU OBIEKTU. Nie masz żadnej wiedzy o tym domu — każde pytanie o wyposażenie, zasady czy okolicę oznacz jako needsHuman.";

  return `# Opis obiektu

${knowledgeBlock}

# Dane tej rezerwacji

${input.factSheet}

# Wiadomość od gościa

Temat: ${input.guestSubject}

${input.guestBody}`;
}

/**
 * Pulls a JSON object out of the model's answer.
 *
 * The CLI path cannot enforce a schema the way the API's structured outputs can,
 * so the model occasionally wraps the object in a fenced block despite being
 * told not to. Tolerating that is cheaper than discarding an otherwise good
 * draft; anything less recoverable falls through to a validation failure.
 */
export function extractJsonObject(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Drafts a reply to one guest email.
 *
 * Returns null whenever a draft cannot be produced honestly — provider
 * unavailable, generation failed, output that does not satisfy the schema. The
 * caller records that as "no draft" and the owner still receives the forwarded
 * email; a malformed draft is never salvaged into a half-answer.
 */
export async function generateReplyDraft(input: {
  booking: Booking;
  guestSubject: string;
  guestBody: string;
  factSheetOptions?: FactSheetOptions;
}): Promise<DraftGenerationOutcome | null> {
  const provider = getLlmProvider();
  if (!(await provider.isAvailable())) {
    console.warn(`[ReplyDraftService] Provider ${provider.name} unavailable, skipping draft.`);
    return null;
  }

  const knowledge = await loadPropertyKnowledge(input.booking.property as Property);
  const factSheet = buildFactSheet(input.booking, input.factSheetOptions);
  const guestBody = stripQuotedText(input.guestBody);

  const result = await provider.generate({
    systemPrompt: buildSystemPrompt(),
    userPrompt: buildUserPrompt({
      knowledge,
      factSheet,
      guestSubject: input.guestSubject,
      guestBody,
    }),
  });
  if (!result) return null;

  const parsed = DraftOutputSchema.safeParse(extractJsonObject(result.text));
  if (!parsed.success) {
    console.error("[ReplyDraftService] Model output failed validation:", parsed.error.issues);
    return null;
  }

  return {
    draft: parsed.data,
    provider: result.provider,
    model: result.model,
    durationMs: result.durationMs,
  };
}
