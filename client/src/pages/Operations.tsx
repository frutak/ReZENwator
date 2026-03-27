import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { RefreshCw, Mail, CheckCircle2, XCircle, FileText, Download } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

export default function Operations() {
  const { data: lastRun } = trpc.sync.lastRun.useQuery();
  const { data: logs = [] } = trpc.sync.logs.useQuery({ limit: 30 });
  const { data: feeds = [] } = trpc.sync.feeds.useQuery();
  const utils = trpc.useUtils();

  const [reportMonth, setReportMonth] = useState<string>(String(new Date().getMonth() + 1));
  const [reportYear, setReportYear] = useState<string>(String(new Date().getFullYear()));
  const [isGenerating, setIsGenerating] = useState(false);

  const triggerIcal = trpc.sync.triggerIcal.useMutation({
    onSuccess: () => {
      utils.sync.logs.invalidate();
      utils.sync.lastRun.invalidate();
      utils.bookings.stats.invalidate();
      toast.success("iCal sync triggered successfully");
    },
    onError: (e) => toast.error(`Sync failed: ${e.message}`),
  });

  const triggerEmail = trpc.sync.triggerEmail.useMutation({
    onSuccess: (data) => {
      utils.sync.logs.invalidate();
      utils.sync.lastRun.invalidate();
      toast.success(
        `Email check complete — ${data.processed} processed, ${data.enriched} enriched, ${data.matched} matched`
      );
    },
    onError: (e) => toast.error(`Email check failed: ${e.message}`),
  });

  const handleDownloadTaxReport = async () => {
    setIsGenerating(true);
    try {
      // Use the client directly to ensure we get the latest state values
      const data = await utils.client.bookings.taxReport.query({
        month: parseInt(reportMonth),
        year: parseInt(reportYear)
      });

      if (!data || data.length === 0) {
        toast.error("No bookings found for the selected month");
        return;
      }

      // Generate CSV
      const headers = ["Guest Name", "Channel", "Property", "Arrival Date", "Total Price", "Host Revenue", "Taxable Value"];
      const rows = data.map(b => [
        b.guestName,
        b.channel,
        b.property,
        format(new Date(b.checkIn), "yyyy-MM-dd"),
        b.totalPrice.toFixed(2),
        b.hostRevenue.toFixed(2),
        b.taxableValue.toFixed(2)
      ]);

      const totalTaxable = data.reduce((sum, b) => sum + b.taxableValue, 0);
      rows.push([]);
      rows.push(["", "", "", "", "", "TOTAL TAXABLE:", totalTaxable.toFixed(2)]);

      const csvContent = [headers, ...rows]
        .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
        .join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `Tax_Report_${reportYear}_${reportMonth.padStart(2, "0")}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      toast.success("Tax report generated successfully");
    } catch (err) {
      toast.error("Failed to generate report");
    } finally {
      setIsGenerating(false);
    }
  };

  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Operations</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            System maintenance, data synchronization and reports
          </p>
        </div>

        {/* Reports Section */}
        <Card className="border-0 shadow-sm mb-6">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Reports</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row items-end gap-4">
              <div className="grid gap-1.5 flex-1">
                <label className="text-[10px] font-bold uppercase text-muted-foreground ml-1">Report Month</label>
                <Select value={reportMonth} onValueChange={setReportMonth}>
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {months.map((m, i) => (
                      <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5 w-full sm:w-32">
                <label className="text-[10px] font-bold uppercase text-muted-foreground ml-1">Year</label>
                <Select value={reportYear} onValueChange={setReportYear}>
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2025">2025</SelectItem>
                    <SelectItem value="2026">2026</SelectItem>
                    <SelectItem value="2027">2027</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button 
                className="h-10 px-6 shadow-sm" 
                onClick={handleDownloadTaxReport}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Generate Tax Report (CSV)
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-3 italic">
              Note: Taxable value uses Total Price for all channels except Airbnb, where it uses Host Revenue (Payout).
            </p>
          </CardContent>
        </Card>

        {/* Last run summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-primary" />
                  <span className="font-medium">iCal Polling</span>
                </div>
                <Button
                  size="sm"
                  onClick={() => triggerIcal.mutate()}
                  disabled={triggerIcal.isPending}
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 mr-1.5 ${triggerIcal.isPending ? "animate-spin" : ""}`}
                  />
                  {triggerIcal.isPending ? "Running..." : "Run Now"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {lastRun?.ical
                  ? `Last run: ${formatDistanceToNow(new Date(lastRun.ical), { addSuffix: true })}`
                  : "Never run"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Schedule: every 30 minutes
              </p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-primary" />
                  <span className="font-medium">Email Polling</span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => triggerEmail.mutate()}
                  disabled={triggerEmail.isPending}
                >
                  <Mail className="h-3.5 w-3.5 mr-1.5" />
                  {triggerEmail.isPending ? "Checking..." : "Check Now"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {lastRun?.email
                  ? `Last run: ${formatDistanceToNow(new Date(lastRun.email), { addSuffix: true })}`
                  : "Never run"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Inbox: furtka.rentals@gmail.com
              </p>
            </CardContent>
          </Card>
        </div>

        {/* iCal feeds */}
        <Card className="border-0 shadow-sm mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Configured iCal Feeds</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Feed</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Property</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Channel</th>
                </tr>
              </thead>
              <tbody>
                {feeds.map((feed) => (
                  <tr key={feed.label} className="border-b last:border-0">
                    <td className="px-4 py-2.5 font-medium">{feed.label}</td>
                    <td className="px-4 py-2.5">
                      {feed.property === "Sadoles" ? "Sadoleś" : feed.property}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium channel-${feed.channel}`}
                      >
                        {feed.channel}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Recent sync logs */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent Sync Logs</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Time</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Type</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Source</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">New</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Updated</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Result</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Duration</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-muted-foreground">
                      No sync logs yet — run a sync to see results here
                    </td>
                  </tr>
                )}
                {logs.map((log) => (
                  <tr key={log.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5 tabular-nums text-xs text-muted-foreground">
                      {format(new Date(log.createdAt), "dd MMM HH:mm")}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          log.syncType === "ical"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-purple-100 text-purple-700"
                        }`}
                      >
                        {log.syncType === "ical" ? "iCal" : "Email"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs max-w-[200px] truncate">
                      {log.source}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-center">
                      {log.newBookings > 0 ? (
                        <span className="text-green-700 font-medium">+{log.newBookings}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-center">
                      {log.updatedBookings > 0 ? (
                        <span className="text-blue-700 font-medium">{log.updatedBookings}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {log.success === "true" ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <div className="flex items-center gap-1">
                          <XCircle className="h-4 w-4 text-red-500" />
                          {log.errorMessage && (
                            <span
                              className="text-xs text-red-600 truncate max-w-[120px]"
                              title={log.errorMessage}
                            >
                              {log.errorMessage.substring(0, 30)}...
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-xs text-muted-foreground">
                      {log.durationMs != null ? `${log.durationMs}ms` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
