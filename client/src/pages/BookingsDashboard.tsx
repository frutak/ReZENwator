import { useState, useMemo, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
} from "@/components/ui/dialog";
import {
  Calendar,
  RefreshCw,
  TrendingUp,
  Clock,
  CheckCircle2,
  Mail,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Search,
  Filter,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import BookingDetailModal from "@/components/BookingDetailModal";
import { StatusBadge, DepositBadge, ChannelBadge } from "@/components/ui/badges";
import { Booking } from "@shared/types";
import { DoubleBookingBanner } from "@/components/DoubleBookingBanner";
import { cn, getGuestName } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";

// ─── Sort helpers ─────────────────────────────────────────────────────────────

type SortKey = "property" | "channel" | "guestName" | "checkIn" | "checkOut" | "nights" | "status" | "depositStatus" | "revenue";
type SortDir = "asc" | "desc";

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ArrowUpDown className="inline ml-1 h-3 w-3 opacity-40" />;
  return sortDir === "asc"
    ? <ArrowUp className="inline ml-1 h-3 w-3 text-primary" />
    : <ArrowDown className="inline ml-1 h-3 w-3 text-primary" />;
}

// ─── Stats Cards ──────────────────────────────────────────────────────────────

function StatsCards({ filters }: { filters: { property?: string; channel?: string; status?: string; timeRange?: string } }) {
  const { t } = useLanguage();
  const allExceptCancelled: ("pending" | "confirmed" | "portal_paid" | "paid" | "finished" | "cancelled")[] = ["pending", "confirmed", "portal_paid", "paid", "finished"];
  const activeStatuses: ("pending" | "confirmed" | "portal_paid" | "paid" | "finished" | "cancelled")[] = ["pending", "confirmed", "portal_paid", "paid"];
  
  const statusFilter = useMemo(() => {
    if (filters.status === "all") return allExceptCancelled;
    if (filters.status === "active") return activeStatuses;
    return [filters.status as any];
  }, [filters.status]);

  const { data: stats } = trpc.bookings.stats.useQuery({
    property: filters.property as any,
    channel: filters.channel as any,
    status: statusFilter,
    timeRange: filters.timeRange as any,
  });

  if (!stats) return null;

  const rangeLabel =
    filters.timeRange === "month" ? t("dashboard.filter_time") :
    filters.timeRange === "next_month" ? t("dashboard.filter_time") :
    filters.timeRange === "3months" ? t("dashboard.filter_time") :
    filters.timeRange === "6months" ? t("dashboard.filter_time") :
    filters.timeRange === "all" ? t("dashboard.filter_all") : "2026";

  const statusLabel = 
    filters.status === "active" ? t("dashboard.filter_status") :
    filters.status === "all" ? t("dashboard.filter_all") :
    filters.status ? filters.status.charAt(0).toUpperCase() + filters.status.slice(1).replace("_", " ") : t("dashboard.filter_all");

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {[
        { label: `${t("dashboard.filter_all")} (${statusLabel})`, value: stats.total, icon: Calendar, color: "bg-blue-50 text-blue-600 dark:bg-blue-900/20" },
        { label: t("dashboard.pending_deposits"), value: stats.upcoming, icon: Clock, color: "bg-amber-50 text-amber-600 dark:bg-amber-900/20" },
        { label: t("dashboard.confirmed_bookings"), value: stats.paid, icon: CheckCircle2, color: "bg-green-50 text-green-600 dark:bg-green-900/20" },
        { label: `${t("dashboard.total_revenue")} (${rangeLabel})`, value: `${stats.totalRevenue.toLocaleString("pl-PL")} PLN`, icon: TrendingUp, color: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20" },
      ].map((stat, i) => (
        <Card key={i} className="overflow-hidden border-0 shadow-sm transition-all hover:shadow-md">
          <CardContent className="p-5 flex items-center gap-4">
            <div className={cn("p-3 rounded-xl", stat.color)}>
              <stat.icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
              <h3 className="text-2xl font-bold tracking-tight">{stat.value}</h3>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function BookingsDashboard() {
  const { t } = useLanguage();
  const [property, setProperty] = useState<string>("all");
  const [channel, setChannel] = useState<string>("all");
  const [status, setStatus] = useState<string>("active");
  const [timeRange, setTimeRange] = useState<string>("year");
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("checkIn");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [searchQuery, setSearchQuery] = useState("");

  const handleSort = useCallback((col: SortKey) => {
    setSortKey(prev => {
      if (prev === col) {
        setSortDir(d => d === "asc" ? "desc" : "asc");
        return col;
      }
      setSortDir("asc");
      return col;
    });
  }, []);

  const filters = useMemo(
    () => ({
      property: property !== "all" ? (property as "Sadoles" | "Hacjenda") : undefined,
      channel:
        channel !== "all"
          ? (channel as "slowhop" | "airbnb" | "booking" | "alohacamp" | "direct")
          : undefined,
      status:
        status !== "all" && status !== "active"
          ? (status as "pending" | "confirmed" | "portal_paid" | "paid" | "finished" | "cancelled")
          : undefined,
      timeRange: timeRange as any,
    }),
    [property, channel, status, timeRange]
  );

  const statsFilters = useMemo(() => ({
    property: property !== "all" ? property : undefined,
    channel: channel !== "all" ? channel : undefined,
    status,
    timeRange,
  }), [property, channel, status, timeRange]);

  const { data: rawBookingList = [], isLoading } = trpc.bookings.list.useQuery(filters);

  const utils = trpc.useUtils();
  const triggerIcal = trpc.sync.triggerIcal.useMutation({
    onSuccess: () => {
      utils.bookings.list.invalidate();
      utils.bookings.stats.invalidate();
      toast.success(`iCal Sync complete`);
    },
  });

  const triggerEmail = trpc.sync.triggerEmail.useMutation({
    onSuccess: (data) => {
      utils.bookings.list.invalidate();
      utils.bookings.stats.invalidate();
      if (data.errors && data.errors.length > 0) {
        toast.error(`Email Check had errors: ${data.errors[0]}`);
      } else {
        toast.success(`Email Check: ${data.enriched} enriched, ${data.matched} matched`);
      }
    },
    onError: (err) => {
      toast.error(`Email Check failed: ${err.message}`);
    },
  });

  const nightsCount = (b: { checkIn: Date | string; checkOut: Date | string }) =>
    Math.round((new Date(b.checkOut).getTime() - new Date(b.checkIn).getTime()) / (1000 * 60 * 60 * 24));

  const bookingList = useMemo(() => {
    let list = [...rawBookingList];
    if (status === "active") {
      list = list.filter(b => b.status !== "finished" && b.status !== "cancelled");
    }
    
    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(b => 
        getGuestName(b).toLowerCase().includes(q) || 
        b.property?.toLowerCase().includes(q) ||
        b.channel?.toLowerCase().includes(q)
      );
    }

    return list.sort((a, b) => {
      let aVal: string | number = 0;
      let bVal: string | number = 0;
      switch (sortKey) {
        case "property":      aVal = a.property ?? ""; bVal = b.property ?? ""; break;
        case "channel":       aVal = a.channel ?? ""; bVal = b.channel ?? ""; break;
        case "guestName":     aVal = getGuestName(a); bVal = getGuestName(b); break;
        case "checkIn":       aVal = new Date(a.checkIn).getTime(); bVal = new Date(b.checkIn).getTime(); break;
        case "checkOut":      aVal = new Date(a.checkOut).getTime(); bVal = new Date(b.checkOut).getTime(); break;
        case "nights":        aVal = nightsCount(a); bVal = nightsCount(b); break;
        case "status":        aVal = a.status ?? ""; bVal = b.status ?? ""; break;
        case "depositStatus": aVal = a.depositStatus ?? ""; bVal = b.depositStatus ?? ""; break;
        case "revenue":       aVal = parseFloat(a.hostRevenue ?? a.totalPrice ?? "0") || 0; bVal = parseFloat(b.hostRevenue ?? b.totalPrice ?? "0") || 0; break;
      }
      if (aVal === bVal) return 0;
      const res = aVal > bVal ? 1 : -1;
      return sortDir === "asc" ? res : -res;
    });
  }, [rawBookingList, sortKey, sortDir, status, searchQuery]);

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 max-w-7xl mx-auto">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{t("dashboard.title")}</h1>
            <p className="text-muted-foreground mt-1">
              {t("dashboard.subtitle")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              className="shadow-sm"
              onClick={() => triggerEmail.mutate()}
              disabled={triggerEmail.isPending}
            >
              <Mail className="h-4 w-4 mr-2" />
              {triggerEmail.isPending ? t("common.loading") : t("dashboard.check_email")}
            </Button>
            <Button
              className="shadow-sm"
              onClick={() => triggerIcal.mutate()}
              disabled={triggerIcal.isPending}
            >
              <RefreshCw
                className={cn("h-4 w-4 mr-2", triggerIcal.isPending && "animate-spin")}
              />
              {triggerIcal.isPending ? t("common.loading") : t("dashboard.check_ical")}
            </Button>
          </div>
        </header>

        <DoubleBookingBanner />

        <StatsCards filters={statsFilters} />

        <div className="space-y-4">
          <div className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-center">
            <div className="relative w-full lg:w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder={t("dashboard.new_booking") + "..."}
                className="w-full pl-10 h-10 border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 mr-2 text-sm font-medium text-muted-foreground">
                <Filter className="h-4 w-4" /> {t("dashboard.filter_all")}:
              </div>
              <Select value={timeRange} onValueChange={setTimeRange}>
                <SelectTrigger className="h-9 w-40 text-sm border-0 bg-secondary/50 hover:bg-secondary transition-colors">
                  <SelectValue placeholder={t("dashboard.filter_time")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">{t("dashboard.filter_time")}</SelectItem>
                  <SelectItem value="next_month">{t("dashboard.filter_time")}</SelectItem>
                  <SelectItem value="3months">{t("dashboard.filter_time")}</SelectItem>
                  <SelectItem value="6months">{t("dashboard.filter_time")}</SelectItem>
                  <SelectItem value="year">{t("dashboard.filter_time")} (2026)</SelectItem>
                  <SelectItem value="all">{t("dashboard.filter_all")}</SelectItem>
                </SelectContent>
              </Select>

              <Select value={property} onValueChange={setProperty}>
                <SelectTrigger className="h-9 w-40 text-sm border-0 bg-secondary/50 hover:bg-secondary transition-colors">
                  <SelectValue placeholder={t("dashboard.filter_property")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("dashboard.filter_all")}</SelectItem>
                  <SelectItem value="Sadoles">Sadoleś</SelectItem>
                  <SelectItem value="Hacjenda">Hacjenda</SelectItem>
                </SelectContent>
              </Select>

              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger className="h-9 w-40 text-sm border-0 bg-secondary/50 hover:bg-secondary transition-colors">
                  <SelectValue placeholder={t("dashboard.filter_channel")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("dashboard.filter_all")}</SelectItem>
                  <SelectItem value="slowhop">Slowhop</SelectItem>
                  <SelectItem value="airbnb">Airbnb</SelectItem>
                  <SelectItem value="booking">Booking.com</SelectItem>
                  <SelectItem value="alohacamp">Alohacamp</SelectItem>
                  <SelectItem value="direct">Direct</SelectItem>
                </SelectContent>
              </Select>

              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-9 w-40 text-sm border-0 bg-secondary/50 hover:bg-secondary transition-colors">
                  <SelectValue placeholder={t("dashboard.filter_status")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t("dashboard.filter_status")}</SelectItem>
                  <SelectItem value="all">{t("dashboard.filter_all")}</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="portal_paid">Portal Paid</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="finished">Finished</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Card className="border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="bg-muted/50 text-muted-foreground border-b uppercase text-[10px] font-bold tracking-wider">
                    <th className="px-6 py-4 cursor-pointer transition-colors hover:text-foreground" onClick={() => handleSort("property")}>
                      {t("cleaning.property")} <SortIcon col="property" sortKey={sortKey} sortDir={sortDir} />
                    </th>
                    <th className="px-6 py-4 cursor-pointer transition-colors hover:text-foreground" onClick={() => handleSort("guestName")}>
                      {t("cleaning.guest")} <SortIcon col="guestName" sortKey={sortKey} sortDir={sortDir} />
                    </th>
                    <th className="px-6 py-4 cursor-pointer transition-colors hover:text-foreground" onClick={() => handleSort("checkIn")}>
                      {t("cleaning.arrival")} <SortIcon col="checkIn" sortKey={sortKey} sortDir={sortDir} />
                    </th>
                    <th className="px-6 py-4 cursor-pointer transition-colors hover:text-foreground" onClick={() => handleSort("checkOut")}>
                      {t("cleaning.departure")} <SortIcon col="checkOut" sortKey={sortKey} sortDir={sortDir} />
                    </th>
                    <th className="px-6 py-4 cursor-pointer transition-colors hover:text-foreground" onClick={() => handleSort("status")}>
                      {t("dashboard.filter_status")} <SortIcon col="status" sortKey={sortKey} sortDir={sortDir} />
                    </th>
                    <th className="px-6 py-4 cursor-pointer transition-colors hover:text-foreground text-right" onClick={() => handleSort("revenue")}>
                      {t("dashboard.total_revenue")} <SortIcon col="revenue" sortKey={sortKey} sortDir={sortDir} />
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {isLoading ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-20 text-center">
                        <div className="flex flex-col items-center gap-3">
                          <RefreshCw className="h-8 w-8 text-primary/20 animate-spin" />
                          <span className="text-muted-foreground font-medium">{t("common.loading")}</span>
                        </div>
                      </td>
                    </tr>
                  ) : bookingList.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-20 text-center">
                        <div className="flex flex-col items-center gap-2">
                          <Filter className="h-8 w-8 text-muted-foreground/20" />
                          <span className="text-muted-foreground font-medium">{t("dashboard.no_bookings")}</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    bookingList.map((b) => (
                      <tr
                        key={b.id}
                        className="group hover:bg-muted/50 cursor-pointer transition-colors"
                        onClick={() => setSelectedBooking(b)}
                      >
                        <td className="px-6 py-4">
                          <div className="font-semibold text-foreground">{b.property}</div>
                          <div className="mt-1">
                            <ChannelBadge channel={b.channel} />
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-semibold text-foreground">{getGuestName(b)}</div>
                          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                            {b.guestCountry && (
                              <>
                                <span className="uppercase">{b.guestCountry}</span>
                                <span>•</span>
                              </>
                            )}
                            <span>{nightsCount(b)} {nightsCount(b) === 1 ? t("common.night") : t("common.nights")}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-muted-foreground whitespace-nowrap">
                          {format(new Date(b.checkIn), "dd MMM yyyy HH:mm")}
                        </td>
                        <td className="px-6 py-4 text-muted-foreground whitespace-nowrap">
                          {format(new Date(b.checkOut), "dd MMM yyyy HH:mm")}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-1.5 items-start">
                            <StatusBadge status={b.status} />
                            <DepositBadge status={b.depositStatus} />
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="font-bold text-base">
                            {(parseFloat(b.hostRevenue ?? b.totalPrice ?? "0")).toLocaleString("pl-PL")}
                          </span>
                          <span className="text-[10px] font-bold text-muted-foreground ml-1">PLN</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>

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
