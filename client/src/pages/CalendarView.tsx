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

const CLEANING_COLORS = [
  { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", icon: "text-emerald-500" },
  { bg: "bg-sky-50", border: "border-sky-200", text: "text-sky-700", icon: "text-sky-500" },
  { bg: "bg-violet-50", border: "border-violet-200", text: "text-violet-700", icon: "text-violet-500" },
  { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", icon: "text-amber-500" },
];

const BOOKING_INFO_COLORS = [
  { bg: "bg-slate-100", border: "border-slate-300", text: "text-slate-700", bar: "bg-slate-400" },
  { bg: "bg-blue-100", border: "border-blue-300", text: "text-blue-700", bar: "bg-blue-400" },
  { bg: "bg-purple-100", border: "border-purple-300", text: "text-purple-700", bar: "bg-purple-400" },
  { bg: "bg-rose-100", border: "border-rose-300", text: "text-rose-700", bar: "bg-rose-400" },
];

function CleaningDateCell({ 
  booking, 
  gapStart, 
  gapEnd, 
  allBookings,
  onUpdate 
}: { 
  booking: Booking, 
  gapStart: Date | null, 
  gapEnd: Date, 
  allBookings: Booking[],
  onUpdate: (date: Date) => void 
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  const getDayGapInfo = (date: Date) => {
    const dStart = startOfDay(date);
    const dEnd = addDays(dStart, 1);
    
    // Find booking that checks out on this day
    const checkoutBooking = allBookings.find(b => 
      b.property === booking.property && 
      b.status !== "cancelled" && 
      isSameDay(new Date(b.checkOut), date)
    );
    
    // Find booking that checks in on this day
    const checkinBooking = allBookings.find(b => 
      b.property === booking.property && 
      b.status !== "cancelled" && 
      isSameDay(new Date(b.checkIn), date)
    );

    // Is there a booking that stays through the WHOLE day?
    const staysThrough = allBookings.find(b => 
      b.property === booking.property &&
      b.status !== "cancelled" &&
      new Date(b.checkIn) < dStart &&
      new Date(b.checkOut) > dEnd
    );

    if (staysThrough) return { hours: "", available: false };

    const start = checkoutBooking ? new Date(checkoutBooking.checkOut) : dStart;
    const end = checkinBooking ? new Date(checkinBooking.checkIn) : dEnd;
    
    const diffMs = end.getTime() - start.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    
    if (diffHours < 5) return { hours: "", available: false };

    let hoursText = t("cleaning.all_day");
    if (checkoutBooking && checkinBooking) {
      hoursText = `${t("cleaning.from")} ${format(start, "HH:mm")} ${t("cleaning.to")} ${format(end, "HH:mm")}`;
    } else if (checkoutBooking) {
      hoursText = `${t("cleaning.from")} ${format(start, "HH:mm")}`;
    } else if (checkinBooking) {
      hoursText = `${t("cleaning.to")} ${format(end, "HH:mm")}`;
    }

    return { hours: hoursText, available: true };
  };

  const selectedGapInfo = booking.cleaningDate ? getDayGapInfo(new Date(booking.cleaningDate)) : null;

  return (
    <div className="flex items-center gap-3">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={cn("w-[140px] justify-start text-left font-normal", !booking.cleaningDate && "text-muted-foreground")}>
            <CalendarIcon className="mr-2 h-3.5 w-3.5" />
            {booking.cleaningDate ? format(new Date(booking.cleaningDate), "dd.MM.yyyy") : t("cleaning.select_date")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            defaultMonth={new Date(booking.checkIn)}
            selected={booking.cleaningDate ? new Date(booking.cleaningDate) : undefined}
            onSelect={(date) => {

              if (date) {
                onUpdate(date);
                setOpen(false);
              }
            }}
            disabled={(date) => {
              // Rule 1: Must be within the overall cleaning gap
              if (gapStart && date < startOfDay(gapStart)) return true;
              if (date > startOfDay(gapEnd)) return true;
              
              // Rule 2: Must have at least 5 hours available on that specific day
              const info = getDayGapInfo(date);
              return !info.available;
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
      {selectedGapInfo?.hours && (
        <span className="text-[11px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
          {selectedGapInfo.hours}
        </span>
      )}
    </div>
  );
}

function CleaningTableView({ bookings, month }: { bookings: Booking[], month: Date }) {
  const { t } = useLanguage();
  const utils = trpc.useUtils();
  const updateDetails = trpc.bookings.updateDetails.useMutation({
    onSuccess: () => {
      toast.success(t("common.saved"));
      utils.bookings.list.invalidate();
    },
    onError: (err) => toast.error(t("common.error") + ": " + err.message)
  });

  const monthBookings = useMemo(() => {
    return bookings.filter(b => {
      const checkIn = new Date(b.checkIn);
      return checkIn.getMonth() === month.getMonth() && 
             checkIn.getFullYear() === month.getFullYear() &&
             b.property === "Hacjenda"; // Hard-coded filter for Hacjenda
    }).sort((a, b) => new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime());
  }, [bookings, month]);

  const bookingsWithGaps = useMemo(() => {
    const allSorted = [...bookings].sort((a, b) => new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime());
    
    return monthBookings.map(b => {
      const propBookings = allSorted.filter(ab => ab.property === b.property);
      const bIdx = propBookings.findIndex(pb => pb.id === b.id);
      const prevB = bIdx > 0 ? propBookings[bIdx - 1] : null;
      
      return {
        ...b,
        gapStart: prevB ? new Date(prevB.checkOut) : null,
        gapEnd: new Date(b.checkIn)
      };
    });
  }, [monthBookings, bookings]);

  return (
    <div className="bg-card border rounded-xl shadow-sm overflow-hidden mb-10">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="w-12 text-center">LP</TableHead>
            <TableHead>{t("cleaning.property")}</TableHead>
            <TableHead>{t("cleaning.guest")}</TableHead>
            <TableHead>{t("cleaning.arrival")}</TableHead>
            <TableHead>{t("cleaning.departure")}</TableHead>
            <TableHead className="text-center">{t("cleaning.people")}</TableHead>
            <TableHead>{t("cleaning.date")}</TableHead>
            <TableHead>{t("cleaning.staff")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bookingsWithGaps.map((b, i) => (
            <TableRow key={b.id}>
              <TableCell className="text-center font-medium text-muted-foreground">{i + 1}</TableCell>
              <TableCell>{b.property}</TableCell>
              <TableCell className="font-semibold">{getGuestName(b)}</TableCell>
              <TableCell>{format(new Date(b.checkIn), "dd.MM.yyyy")}</TableCell>
              <TableCell>{format(new Date(b.checkOut), "dd.MM.yyyy")}</TableCell>
              <TableCell className="text-center">{b.guestCount || 0}</TableCell>
              <TableCell>
                <CleaningDateCell 
                  booking={b} 
                  gapStart={b.gapStart} 
                  gapEnd={b.gapEnd} 
                  allBookings={bookings}
                  onUpdate={(date) => updateDetails.mutate({ id: b.id, cleaningDate: date })} 
                />
              </TableCell>
              <TableCell>
                <Select
                  value={b.cleaningStaff || ""}
                  onValueChange={(val) => {
                    updateDetails.mutate({ id: b.id, cleaningStaff: val as any });
                  }}
                >
                  <SelectTrigger className="w-[120px]">
                    <SelectValue placeholder="..." />
                  </SelectTrigger>
                  <SelectContent>
                    {CLEANING_STAFF.map(staff => (
                      <SelectItem key={staff} value={staff}>{staff}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
            </TableRow>
          ))}
          {bookingsWithGaps.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-20 text-muted-foreground">
                {t("cleaning.no_bookings")}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Cleaning Slot Modal ───────────────────────────────────────────────────────

function CleaningSlotModal({ slot, onClose }: { slot: { from: Date; to: Date; property: string } | null, onClose: () => void }) {
  const { t } = useLanguage();
  if (!slot) return null;

  return (
    <DialogContent className="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <SoapDispenserDroplet className="h-5 w-5 text-emerald-500" />
          {t("nav.cleaning")}
        </DialogTitle>
      </DialogHeader>
      <div className="py-6 space-y-6">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600">
            <Home className="h-6 w-6" />
          </div>
          <div>
            <h4 className="font-bold text-lg">{slot.property}</h4>
            <p className="text-sm text-muted-foreground">{t("calendar.cleaning_time")}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 rounded-xl bg-muted/50 border">
            <div className="flex items-center gap-2 mb-1 text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span className="text-[10px] font-bold uppercase">{t("cleaning.from")} ({t("cleaning.departure")})</span>
            </div>
            <p className="text-sm font-bold">{format(slot.from, "dd MMM HH:mm")}</p>
          </div>
          <div className="p-3 rounded-xl bg-muted/50 border">
            <div className="flex items-center gap-2 mb-1 text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span className="text-[10px] font-bold uppercase">{t("cleaning.to")} ({t("cleaning.arrival")})</span>
            </div>
            <p className="text-sm font-bold">{format(slot.to, "dd MMM HH:mm")}</p>
          </div>
        </div>

        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] font-bold text-emerald-700 uppercase mb-1">{t("nav.cleaning")}</span>
          <span className="text-2xl font-black text-emerald-800">
            {Math.floor((slot.to.getTime() - slot.from.getTime()) / (1000 * 60 * 60))}h {Math.floor(((slot.to.getTime() - slot.from.getTime()) / (1000 * 60)) % 60)}m
          </span>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={onClose} className="w-full">{t("common.save")}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

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

// ─── Legends ──────────────────────────────────────────────────────────────────

function BookingLegend() {
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

function CleaningLegend() {
  const { t } = useLanguage();
  return (
    <div className="flex flex-wrap gap-4 mb-6 px-2">
      <div className="flex items-center gap-1.5">
        <div className="h-3 w-3 rounded-sm border border-emerald-200 bg-emerald-50" />
        <span className="text-xs font-medium text-muted-foreground">{t("nav.cleaning")}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="h-3 w-3 rounded-sm border border-slate-200 bg-slate-50" />
        <span className="text-xs font-medium text-muted-foreground">{t("calendar.occupied")}</span>
      </div>
    </div>
  );
}

// ─── Main Calendar Page ───────────────────────────────────────────────────────

export default function CalendarView() {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [viewMode, setViewMode] = useState<"bookings" | "cleaning" | "cleaning_table">(() => {
    if (user?.viewAccess === "cleaning") return "cleaning";
    return "bookings";
  });

  const currentLocale = language === "PL" ? pl : enUS;

  const [selectedBooking, setSelectedBooking] = useState<Partial<Booking> | null>(null);
  const [selectedCleaningSlot, setSelectedCleaningSlot] = useState<{ from: Date; to: Date; property: string } | null>(null);

  useEffect(() => {
    if (user?.viewAccess === "cleaning") {
      setViewMode("cleaning");
    }
  }, [user]);

  const windowStart = useMemo(() => subMonths(month, 1), [month]);
  const windowEnd = useMemo(() => endOfMonth(addMonths(month, 1)), [month]);

  const { data: bookingList = [], isLoading: isLoadingBookings } = trpc.bookings.list.useQuery({
    checkInFrom: windowStart,
    checkInTo: windowEnd,
    limit: 500,
  });

  const allBookings = useMemo(() => {
    let list = bookingList.filter(b => b.status !== "cancelled");
    if (user?.propertyAccess) {
      list = list.filter(b => b.property === user.propertyAccess);
    }
    return list;
  }, [bookingList, user]);

  const canSeeBookings = !user?.viewAccess || user.viewAccess === "bookings";
  const canSeeCleaning = !user?.viewAccess || user.viewAccess === "cleaning";

  const showSadoles = !user?.propertyAccess || user.propertyAccess === "Sadoles";
  const showHacjenda = !user?.propertyAccess || user.propertyAccess === "Hacjenda";

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold tracking-tight">{t("nav.calendar")}</h1>
            <div className="flex items-center bg-muted rounded-lg p-1">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMonth(subMonths(month, 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="px-3 text-sm font-semibold min-w-[120px] text-center capitalize">
                {format(month, "MMMM yyyy", { locale: currentLocale })}
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMonth(addMonths(month, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Tabs defaultValue="bookings" value={viewMode} onValueChange={(v) => setViewMode(v as any)}>
              <TabsList 
                className={cn(
                  "grid", 
                  canSeeBookings && canSeeCleaning ? "w-[420px] grid-cols-3" : 
                  canSeeCleaning ? "w-[280px] grid-cols-2" : 
                  "w-[140px] grid-cols-1"
                )}
              >
                {canSeeBookings && (
                  <TabsTrigger value="bookings" className="flex items-center gap-2">
                    <CalendarIcon className="h-3.5 w-3.5" />
                    {t("nav.bookings")}
                  </TabsTrigger>
                )}
                {canSeeCleaning && (
                  <>
                    <TabsTrigger value="cleaning" className="flex items-center gap-2">
                      <SoapDispenserDroplet className="h-3.5 w-3.5" />
                      {t("nav.cleaning")}
                    </TabsTrigger>
                    <TabsTrigger value="cleaning_table" className="flex items-center gap-2">
                      <ListIcon className="h-3.5 w-3.5" />
                      {t("nav.table")}
                    </TabsTrigger>
                  </>
                )}
              </TabsList>
            </Tabs>
            <Button variant="outline" size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>
              {t("nav.today")}
            </Button>
          </div>
        </div>

        {viewMode === "bookings" ? <BookingLegend /> : <CleaningLegend />}

        <DoubleBookingBanner />

        {isLoadingBookings ? (
          <div className="text-center py-20 text-muted-foreground">Loading calendar data…</div>
        ) : (
          <>
            {viewMode === "cleaning_table" ? (
              <CleaningTableView bookings={allBookings} month={month} />
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {showSadoles && (
                  <PropertyCalendar
                    property="Sadoleś"
                    bookings={allBookings}
                    viewMode={viewMode === "bookings" ? "bookings" : "cleaning"}
                    month={month}
                    onSelectBooking={setSelectedBooking}
                    onSelectCleaningSlot={setSelectedCleaningSlot}
                    onCreateBooking={(p, d) => setSelectedBooking({ 
                      property: p === "Sadoleś" ? "Sadoles" : "Hacjenda" as any, 
                      checkIn: d,
                      checkOut: addDays(d, 2)
                    })}
                  />
                )}
                {showHacjenda && (
                  <PropertyCalendar
                    property="Hacjenda"
                    bookings={allBookings}
                    viewMode={viewMode === "bookings" ? "bookings" : "cleaning"}
                    month={month}
                    onSelectBooking={setSelectedBooking}
                    onSelectCleaningSlot={setSelectedCleaningSlot}
                    onCreateBooking={(p, d) => setSelectedBooking({ 
                      property: p === "Sadoleś" ? "Sadoles" : "Hacjenda" as any, 
                      checkIn: d,
                      checkOut: addDays(d, 2)
                    })}
                  />
                )}
              </div>
            )}
          </>
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

      {/* Cleaning slot modal */}
      <Dialog open={!!selectedCleaningSlot} onOpenChange={(open) => !open && setSelectedCleaningSlot(null)}>
        {selectedCleaningSlot && (
          <CleaningSlotModal
            slot={selectedCleaningSlot}
            onClose={() => setSelectedCleaningSlot(null)}
          />
        )}
      </Dialog>
    </DashboardLayout>
  );
}
