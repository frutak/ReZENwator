import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Home } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, addMonths, subMonths } from "date-fns";
import BookingDetailModal, { Booking } from "@/components/BookingDetailModal";
import { Dialog } from "@/components/ui/dialog";

// ─── Channel colours ──────────────────────────────────────────────────────────

const CHANNEL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  airbnb:    { bg: "#fce7f3", text: "#9d174d", border: "#f9a8d4" },
  booking:   { bg: "#dbeafe", text: "#1e40af", border: "#93c5fd" },
  slowhop:   { bg: "#ffe4e6", text: "#9f1239", border: "#fca5a5" },
  alohacamp: { bg: "#ccfbf1", text: "#115e59", border: "#5eead4" },
  direct:    { bg: "#ede9fe", text: "#4c1d95", border: "#c4b5fd" },
};

const CHANNEL_LABELS: Record<string, string> = {
  airbnb: "Airbnb",
  booking: "Booking.com",
  slowhop: "Slowhop",
  alohacamp: "Alohacamp",
  direct: "Direct",
};

// ─── Property Calendar ────────────────────────────────────────────────────────

function PropertyCalendar({
  property,
  bookings,
  month,
  onSelectBooking,
}: {
  property: string;
  bookings: Booking[];
  month: Date;
  onSelectBooking: (b: Booking) => void;
}) {
  const [tooltip, setTooltip] = useState<{ booking: Booking; x: number; y: number } | null>(null);

  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Pad the start so the first day aligns to the correct weekday (Mon = 0)
  const startDow = (getDay(monthStart) + 6) % 7; // convert Sun=0 to Mon=0
  const paddingDays = Array.from({ length: startDow });

  const propertyBookings = bookings.filter(
    (b) => b.property === property || b.property === property.replace("ś", "s")
  );

  function getBookingsForDay(day: Date): Booking[] {
    return propertyBookings.filter((b) => {
      const checkIn = new Date(b.checkIn);
      const checkOut = new Date(b.checkOut);
      // A day is "occupied" if it falls within [checkIn, checkOut)
      return day >= checkIn && day < checkOut;
    });
  }

  function isCheckIn(day: Date, b: Booking) {
    return isSameDay(day, new Date(b.checkIn));
  }

  function isCheckOut(day: Date, b: Booking) {
    return isSameDay(day, new Date(b.checkOut));
  }

  const today = new Date();

  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      {/* Property header */}
      <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
        <Home className="h-4 w-4 text-primary" />
        <span className="font-semibold text-sm">{property}</span>
        <span className="text-xs text-muted-foreground ml-1">
          ({propertyBookings.length} booking{propertyBookings.length !== 1 ? "s" : ""} this view)
        </span>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 border-b">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="text-center text-xs font-medium text-muted-foreground py-2">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7">
        {/* Padding cells */}
        {paddingDays.map((_, i) => (
          <div key={`pad-${i}`} className="min-h-[80px] border-r border-b bg-muted/10" />
        ))}

        {/* Day cells */}
        {days.map((day) => {
          const dayBookings = getBookingsForDay(day);
          const isToday = isSameDay(day, today);
          const isWeekend = [5, 6].includes((getDay(day) + 6) % 7);

          return (
            <div
              key={day.toISOString()}
              className={`min-h-[80px] border-r border-b p-1 relative ${
                isWeekend ? "bg-slate-50/60" : "bg-white"
              } ${isToday ? "ring-2 ring-inset ring-primary/40" : ""}`}
            >
              {/* Day number */}
              <div
                className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${
                  isToday
                    ? "bg-primary text-white"
                    : "text-muted-foreground"
                }`}
              >
                {format(day, "d")}
              </div>

              {/* Booking blocks */}
              <div className="flex flex-col gap-0.5">
                {dayBookings.slice(0, 3).map((b) => {
                  const colors = CHANNEL_COLORS[b.channel] ?? { bg: "#f1f5f9", text: "#475569", border: "#e2e8f0" };
                  const cin = isCheckIn(day, b);
                  const cout = isCheckOut(day, b);
                  return (
                    <div
                      key={b.id}
                      className="text-[10px] px-1 py-0.5 rounded cursor-pointer truncate leading-tight"
                      style={{
                        backgroundColor: colors.bg,
                        color: colors.text,
                        borderLeft: `3px solid ${colors.border}`,
                        opacity: b.status === "finished" ? 0.6 : 1,
                      }}
                      title={`${b.guestName ?? "Guest"} · ${CHANNEL_LABELS[b.channel] ?? b.channel} · ${format(new Date(b.checkIn), "dd MMM")}–${format(new Date(b.checkOut), "dd MMM")}`}
                      onMouseEnter={(e) => {
                        const rect = (e.target as HTMLElement).getBoundingClientRect();
                        setTooltip({ booking: b, x: rect.left, y: rect.bottom + 4 });
                      }}
                      onMouseLeave={() => setTooltip(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectBooking(b);
                      }}
                    >
                      {cin ? "▶ " : ""}{b.guestName ?? CHANNEL_LABELS[b.channel] ?? b.channel}{cout ? " ◀" : ""}
                    </div>
                  );
                })}
                {dayBookings.length > 3 && (
                  <div className="text-[10px] text-muted-foreground px-1">
                    +{dayBookings.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-white border rounded-lg shadow-xl p-3 text-xs max-w-[220px] pointer-events-none"
          style={{ left: Math.min(tooltip.x, window.innerWidth - 240), top: tooltip.y }}
        >
          <p className="font-semibold text-sm mb-1">{tooltip.booking.guestName ?? "Unknown Guest"}</p>
          <p className="text-muted-foreground">
            {format(new Date(tooltip.booking.checkIn), "dd MMM yyyy")} →{" "}
            {format(new Date(tooltip.booking.checkOut), "dd MMM yyyy")}
          </p>
          <p className="mt-1">
            <span
              className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium"
              style={{
                backgroundColor: (CHANNEL_COLORS[tooltip.booking.channel] ?? { bg: "#f1f5f9" }).bg,
                color: (CHANNEL_COLORS[tooltip.booking.channel] ?? { text: "#475569" }).text,
              }}
            >
              {CHANNEL_LABELS[tooltip.booking.channel] ?? tooltip.booking.channel}
            </span>
            <span className="ml-2 capitalize text-muted-foreground">{tooltip.booking.status}</span>
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Channel legend ───────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="flex flex-wrap gap-3 mb-4">
      {Object.entries(CHANNEL_LABELS).map(([key, label]) => {
        const c = CHANNEL_COLORS[key];
        return (
          <div key={key} className="flex items-center gap-1.5 text-xs">
            <div
              className="w-3 h-3 rounded-sm border-l-2"
              style={{ backgroundColor: c.bg, borderColor: c.border }}
            />
            <span className="text-muted-foreground">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Calendar Page ───────────────────────────────────────────────────────

export default function CalendarView() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);

  // Fetch bookings for a wide window around the current month (±2 months)
  const windowStart = useMemo(() => subMonths(month, 1), [month]);
  const windowEnd = useMemo(() => endOfMonth(addMonths(month, 1)), [month]);

  const { data: bookingList = [], isLoading } = trpc.bookings.list.useQuery(
    {
      checkInFrom: windowStart,
      checkInTo: windowEnd,
      limit: 500,
    },
    { staleTime: 60_000 }
  );

  // Also fetch bookings that started before the window but overlap into it
  // (long stays that started in a previous month)
  const { data: overlapList = [] } = trpc.bookings.list.useQuery(
    {
      checkInFrom: subMonths(month, 3),
      checkInTo: windowStart,
      limit: 200,
    },
    { staleTime: 60_000 }
  );

  const allBookings = useMemo(() => {
    const seen = new Set<number>();
    const merged: Booking[] = [];
    for (const b of [...bookingList, ...overlapList]) {
      if (!seen.has(b.id)) {
        seen.add(b.id);
        merged.push(b as Booking);
      }
    }
    return merged;
  }, [bookingList, overlapList]);

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Sadoleś &amp; Hacjenda — monthly availability
            </p>
          </div>

          {/* Month navigation */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setMonth((m) => subMonths(m, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-semibold w-32 text-center">
              {format(month, "MMMM yyyy")}
            </span>
            <Button variant="outline" size="sm" onClick={() => setMonth((m) => addMonths(m, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMonth(startOfMonth(new Date()))}
              className="ml-2 text-xs"
            >
              Today
            </Button>
          </div>
        </div>

        {/* Legend */}
        <Legend />

        {isLoading ? (
          <div className="text-center py-20 text-muted-foreground">Loading bookings…</div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <PropertyCalendar
              property="Sadoleś"
              bookings={allBookings}
              month={month}
              onSelectBooking={setSelectedBooking}
            />
            <PropertyCalendar
              property="Hacjenda"
              bookings={allBookings}
              month={month}
              onSelectBooking={setSelectedBooking}
            />
          </div>
        )}
      </div>

      {/* Booking detail modal */}
      <Dialog open={!!selectedBooking} onOpenChange={(open) => !open && setSelectedBooking(null)}>
        {selectedBooking && (
          <BookingDetailModal
            booking={selectedBooking}
            onClose={() => setSelectedBooking(null)}
          />
        )}
      </Dialog>
    </DashboardLayout>
  );
}
