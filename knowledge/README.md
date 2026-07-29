# Baza wiedzy o obiektach

Treść tych plików trafia w całości do promptu przy generowaniu odpowiedzi na maile
gości. Model traktuje je jako **jedyne** źródło wiedzy o obiekcie — jeśli czegoś tu
nie ma, nie wolno mu tego wymyślić; zamiast tego oznacza draft jako wymagający
Twojej decyzji.

## Zasady pisania

- **Pisz faktami, nie marketingiem.** „Zmywarka Bosch, tabletki w szafce pod
  zlewem" jest użyteczne. „W pełni wyposażona kuchnia" nie jest.
- **Rzeczy, których nie ma, są równie ważne jak te, które są.** Jeśli nie ma
  klimatyzacji albo windy, napisz to wprost. Inaczej model przemilczy pytanie
  zamiast odpowiedzieć „nie ma".
- **Sekcja „Czego nie obiecywać" jest obowiązkowa.** To jedyny mechanizm, który
  powstrzyma model przed potwierdzeniem czegoś, co zależy od kalendarza, pogody
  albo Twojej decyzji.
- Dane rezerwacji (daty, kwoty, liczba osób, depozyt) **nie należą tutaj** —
  pochodzą z bazy i są doklejane osobno przy każdym mailu.

## Pliki

Jeden plik na obiekt, nazwa musi odpowiadać wartości `property` w bazie
(`Sadoles`, `Hacjenda`), pisana małymi literami.

Pliki są czytane przy każdym generowaniu, więc zmiana treści działa od razu —
bez `pnpm build` i bez restartu usługi.
