import { useState, useMemo, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
} from "lucide-react";
import { format } from "date-fns";
import BookingDetailModal from "@/components/BookingDetailModal";
import { Booking, StatusBadge, DepositBadge, ChannelBadge } from "@/components/ui/Badges";
import { Booking as BookingType } from "@shared/types";

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

function StatsCards({ filters }: { filters: { property?: string; channel?: string; timeRange?: string } }) {
  const { data: stats } = trpc.bookings.stats.useQuery({
    property: filters.property as any,
    channel: filters.channel as any,
    timeRange: filters.timeRange as any,
  });

  if (!stats) return null;

  const rangeLabel = 
    filters.timeRange === "month" ? "Month" :
    filters.timeRange === "3months" ? "3 Months" :
    filters.timeRange === "6months" ? "6 Months" :
    filters.timeRange === "all" ? "All Time" : "2026";

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-blue-100 flex items-center justify-center">
              <Calendar className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-xs text-muted-foreground">Total ({rangeLabel})</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-amber-100 flex items-center justify-center">
              <Clock className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.upcoming}</p>
              <p className="text-xs text-muted-foreground">Upcoming</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-green-100 flex items-center justify-center">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.paid}</p>
              <p className="text-xs text-muted-foreground">Fully Paid</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-teal-100 flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-teal-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {stats.totalRevenue.toLocaleString("pl-PL")}
              </p>
              <p className="text-xs text-muted-foreground">Revenue ({rangeLabel})</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function BookingsDashboard() {
  const [property, setProperty] = useState<string>("all");
  const [channel, setChannel] = useState<string>("all");
  const [status, setStatus] = useState<string>("active");
  const [timeRange, setTimeRange] = useState<string>("year");
  const [selectedBooking, setSelectedBooking] = useState<BookingType | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("checkIn");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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
          ? (status as "pending" | "confirmed" | "paid_to_intermediary" | "paid" | "finished")
          : undefined,
    }),
    [property, channel, status]
  );

  const statsFilters = useMemo(() => ({
    property: property !== "all" ? property : undefined,
    channel: channel !== "all" ? channel : undefined,
    timeRange,
  }), [property, channel, timeRange]);

  const { data: rawBookingList = [], isLoading } = trpc.bookings.list.useQuery(filters);

  const utils = trpc.useUtils();
  const triggerIcal = trpc.sync.ical.useMutation({
    onSuccess: (data) => {
      utils.bookings.list.invalidate();
      utils.bookings.stats.invalidate();
      toast.success(`iCal Sync complete: ${data.newCount} new, ${data.updatedCount} updated`);
    },
  });

  const triggerEmail = trpc.sync.email.useMutation({
    onSuccess: (data) => {
      utils.bookings.list.invalidate();
      utils.bookings.stats.invalidate();
      toast.success(`Email Check: ${data.enriched} enriched, ${data.matched} matched`);
    },
  });

  const nightsCount = (b: { checkIn: Date | string; checkOut: Date | string }) =>
    Math.round((new Date(b.checkOut).getTime() - new Date(b.checkIn).getTime()) / (1000 * 60 * 60 * 24));

  const bookingList = useMemo(() => {
    let list = [...rawBookingList];
    if (status === "active") {
      list = list.filter(b => b.status !== "finished");
    }
    return list.sort((a, b) => {
      let aVal: string | number = 0;
      let bVal: string | number = 0;
      switch (sortKey) {
        case "property":      aVal = a.property ?? ""; bVal = b.property ?? ""; break;
        case "channel":       aVal = a.channel ?? ""; bVal = b.channel ?? ""; break;
        case "guestName":     aVal = a.guestName ?? ""; bVal = b.guestName ?? ""; break;
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
  }, [rawBookingList, sortKey, sortDir, status]);

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Bookings</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Sadoleś &amp; Hacjenda — all channels
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => triggerEmail.mutate()}
              disabled={triggerEmail.isPending}
            >
              <Mail className="h-4 w-4 mr-1.5" />
              {triggerEmail.isPending ? "Checking..." : "Check Email"}
            </Button>
            <Button
              size="sm"
              onClick={() => triggerIcal.mutate()}
              disabled={triggerIcal.isPending}
            >
              <RefreshCw
                className={`h-4 w-4 mr-1.5 ${triggerIcal.isPending ? "animate-spin" : ""}`}
              />
              {triggerIcal.isPending ? "Syncing..." : "Sync iCal"}
            </Button>
          </div>
        </div>

        {/* Stats */}
        <StatsCards filters={statsFilters} />

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-4">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-44 h-8 text-sm bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800">
              <SelectValue placeholder="Time Range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="3months">Next 3 Months</SelectItem>
              <SelectItem value="6months">Next 6 Months</SelectItem>
              <SelectItem value="year">This Year (2026)</SelectItem>
              <SelectItem value="all">All Time</SelectItem>
            </SelectContent>
          </Select>

          <Select value={property} onValueChange={setProperty}>
            <SelectTrigger className="w-40 h-8 text-sm">
              <SelectValue placeholder="Property" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Properties</SelectItem>
              <SelectItem value="Sadoles">Sadoleś</SelectItem>
              <SelectItem value="Hacjenda">Hacjenda</SelectItem>
            </SelectContent>
          </Select>

          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger className="w-40 h-8 text-sm">
              <SelectValue placeholder="Channel" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Channels</SelectItem>
              <SelectItem value="slowhop">Slowhop</SelectItem>
              <SelectItem value="airbnb">Airbnb</SelectItem>
              <SelectItem value="booking">Booking.com</SelectItem>
              <SelectItem value="alohacamp">Alohacamp</SelectItem>
              <SelectItem value="direct">Direct</SelectItem>
            </SelectContent>
          </Select>

          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40 h-8 text-sm">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
              <SelectItem value="paid_to_intermediary">Paid to Intermediary</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="finished">Finished</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="bg-card border rounded-lg overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left border-collapse">
              <thead className="bg-muted/50 text-muted-foreground font-medium border-b">
                <tr>
                  <th className="px-4 py-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("property")}>
                    Property <SortIcon col="property" sortKey={sortKey} sortDir={sortDir} />
                  </th>
                  <th className="px-4 py-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("guestName")}>
                    Guest <SortIcon col="guestName" sortKey={sortKey} sortDir={sortDir} />
                  </th>
                  <th className="px-4 py-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("checkIn")}>
                    Check-in <SortIcon col="checkIn" sortKey={sortKey} sortDir={sortDir} />
                  </th>
                  <th className="px-4 py-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("checkOut")}>
                    Check-out <SortIcon col="checkOut" sortKey={sortKey} sortDir={sortDir} />
                  </th>
                  <th className="px-4 py-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("status")}>
                    Status <SortIcon col="status" sortKey={sortKey} sortDir={sortDir} />
                  </th>
                  <th className="px-4 py-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("revenue")}>
                    Revenue <SortIcon col="revenue" sortKey={sortKey} sortDir={sortDir} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                      Loading bookings...
                    </td>
                  </tr>
                ) : bookingList.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                      No bookings found for the current filters.
                    </td>
                  </tr>
                ) : (
                  bookingList.map((b) => (
                    <tr
                      key={b.id}
                      className="border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => setSelectedBooking(b)}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{b.property}</div>
                        <div className="mt-1">
                          <ChannelBadge channel={b.channel} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{b.guestName || "Unknown"}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {nightsCount(b)} night{nightsCount(b) !== 1 ? "s" : ""}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {format(new Date(b.checkIn), "dd MMM yyyy")}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {format(new Date(b.checkOut), "dd MMM yyyy")}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1.5 items-start">
                          <StatusBadge status={b.status} />
                          <DepositBadge status={b.depositStatus} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {(parseFloat(b.hostRevenue ?? b.totalPrice ?? "0")).toLocaleString("pl-PL")} PLN
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
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
