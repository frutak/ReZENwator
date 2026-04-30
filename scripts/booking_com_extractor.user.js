// ==UserScript==
// @name         Booking to Email System - DOM Only Fix
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Wysyła dane rezerwacji na EmailJS bazując tylko na widoku DOM
// @author       Ty
// @match        *://admin.booking.com/*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        SERVICE_ID:  '',
        TEMPLATE_ID: '',
        PUBLIC_KEY:  ''
    };

//email template: subject: Nowa rezerwacja: {{guest_name}} ({{booking_id}})
// Content: Nowa rezerwacja z Booking.com: Obiekt: {{hotel_name}} ID Rezerwacji: {{booking_id}} Gość: {{guest_name}} Kraj: {{guest_country}} Liczba gości: {{total_guests}} Termin: {{check_in}} do {{check_out}} Cena dla gościa: {{total_price}} Prowizja Booking: {{commission}} Email gościa: {{guest_email}}

    function getBookingDetails() {
        let data = {
            hotel_name: "Nieznany obiekt",
            guest_name: "Brak",
            guest_country: "Brak",
            total_guests: "Brak",
            check_in: "Brak",
            check_out: "Brak",
            total_price: "0",
            commission: "0",
            booking_id: "Brak",
            guest_email: "Brak"
        };

        // 1. Nazwa obiektu z tytułu
        if (document.title.includes('·')) {
            data.hotel_name = document.title.split('·')[0].trim();
        } else {
            const printInfo = document.querySelector('.res-details-print-info .bui-u-pull-start');
            if (printInfo) data.hotel_name = printInfo.innerText.trim();
        }

        // 2. Najlepsza metoda: Szukanie po klasach .res-content__label i .res-content__info
        const extractByLabel = (labelKeywords) => {
            const labels = Array.from(document.querySelectorAll('.res-content__label'));
            for (let label of labels) {
                const text = label.innerText.trim().toLowerCase();
                // Sprawdzamy czy etykieta zawiera któreś ze słów kluczowych
                if (labelKeywords.some(keyword => text.includes(keyword.toLowerCase()))) {
                    const infoElement = label.nextElementSibling;
                    if (infoElement && infoElement.classList.contains('res-content__info')) {
                        return infoElement.innerText.trim();
                    }
                }
            }
            return null;
        };

        // Zbieranie głównych danych za pomocą etykiet (wsparcie dla polskiego i angielskiego)
        data.check_in = extractByLabel(["Check-in", "Zameldowanie"]) || "Brak";
        data.check_out = extractByLabel(["Check-out", "Wymeldowanie"]) || "Brak";
        data.total_guests = extractByLabel(["Total guests", "Całkowita liczba gości", "Liczba gości"]) || "Brak";
        data.total_price = extractByLabel(["Total price", "Łączna cena"]) || "Brak";
        data.commission = extractByLabel(["Commission and charges", "Prowizja i opłaty"]) || "Brak";
        data.booking_id = extractByLabel(["Booking number", "Numer rezerwacji"]) || "Brak";

        // 3. Imię i Nazwisko gościa
        const nameEl = document.querySelector('[data-test-id="reservation-overview-name"]');
        if (nameEl) {
            data.guest_name = nameEl.innerText.trim();
        } else {
            data.guest_name = extractByLabel(["Guest name", "Imię i nazwisko gościa"]) || "Brak";
        }

        // 4. Kraj (flaga)
        const flagEl = document.querySelector('.bui-flag__text');
        if (flagEl) {
            data.guest_country = flagEl.innerText.trim().toUpperCase();
        }

        // 5. E-mail (wyciągany z linku mailto)
        const emailLink = document.querySelector('a[href^="mailto:"]');
        if (emailLink) {
            data.guest_email = emailLink.getAttribute('href').replace('mailto:', '').split('?')[0].trim();
        }

        // --- Zabezpieczenie ---
        // Przekonwertowanie wszystkiego na String i usunięcie podwójnych spacji/enterów
        Object.keys(data).forEach(key => {
            if (data[key]) {
                data[key] = String(data[key]).replace(/(\r\n|\n|\r)/gm, " ").replace(/\s+/g, ' ').trim();
            } else {
                data[key] = "Brak";
            }
        });

        return data;
    }

    // TWORZENIE PRZYCISKU
    const btn = document.createElement('button');
    btn.innerHTML = '📩 Wyślij do systemu';
    btn.style.cssText = 'position:fixed; top:80px; right:20px; z-index:999999; padding:12px 18px; background:#003580; color:white; border:2px solid #fff; border-radius:8px; cursor:pointer; font-weight:bold; box-shadow: 0 4px 6px rgba(0,0,0,0.3);';

    // Upewniamy się, że przycisk się doda nawet w SPA
    setInterval(() => {
        if (!document.getElementById('booking-to-email-btn')) {
            btn.id = 'booking-to-email-btn';
            document.body.appendChild(btn);
        }
    }, 1000);

    btn.onclick = function() {
        const reservationData = getBookingDetails();
        console.log("DANE WYCIĄGNIĘTE ZE STRONY:", reservationData);

        // Zabezpieczenie przed pustym kliknięciem (gdy nie jesteśmy na podstronie rezerwacji)
        if (reservationData.booking_id === "Brak" && reservationData.guest_name === "Brak") {
            alert("Nie udało się znaleźć danych rezerwacji na tej stronie. Otwórz szczegóły konkretnej rezerwacji.");
            return;
        }

        btn.innerHTML = '⏳ Wysyłanie...';
        btn.disabled = true;

        const payload = {
            service_id: CONFIG.SERVICE_ID,
            template_id: CONFIG.TEMPLATE_ID,
            user_id: CONFIG.PUBLIC_KEY,
            template_params: reservationData
        };

        GM_xmlhttpRequest({
            method: "POST",
            url: "https://api.emailjs.com/api/v1.0/email/send",
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify(payload),
            onload: function(response) {
                if (response.status === 200) {
                    btn.innerHTML = '✅ Wysłano!';
                    btn.style.background = '#28a745';
                } else {
                    btn.innerHTML = '❌ Błąd API';
                    console.error("EmailJS Error: ", response.responseText);
                    alert("EmailJS Error: " + response.responseText);
                }
                setTimeout(() => {
                    btn.innerHTML = '📩 Wyślij do systemu';
                    btn.style.background = '#003580';
                    btn.disabled = false;
                }, 3000);
            },
            onerror: function(err) {
                btn.innerHTML = '❌ Błąd sieci';
                console.error("Sieć:", err);
                btn.disabled = false;
            }
        });
    };
})();
