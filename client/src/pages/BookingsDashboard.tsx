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
import { toast } from "sonner";
import {
  Calendar,
  RefreshCw,
  Home,
  TrendingUp,
  Clock,
  CheckCircle2,
  Mail,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from "lucide-react";
import { format } from "date-fns";
import BookingDetailModal, { Booking, StatusBadge, DepositBadge, ChannelBadge } from "@/components/BookingDetailModal";

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
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
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
          ? (status as "pending" | "confirmed" | "paid" | "finished")
          : undefined,
    }),
    [property, channel, status]
  );

  const statsFilters = useMemo(() => ({
    property: property !== "all" ? property : undefined,
    channel: channel !== "all" ? channel : undefined,
    timeRange,
  }), [property, channel, timeRange]);

  const { data: rawBookingList = [], isLoading, refetch } = trpc.bookings.list.useQuery(filters);

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
        case "nights":        aVal = nightsCount(a as { checkIn: Date; checkOut: Date }); bVal = nightsCount(b as { checkIn: Date; checkOut: Date }); break;
        case "status":        aVal = a.status ?? ""; bVal = b.status ?? ""; break;
        case "depositStatus": aVal = a.depositStatus ?? ""; bVal = b.depositStatus ?? ""; break;
        case "revenue":       aVal = parseFloat(a.hostRevenue ?? a.totalPrice ?? "0") || 0; bVal = parseFloat(b.hostRevenue ?? b.totalPrice ?? "0") || 0; break;
      }
      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [rawBookingList, sortKey, sortDir]);
  const utils = trpc.useUtils();

  const triggerIcal = trpc.sync.triggerIcal.useMutation({
    onSuccess: () => {
      utils.bookings.list.invalidate();
      utils.bookings.stats.invalidate();
      toast.success("iCal sync complete");
    },
    onError: (e) => toast.error(`Sync failed: ${e.message}`),
  });

  const triggerEmail = trpc.sync.triggerEmail.useMutation({
    onSuccess: (data) => {
      utils.bookings.list.invalidate();
      utils.bookings.stats.invalidate();
      toast.success(
        `Email check complete — ${data.enriched} enriched, ${data.matched} matched`
      );
    },
    onError: (e) => toast.error(`Email check failed: ${e.message}`),
  });

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
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
            <SelectTrigger className="w-36 h-8 text-sm bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800">
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
            <SelectTrigger className="w-36 h-8 text-sm">
              <SelectValue placeholder="Property" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Properties</SelectItem>
              <SelectItem value="Sadoles">Sadoleś</SelectItem>
              <SelectItem value="Hacjenda">Hacjenda</SelectItem>
            </SelectContent>
          </Select>

          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger className="w-36 h-8 text-sm">
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
            <SelectTrigger className="w-36 h-8 text-sm">
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

          <span className="ml-auto text-sm text-muted-foreground self-center">
            {bookingList.length} booking{bookingList.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Table */}
        <Card className="border-0 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  {([
                    ["property", "Property"],
                    ["channel", "Channel"],
                    ["guestName", "Guest"],
                    ["checkIn", "Check-in"],
                    ["checkOut", "Check-out"],
                    ["nights", "Nights"],
                    ["status", "Status"],
                    ["depositStatus", "Deposit"],
                    ["revenue", "Revenue"],
                  ] as [SortKey, string][]).map(([col, label]) => (
                    <th key={col} className="text-left px-4 py-3 font-medium text-muted-foreground">
                      <button
                        onClick={() => handleSort(col)}
                        className="flex items-center gap-0.5 hover:text-foreground transition-colors select-none whitespace-nowrap"
                      >
                        {label}
                        <SortIcon col={col} sortKey={sortKey} sortDir={sortDir} />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={9} className="text-center py-12 text-muted-foreground">
                      Loading bookings...
                    </td>
                  </tr>
                )}
                {!isLoading && bookingList.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center py-12 text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        <Calendar className="h-8 w-8 opacity-30" />
                        <p>No bookings found</p>
                        <p className="text-xs">Click "Sync iCal" to import bookings from your calendars</p>
                      </div>
                    </td>
                  </tr>
                )}
                {bookingList.map((b) => (
                  <tr
                    key={b.id}
                    className="border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => setSelectedBooking(b as Booking)}
                  >
                    <td className="px-4 py-3 font-medium">
                      {b.property === "Sadoles" ? "Sadoleś" : b.property}
                    </td>
                    <td className="px-4 py-3">
                      <ChannelBadge channel={b.channel} />
                    </td>
                    <td className="px-4 py-3">
                      {b.guestName ?? (
                        <span className="text-muted-foreground italic text-xs">No name yet</span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {format(new Date(b.checkIn), "dd MMM yyyy")}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {format(new Date(b.checkOut), "dd MMM yyyy")}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-center">
                      {nightsCount(b as { checkIn: Date; checkOut: Date })}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={b.status} />
                    </td>
                    <td className="px-4 py-3">
                      <DepositBadge status={b.depositStatus} />
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {b.hostRevenue
                        ? `${parseFloat(b.hostRevenue).toLocaleString("pl-PL")} PLN`
                        : b.totalPrice
                        ? `${parseFloat(b.totalPrice).toLocaleString("pl-PL")} PLN`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
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
