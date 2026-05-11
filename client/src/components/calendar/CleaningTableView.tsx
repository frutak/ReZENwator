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

export { CleaningDateCell, CleaningTableView };
