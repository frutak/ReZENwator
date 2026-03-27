import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Home } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, addMonths, subMonths, addDays } from "date-fns";
import BookingDetailModal from "@/components/BookingDetailModal";
import { Booking } from "@shared/types";
import { Dialog } from "@/components/ui/dialog";
import { DoubleBookingBanner } from "@/components/DoubleBookingBanner";

// ─── Channel colours ──────────────────────────────────────────────────────────

const CHANNEL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  airbnb:    { bg: "#fce7f3", text: "#9d174d", border: "#f9a8d4" },
  booking:   { bg: "#dbeafe", text: "#1e40af", border: "#93c5fd" },
  slowhop:   { bg: "#ffe4e6", text: "#9f1239", border: "#fecdd3" },
  alohacamp: { bg: "#ccfbf1", text: "#115e59", border: "#99f6e4" },
  direct:    { bg: "#ede9fe", text: "#4c1d95", border: "#ddd6fe" },
  unknown:   { bg: "#f1f5f9", text: "#475569", border: "#e2e8f0" },
};

const CHANNEL_LABELS: Record<string, string> = {
  airbnb: "Airbnb",
  booking: "Booking.com",
  slowhop: "Slowhop",
  alohacamp: "Alohacamp",
  direct: "Direct",
};

// ─── Property Calendar Component ──────────────────────────────────────────────

function PropertyCalendar({
  property,
  bookings,
  month,
  onSelectBooking,
  onCreateBooking,
}: {
  property: string;
  bookings: Booking[];
  month: Date;
  onSelectBooking: (b: Partial<Booking>) => void;
  onCreateBooking: (property: string, date: Date) => void;
}) {
  const [tooltip, setTooltip] = useState<{ booking: Booking; x: number; y: number } | null>(null);

  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Add padding days for the start of the week (assuming week starts on Monday)
  const firstDayOfWeek = (getDay(monthStart) + 6) % 7;
  const paddingDays = Array.from({ length: firstDayOfWeek });

  return (
    <div className="bg-card border rounded-xl overflow-hidden shadow-sm relative">
      <div className="bg-muted/30 px-4 py-3 border-b flex items-center gap-2">
        <Home className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold">{property}</h3>
      </div>

      <div className="grid grid-cols-7 text-center border-b bg-muted/10">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="py-2 text-[10px] uppercase font-bold text-muted-foreground">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 auto-rows-[minmax(80px,auto)]">
        {paddingDays.map((_, i) => (
          <div key={`pad-${i}`} className="border-r border-b bg-muted/5 last:border-r-0" />
        ))}

        {days.map((day) => {
          const dayBookings = bookings.filter(
            (b) => {
              const matchesProperty = 
                b.property === property || 
                (property === "Sadoleś" && b.property === "Sadoles") ||
                (property === "Sadoles" && b.property === "Sadoleś");
              
              return matchesProperty && isSameDay(new Date(b.checkIn), day);
            }
          );

          // Find bookings that cover this day (ongoing)
          const ongoingBookings = bookings.filter(
            (b) => {
              const matchesProperty = 
                b.property === property || 
                (property === "Sadoleś" && b.property === "Sadoles") ||
                (property === "Sadoles" && b.property === "Sadoleś");

              return matchesProperty && 
                new Date(b.checkIn) < day &&
                new Date(b.checkOut) > day;
            }
          );

          return (
            <div 
              key={day.toString()} 
              className="border-r border-b p-1 min-h-[80px] last:border-r-0 group cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => onCreateBooking(property, day)}
            >
              <div className="text-right">
                <span className={`text-xs ${isSameDay(day, new Date()) ? "bg-primary text-white h-5 w-5 inline-flex items-center justify-center rounded-full" : "text-muted-foreground"}`}>
                  {format(day, "d")}
                </span>
              </div>
              <div className="mt-1 space-y-1">
                {/* Visual for ongoing bookings (horizontal lines) */}
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

                {/* Main booking entry (shown on start day) */}
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
              </div>
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
          <strong>{tooltip.booking.guestName || "Unknown"}</strong><br />
          {format(new Date(tooltip.booking.checkIn), "dd.MM")} - {format(new Date(tooltip.booking.checkOut), "dd.MM")}<br />
          {tooltip.booking.status}
        </div>
      )}
    </div>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="flex flex-wrap gap-4 mb-6 px-2">
      {Object.entries(CHANNEL_LABELS).map(([key, label]) => {
        const colors = CHANNEL_COLORS[key] || CHANNEL_COLORS.unknown;
        return (
          <div key={key} className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-sm border" style={{ backgroundColor: colors.bg, borderColor: colors.border }} />
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Calendar Page ───────────────────────────────────────────────────────

export default function CalendarView() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedBooking, setSelectedBooking] = useState<Partial<Booking> | null>(null);

  // Fetch bookings for a wide window around the current month (±2 months)
  const windowStart = useMemo(() => subMonths(month, 1), [month]);
  const windowEnd = useMemo(() => endOfMonth(addMonths(month, 1)), [month]);

  const { data: bookingList = [], isLoading } = trpc.bookings.list.useQuery({
    checkInFrom: windowStart,
    checkInTo: windowEnd,
    limit: 500,
  });

  // Combine real bookings and filter out cancelled ones
  const allBookings = useMemo(() => {
    return bookingList.filter(b => b.status !== "cancelled");
  }, [bookingList]);

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
            <div className="flex items-center bg-muted rounded-lg p-1">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMonth(subMonths(month, 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="px-3 text-sm font-semibold min-w-[120px] text-center">
                {format(month, "MMMM yyyy")}
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMonth(addMonths(month, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>
            Today
          </Button>
        </div>

        <Legend />

        <DoubleBookingBanner />

        {isLoading ? (
          <div className="text-center py-20 text-muted-foreground">Loading bookings…</div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <PropertyCalendar
              property="Sadoleś"
              bookings={allBookings}
              month={month}
              onSelectBooking={setSelectedBooking}
              onCreateBooking={(p, d) => setSelectedBooking({ 
                property: p === "Sadoleś" ? "Sadoles" : "Hacjenda" as any, 
                checkIn: d,
                checkOut: addDays(d, 2)
              })}
            />
            <PropertyCalendar
              property="Hacjenda"
              bookings={allBookings}
              month={month}
              onSelectBooking={setSelectedBooking}
              onCreateBooking={(p, d) => setSelectedBooking({ 
                property: p === "Sadoleś" ? "Sadoles" : "Hacjenda" as any, 
                checkIn: d,
                checkOut: addDays(d, 2)
              })}
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
