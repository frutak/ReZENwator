import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";

type Language = "PL" | "EN";

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const translations: Record<Language, Record<string, string>> = {
  EN: {
    "nav.bookings": "Bookings",
    "nav.calendar": "Calendar",
    "nav.pricing": "Pricing",
    "nav.operations": "Operations",
    "nav.signout": "Sign out",
    "nav.today": "Today",
    "nav.cleaning": "Cleaning",
    "nav.table": "Table",
    "nav.language": "Language",
    "common.save": "Save",
    "common.cancel": "Cancel",
    "common.loading": "Loading...",
    "calendar.month": "Month",
    "calendar.year": "Year",
    "cleaning.staff": "Staff",
    "cleaning.date": "Cleaning Date",
    "cleaning.property": "Property",
    "cleaning.guest": "Guest",
    "cleaning.arrival": "Arrival",
    "cleaning.departure": "Departure",
    "cleaning.people": "People",
    "cleaning.no_bookings": "No bookings for this property this month.",
    "cleaning.all_day": "All day",
    "cleaning.from": "from",
    "cleaning.to": "to",
    "cleaning.select_date": "Select date",
    "dashboard.title": "Bookings",
    "dashboard.subtitle": "Manage your property reservations across all channels",
    "dashboard.check_email": "Check email",
    "dashboard.check_ical": "Check iCal",
    "dashboard.new_booking": "New Booking",
    "dashboard.no_bookings": "No bookings found matching your filters.",
    "dashboard.total_revenue": "Total Revenue",
    "dashboard.confirmed_bookings": "Confirmed Bookings",
    "dashboard.pending_deposits": "Pending Deposits",
    "dashboard.avg_nightly": "Avg. Nightly",
    "dashboard.filter_all": "All",
    "dashboard.filter_property": "Property",
    "dashboard.filter_channel": "Channel",
    "dashboard.filter_status": "Status",
    "dashboard.filter_time": "Time Range",
    "common.night": "night",
    "common.nights": "nights",
    "common.error": "Error",
    "common.success": "Success",
    "common.saved": "Saved",
    "calendar.view_cleaning": "Cleaning View",
    "calendar.cleaning_time": "Time for cleaning and maintenance",
    "calendar.guests_short": "guests",
    "calendar.animals_short": "pets",
    "calendar.occupied": "Occupied",
    "alert.double_booking": "Double-Booking Detected",
    "alert.double_booking_desc": "There are overlapping bookings on the same property. Please review the following conflicts:",
  },
  PL: {
    "nav.bookings": "Rezerwacje",
    "nav.calendar": "Kalendarz",
    "nav.pricing": "Cennik",
    "nav.operations": "Operacje",
    "nav.signout": "Wyloguj",
    "nav.today": "Dzisiaj",
    "nav.cleaning": "Sprzątanie",
    "nav.table": "Tabelka",
    "nav.language": "Język",
    "common.save": "Zapisz",
    "common.cancel": "Anuluj",
    "common.loading": "Ładowanie...",
    "calendar.month": "Miesiąc",
    "calendar.year": "Rok",
    "cleaning.staff": "Sprzątająca",
    "cleaning.date": "Dzień sprzątania",
    "cleaning.property": "Obiekt",
    "cleaning.guest": "Gość",
    "cleaning.arrival": "Przyjazd",
    "cleaning.departure": "Wyjazd",
    "cleaning.people": "Osób",
    "cleaning.no_bookings": "Brak rezerwacji dla tego obiektu w tym miesiącu.",
    "cleaning.all_day": "Cały dzień",
    "cleaning.from": "od",
    "cleaning.to": "do",
    "cleaning.select_date": "Wybierz datę",
    "dashboard.title": "Rezerwacje",
    "dashboard.subtitle": "Zarządzaj rezerwacjami ze wszystkich kanałów",
    "dashboard.check_email": "Sprawdź e-mail",
    "dashboard.check_ical": "Sprawdź iCal",
    "dashboard.new_booking": "Nowa rezerwacja",
    "dashboard.no_bookings": "Nie znaleziono rezerwacji pasujących do filtrów.",
    "dashboard.total_revenue": "Przychód całkowity",
    "dashboard.confirmed_bookings": "Potwierdzone rezerwacje",
    "dashboard.pending_deposits": "Oczekujące kaucje",
    "dashboard.avg_nightly": "Średnia za noc",
    "dashboard.filter_all": "Wszystkie",
    "dashboard.filter_property": "Obiekt",
    "dashboard.filter_channel": "Kanał",
    "dashboard.filter_status": "Status",
    "dashboard.filter_time": "Zakres czasu",
    "common.night": "noc",
    "common.nights": "noce",
    "common.error": "Błąd",
    "common.success": "Sukces",
    "common.saved": "Zapisano",
    "calendar.view_cleaning": "Widok sprzątania",
    "calendar.cleaning_time": "Czas na sprzątanie i konserwację",
    "calendar.guests_short": "os.",
    "calendar.animals_short": "zw.",
    "calendar.occupied": "Zajęte",
    "alert.double_booking": "Wykryto podwójną rezerwację",
    "alert.double_booking_desc": "Istnieją nakładające się rezerwacje na ten sam obiekt. Proszę sprawdź konflikty:",
  }
};

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [language, setInternalLanguage] = useState<Language>("EN");

  const updateLanguageMutation = trpc.user.updateLanguage.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
    }
  });

  useEffect(() => {
    if (user?.language) {
      setInternalLanguage(user.language as Language);
    }
  }, [user?.language]);

  const setLanguage = (lang: Language) => {
    setInternalLanguage(lang);
    if (user) {
      updateLanguageMutation.mutate({ language: lang });
    }
  };

  const t = useMemo(() => (key: string) => {
    return translations[language][key] || key;
  }, [language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return context;
}
