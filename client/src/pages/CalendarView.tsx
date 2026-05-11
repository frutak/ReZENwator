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


import { BookingLegend } from "@/components/calendar/Legends";
import { PropertyCalendar } from "@/components/calendar/PropertyCalendar";
import { CleaningSlotModal } from "@/components/calendar/CleaningSlotModal";
import { CleaningTableView } from "@/components/calendar/CleaningTableView";

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

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <Tabs defaultValue="bookings" value={viewMode} onValueChange={(v) => setViewMode(v as any)} className="w-full sm:w-auto">
              <TabsList 
                className={cn(
                  "grid w-full", 
                  canSeeBookings && canSeeCleaning ? "sm:w-[420px] grid-cols-3" : 
                  canSeeCleaning ? "sm:w-[280px] grid-cols-2" : 
                  "sm:w-[140px] grid-cols-1"
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
            <Button variant="outline" size="sm" onClick={() => setMonth(startOfMonth(new Date()))} className="w-full sm:w-auto">
              {t("nav.today")}
            </Button>
          </div>
        </div>

        {viewMode === "bookings" && <BookingLegend />}

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
