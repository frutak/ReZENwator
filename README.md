# ReZENwator
Otwarty CMS i Channel Manager dla najmu krótkoterminowego (Self-Hosted).

🔄 **Dwukierunkowa synchronizacja**: Booking.com, Airbnb, Slowhop, AlohaCamp.

🧘‍♂️ **Zautomatyzowany Zen**: System na bieżąco śledzi statusy rezerwacji i księgowanie płatności na Twoim koncie, zwalniając Cię z ręcznej papierologii.

🛒 **Direct Booking Engine**: Gotowy portal do przyjmowania rezerwacji bezpośrednich.

💸 **100% darmowy**: Tworzony przez hosta dla hostów. Zbuduj swój niezależny biznes bez płacenia abonamentów komercyjnym platformom.

---

### Główne Funkcje

*   **Ujednolicony Kalendarz**: Wizualizacja rezerwacji ze wszystkich kanałów (Slowhop, Airbnb, Booking.com, Alohacamp) w jednym, czytelnym widoku.
*   **Automatyzacja cyklu życia rezerwacji**: System wprowadza ustandaryzowany przepływ statusów dla każdej rezerwacji. Dba o to, aby wszystkie kluczowe kroki (opłata rezerwacyjna, dopłata, kaucja, wysyłka instrukcji dojazdu) działy się w odpowiednim czasie. Jeśli gość spóźnia się z wpłatą lub brakuje ważnych danych, system automatycznie flaguje problem i powiadamia administratora.
*   **Inteligentne dopasowywanie płatności**: System analizuje powiadomienia e-mail o przelewach przychodzących z Twojego banku (np. Nestbank). Używając logiki rozmytej (fuzzy matching), automatycznie paruje wpłaty z rezerwacjami, monitorując na bieżąco stan rozliczeń (zaliczki, kaucje, dopłaty).
*   **Automatyczna komunikacja z gościem**: Wysyłka spersonalizowanych wiadomości e-mail (przypomnienia, instrukcje z kodami do keylocka, podziękowania po pobycie) dokładnie wtedy, kiedy są potrzebne.
*   **Pricing Auditor**: Codzienne sprawdzanie cen na portalach, aby zapewnić spójność polityki cenowej we wszystkich kanałach sprzedaży.
*   **Detektor Double-Booking**: Natychmiastowe powiadomienia o wykryciu nakładających się rezerwacji między różnymi kanałami.
*   **Portal Gościa**: Wbudowana strona www do przyjmowania bezpośrednich rezerwacji i komunikacji.

---

### Integracje i Pozyskiwanie Danych

System wykorzystuje różne metody pozyskiwania pełnych danych rezerwacji (imię, e-mail, telefon, cena), które standardowo nie są dostępne w kanałach iCal:

1.  **Slowhop, AlohaCamp i Airbnb**: Integracja oparta na automatycznym parsowaniu wiadomości e-mail przesyłanych przez te portale po dokonaniu rezerwacji.
2.  **Booking.com**: Ze względu na specyfikę portalu, system wykorzystuje dedykowany skrypt pomocniczy. Skrypt uruchamiany w przeglądarce właściciela (przez rozszerzenie Tampermonkey) pozwala jednym kliknięciem pobrać pełne dane z extranetu Booking.com i przesłać je bezpiecznie do Twojej skrzynki odbiorczej, skąd system je pobierze.
3.  **Bank**: Integracja z powiadomieniami e-mail o przelewach przychodzących pozwala na automatyczne monitorowanie statusu płatności każdej rezerwacji bez konieczności ręcznego sprawdzania konta.

---

### Instalacja Skryptu Pomocniczego (Booking.com)

Aby w pełni korzystać z integracji z Booking.com i przesyłać kompletne dane rezerwacji do systemu:

1.  Zainstaluj rozszerzenie **Tampermonkey** w swojej przeglądarce (Chrome, Firefox, Edge).
2.  Dodaj nowy skrypt użytkownika i wklej zawartość pliku `scripts/booking_com_extractor.user.js`. **UWAGA:** W linii 14 skryptu zmień parametry konfiguracji EmailJS (Service ID, Template ID, Public Key) na swoje własne, aby dane trafiały do Twojego systemu.
3.  Zaloguj się do extranetu Booking.com i otwórz szczegóły dowolnej rezerwacji.
4.  W prawym górnym rogu pojawi się przycisk **"📩 Wyślij do systemu"**. Po jego kliknięciu dane zostaną przesłane do Twojej skrzynki, a ReZENwator automatycznie je przetworzy i wzbogaci rezerwację w kalendarzu.
