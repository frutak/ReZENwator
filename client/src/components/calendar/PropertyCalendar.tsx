import { useState, useMemo, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Home, Calendar as CalendarIcon, Loader2, SoapDispenserDroplet, Clock } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, addMonths, subMonths, addDays, startOfDay } from "date-fns";
import { pl, enUS } from "date-fns/locale";
import BookingDetailModal from "@/components/BookingDetailModal";
import { Booking } from "@shared/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DoubleBookingBanner } from "@/components/DoubleBookingBanner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, getGuestName } from "@/lib/utils";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLanguage } from "@/contexts/LanguageContext";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { toast } from "sonner";
import { ListIcon } from "lucide-react";
import { CLEANING_STAFF } from "@shared/config";


import { CHANNEL_COLORS, CHANNEL_LABELS, CLEANING_COLORS, BOOKING_INFO_COLORS } from "./constants";
// ─── Property Calendar Component ──────────────────────────────────────────────

function PropertyCalendar({
  property,
  bookings,
  viewMode,
  month,
  onSelectBooking,
  onCreateBooking,
  onSelectCleaningSlot,
}: {
  property: string;
  bookings: Booking[];
  viewMode: "bookings" | "cleaning";
  month: Date;
  onSelectBooking: (b: Partial<Booking>) => void;
  onCreateBooking: (property: string, date: Date) => void;
  onSelectCleaningSlot?: (slot: { from: Date; to: Date; property: string }) => void;
}) {
  const { t, language } = useLanguage();
  const currentLocale = language === "PL" ? pl : enUS;
  const [tooltip, setTooltip] = useState<{ content: React.ReactNode; x: number; y: number } | null>(null);

  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const propName = property === "Sadoleś" ? "Sadoles" : property;
  const propBookings = useMemo(() => 
    bookings.filter(b => b.property === propName).sort((a,b) => new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime()),
    [bookings, propName]
  );

  const cleaningSlots = useMemo(() => {
    const slots: { from: Date; to: Date; property: string }[] = [];
    for (let i = 0; i < propBookings.length - 1; i++) {
      const current = propBookings[i];
      const next = propBookings[i+1];
      const from = new Date(current.checkOut);
      const to = new Date(next.checkIn);
      
      if (to > from) {
        slots.push({ from, to, property });
      }
    }
    return slots;
  }, [propBookings, property]);

  // Add padding days for the start of the week (assuming week starts on Monday)
  const firstDayOfWeek = (getDay(monthStart) + 6) % 7;
  const paddingDays = Array.from({ length: firstDayOfWeek });

  return (
    <div className="bg-card border rounded-xl overflow-hidden shadow-sm relative">
      <div className="bg-muted/30 px-4 py-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Home className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold">{property}</h3>
        </div>
        {viewMode === "cleaning" && (
          <span className="text-[10px] font-bold text-emerald-600 uppercase bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 flex items-center gap-1">
            <SoapDispenserDroplet className="h-3 w-3" /> {t("calendar.view_cleaning")}
          </span>
        )}
      </div>

      <div className="grid grid-cols-7 text-center border-b bg-muted/10">
        {[0, 1, 2, 3, 4, 5, 6].map((dayIdx) => {
          // date-fns day index: 0 is Sunday, 1 is Monday...
          // Our grid starts with Monday (1), so we map i=0 to Mon, i=1 to Tue...
          const date = new Date(2024, 0, 1 + dayIdx); // 2024-01-01 is Monday
          return (
            <div key={dayIdx} className="py-2 text-[10px] uppercase font-bold text-muted-foreground">
              {format(date, "EEE", { locale: currentLocale })}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-7 auto-rows-[minmax(80px,auto)]">
        {paddingDays.map((_, i) => (
          <div key={`pad-${i}`} className="border-r border-b bg-muted/5 last:border-r-0" />
        ))}

        {days.map((day) => {
          const propName = property === "Sadoleś" ? "Sadoles" : property;
          
          const dayBookings = bookings.filter(
            (b) => b.property === propName && isSameDay(new Date(b.checkIn), day)
          );

          const ongoingBookings = bookings.filter(
            (b) => b.property === propName && new Date(b.checkIn) < day && new Date(b.checkOut) > day
          );

          const isClickable = viewMode === "cleaning" 
            ? !(dayBookings.length > 0 || ongoingBookings.length > 0)
            : true;

          let bgClass = "";
          if (viewMode === "cleaning") {
            const activeBooking = bookings.find(b => b.property === propName && b.status !== "cancelled" && (
              isSameDay(startOfDay(new Date(b.checkIn)), startOfDay(day)) ||
              (startOfDay(day) > startOfDay(new Date(b.checkIn)) && startOfDay(day) <= startOfDay(new Date(b.checkOut)))
            ));
            
            if (activeBooking) {
              const bIdx = propBookings.findIndex(pb => pb.id === activeBooking.id);
              const color = BOOKING_INFO_COLORS[bIdx % BOOKING_INFO_COLORS.length];
              bgClass = color.bg;
            }
          }

          return (
            <div 
              key={day.toString()} 
              className={cn(
                "border-r border-b p-1 min-h-[80px] last:border-r-0 group transition-colors",
                bgClass,
                isClickable ? "cursor-pointer hover:border-primary/50" : "cursor-not-allowed"
              )}
              onClick={() => {
                if (!isClickable) return;
                if (viewMode === "bookings") onCreateBooking(property, day);
              }}
            >
              <div className="text-right flex justify-between items-start">
                <div className="flex-1" />
                <span className={`text-xs ${isSameDay(day, new Date()) ? "bg-primary text-white h-5 w-5 inline-flex items-center justify-center rounded-full" : "text-muted-foreground"}`}>
                  {format(day, "d")}
                </span>
              </div>

              {viewMode === "bookings" ? (
                <div className="mt-1 space-y-1">
                  {ongoingBookings.map((b) => {
                    const colors = CHANNEL_COLORS[b.channel] || CHANNEL_COLORS.unknown;
                    return (
                      <div
                        key={`ongoing-${b.id}`}
                        className="h-1.5 rounded-full opacity-40"
                        style={{ backgroundColor: colors.bg, border: `1px solid ${colors.border}` }}
                      />
                    );
                  })}

                  {dayBookings.map((b) => {
                    const colors = CHANNEL_COLORS[b.channel] || CHANNEL_COLORS.unknown;
                    const cin = isSameDay(new Date(b.checkIn), day);
                    const cout = isSameDay(new Date(b.checkOut), day);

                    return (
                      <div
                        key={b.id}
                        className="text-[10px] leading-tight px-1.5 py-1 rounded border shadow-sm cursor-pointer transition-transform hover:scale-105"
                        style={{
                          backgroundColor: colors.bg,
                          color: colors.text,
                          borderLeft: `3px solid ${colors.border}`,
                          opacity: b.status === "finished" ? 0.6 : 1,
                        }}
                        onMouseEnter={(e) => {
                          const rect = (e.target as HTMLElement).getBoundingClientRect();
                          setTooltip({ 
                            content: (
                              <>
                                <strong>{getGuestName(b)}</strong><br />
                                {format(new Date(b.checkIn), "dd.MM HH:mm")} - {format(new Date(b.checkOut), "dd.MM HH:mm")}<br />
                                {b.status}
                              </>
                            ), 
                            x: rect.left, 
                            y: rect.bottom + 4 
                          });
                        }}
                        onMouseLeave={() => setTooltip(null)}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectBooking(b);
                        }}
                      >
                        {cin ? "▶ " : ""}{getGuestName(b)}{cout ? " ◀" : ""}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-1 space-y-1">
                  {/* Cleaning slots first */}
                  {cleaningSlots.filter(slot => {
                    const s = startOfDay(slot.from);
                    const e = startOfDay(slot.to);
                    const d = startOfDay(day);
                    return d >= s && d <= e;
                  }).map((slot, idx) => {
                    const starts = isSameDay(slot.from, day);
                    const ends = isSameDay(slot.to, day);
                    
                    const originalIdx = cleaningSlots.findIndex(s => s.from.getTime() === slot.from.getTime());
                    const color = CLEANING_COLORS[originalIdx % CLEANING_COLORS.length];

                    return (
                      <div
                        key={`cleaning-${idx}`}
                        className={cn(
                          "text-[10px] leading-tight px-1.5 py-1 cursor-pointer transition-all flex items-center gap-1 group/slot",
                          color.text,
                          starts && ends ? cn("rounded border shadow-sm mx-0.5", color.bg, color.border) :
                          starts ? cn("rounded-l border-y border-l ml-0.5", color.bg, color.border) :
                          ends ? cn("rounded-r border-y border-r mr-0.5", color.bg, color.border) :
                          cn("border-y", color.bg, color.border)
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectCleaningSlot?.(slot);
                        }}
                      >
                        <SoapDispenserDroplet className={cn("h-2.5 w-2.5 shrink-0", color.icon)} />
                        <span className="truncate font-medium">
                          {starts ? format(slot.from, "HH:mm") : (ends ? format(slot.to, "HH:mm") : "")}
                          {!starts && !ends && <span className="opacity-0">.</span>}
                        </span>
                      </div>
                    );
                  })}

                  {/* Booked blocks in cleaning view */}
                  {bookings.filter(b => b.property === propName && b.status !== "cancelled" && (
                    isSameDay(startOfDay(new Date(b.checkIn)), startOfDay(day)) ||
                    (startOfDay(day) > startOfDay(new Date(b.checkIn)) && startOfDay(day) <= startOfDay(new Date(b.checkOut)))
                  )).map((b) => {
                    const isFirstDay = isSameDay(startOfDay(new Date(b.checkIn)), startOfDay(day));
                    const bIdx = propBookings.findIndex(pb => pb.id === b.id);
                    const color = BOOKING_INFO_COLORS[bIdx % BOOKING_INFO_COLORS.length];

                    if (isFirstDay) {
                      return (
                        <div
                          key={`info-start-${b.id}`}
                          className={cn(
                            "text-[9px] leading-tight px-1 py-0.5 rounded border flex items-center justify-between opacity-80",
                            color.bg, color.text, color.border
                          )}
                        >
                          <span className="font-bold">{b.guestCount || 0} {t("calendar.guests_short")}</span>
                          <span>{b.animalsCount || 0} {t("calendar.animals_short")}</span>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={`info-ongoing-${b.id}`}
                        className={cn(
                          "h-1 rounded-full border opacity-60 mx-1",
                          color.bar, color.border
                        )}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Mini Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-popover text-popover-foreground px-2 py-1 rounded border shadow-lg text-[10px] pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.content}
        </div>
      )}
    </div>
  );
}

export { PropertyCalendar };
