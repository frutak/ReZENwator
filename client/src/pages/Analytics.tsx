import { useState, useMemo, useRef } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useLanguage } from "@/contexts/LanguageContext";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend,
  Cell
} from "recharts";
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle,
  CardDescription 
} from "@/components/ui/card";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { PROPERTIES, CHANNELS } from "@shared/config";
import { format, parse } from "date-fns";
import { pl, enUS } from "date-fns/locale";
import { TrendingUp, Filter, Wallet, BarChart3, PiggyBank, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type MetricType = "hostRevenue" | "totalPrice" | "profit" | "summary";

export default function Analytics() {
  const { t, language } = useLanguage();
  const [year, setYear] = useState(new Date().getFullYear());
  const [property, setProperty] = useState<string>("all");
  const [channel, setChannel] = useState<string>("all");
  const [metric, setMetric] = useState<MetricType>("summary");
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const utils = trpc.useUtils();

  const { data, isLoading, error } = trpc.bookings.analytics.useQuery({
    year,
    property: property === "all" ? undefined : property as any,
    channel: channel === "all" ? undefined : channel as any,
  }, {
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const updateAdjustment = trpc.bookings.updateMonthlyAdjustment.useMutation({
    onSuccess: () => {
      utils.bookings.analytics.invalidate();
      toast.success(t("common.saved"));
    },
    onError: (err) => {
      toast.error(err.message);
    }
  });

  const handleUpdateAdjustment = (month: string, value: string) => {
    if (property === "all") return;
    updateAdjustment.mutate({
      property: property as any,
      month,
      amount: value || "0",
      category: "extra_cleaning"
    });
  };

  const monthlyData = data?.monthlyData ?? [];
  const weekendStats = data?.weekendStats ?? { pastYear: 0, next3Months: 0, next6Months: 0 };

  const chartData = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, i) => {
      const monthNum = i + 1;
      return `${year}-${String(monthNum).padStart(2, '0')}`;
    });

    const monthlyItems = months.map(m => {
      const found = monthlyData.find(d => d && d.month === m);
      let dateObj = new Date();
      try {
        dateObj = parse(m, "yyyy-MM", new Date());
      } catch (e) {}
      
      const safeNum = (val: any) => {
        const n = parseFloat(String(val));
        return isFinite(n) ? n : 0;
      };

      return {
        month: m,
        label: format(dateObj, "MMM", { locale: language === "PL" ? pl : enUS }),
        totalPrice: found ? Math.round(safeNum(found.totalPrice)) : 0,
        hostRevenue: found ? Math.round(safeNum(found.hostRevenue)) : 0,
        commission: found ? Math.round(safeNum(found.commission)) : 0,
        cleaningCosts: found ? Math.round(safeNum(found.cleaningCosts)) : 0,
        utilityCosts: found ? Math.round(safeNum(found.utilityCosts)) : 0,
        purchaseCosts: found ? Math.round(safeNum(found.purchaseCosts)) : 0,
        profit: found ? Math.round(safeNum(found.profit)) : 0,
        count: found ? (found.count || 0) : 0,
        totalNights: found ? (found.totalNights || 0) : 0,
        extraCleaning: found ? safeNum(found.extraCleaning) : 0,
      };
    });

    const totalItem = {
      month: 'total',
      label: t("dashboard.total"),
      totalPrice: monthlyItems.reduce((s, i) => s + i.totalPrice, 0),
      hostRevenue: monthlyItems.reduce((s, i) => s + i.hostRevenue, 0),
      commission: monthlyItems.reduce((s, i) => s + i.commission, 0),
      cleaningCosts: monthlyItems.reduce((s, i) => s + i.cleaningCosts, 0),
      utilityCosts: monthlyItems.reduce((s, i) => s + i.utilityCosts, 0),
      purchaseCosts: monthlyItems.reduce((s, i) => s + i.purchaseCosts, 0),
      profit: monthlyItems.reduce((s, i) => s + i.profit, 0),
      count: monthlyItems.reduce((s, i) => s + i.count, 0),
      totalNights: monthlyItems.reduce((s, i) => s + i.totalNights, 0),
      extraCleaning: monthlyItems.reduce((s, i) => s + i.extraCleaning, 0),
    };

    return [...monthlyItems, totalItem];
  }, [monthlyData, year, language, t]);

  const stats = useMemo(() => {
    const sum = (key: string) => monthlyData.reduce((acc, d) => {
      const val = parseFloat(String(d?.[key]));
      return acc + (isFinite(val) ? val : 0);
    }, 0);
    const totalRevenue = sum("totalPrice");
    const totalBookings = sum("count");
    const totalNights = sum("totalNights");
    const totalProfit = sum("profit");

    return {
      totalRevenue,
      totalBookings,
      totalNights,
      totalProfit,
      avgBooking: totalBookings > 0 ? Math.round(totalRevenue / totalBookings) : 0,
      avgNightly: totalNights > 0 ? Math.round(totalRevenue / totalNights) : 0,
    };
  }, [monthlyData]);

  if (error) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <h2 className="text-xl font-bold">Error loading analytics</h2>
          <p className="text-muted-foreground max-w-md">{error.message}</p>
          <button onClick={() => utils.bookings.analytics.invalidate()} className="bg-primary text-white px-6 py-2 rounded-lg">Retry</button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header & Filters */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("dashboard.analytics")}</h1>
            <p className="text-muted-foreground">{t("dashboard.subtitle")}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-muted/50 p-1 rounded-lg border border-transparent hover:border-muted-foreground/20 transition-all">
              <Filter className="h-4 w-4 ml-2 text-muted-foreground" />
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="w-[100px] border-none bg-transparent h-8 shadow-none focus:ring-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[2024, 2025, 2026, 2027].map(y => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={property} onValueChange={setProperty}>
                <SelectTrigger className="w-[140px] border-none bg-transparent h-8 shadow-none focus:ring-0">
                  <SelectValue placeholder={t("dashboard.filter_property")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("dashboard.filter_all_properties")}</SelectItem>
                  {PROPERTIES.map(p => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger className="w-[140px] border-none bg-transparent h-8 shadow-none focus:ring-0">
                  <SelectValue placeholder={t("dashboard.filter_channel")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("dashboard.filter_all_channels")}</SelectItem>
                  {CHANNELS.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2 bg-primary/10 p-1 rounded-lg border border-primary/20 shadow-sm">
              <BarChart3 className="h-4 w-4 ml-2 text-primary" />
              <Select value={metric} onValueChange={(v) => setMetric(v as MetricType)}>
                <SelectTrigger className="w-[160px] border-none bg-transparent h-8 shadow-none focus:ring-0 font-medium text-primary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="summary">{t("dashboard.summary")}</SelectItem>
                  <SelectItem value="profit">{t("dashboard.profit")}</SelectItem>
                  <SelectItem value="hostRevenue">{t("dashboard.host_revenue")}</SelectItem>
                  <SelectItem value="totalPrice">{t("dashboard.total_price")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Stats Summary - Row 1 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className={(metric === 'profit' || metric === 'summary') ? 'ring-2 ring-primary shadow-lg scale-[1.02] transition-all' : 'hover:bg-muted/30 transition-all'}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center justify-between">
                {t("dashboard.profit")}
                <PiggyBank className="h-4 w-4 text-primary" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{Math.round(stats.totalProfit).toLocaleString()} PLN</div>
              <p className="text-[10px] text-muted-foreground">{t("dashboard.profit_desc")}</p>
            </CardContent>
          </Card>
          <Card className={metric === 'totalPrice' ? 'ring-2 ring-primary shadow-lg scale-[1.02] transition-all' : 'hover:bg-muted/30 transition-all'}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center justify-between">
                {t("dashboard.total_price")}
                <Wallet className="h-4 w-4 text-muted-foreground" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{Math.round(stats.totalRevenue).toLocaleString()} PLN</div>
              <p className="text-[10px] text-muted-foreground">{t("dashboard.total_revenue")}</p>
            </CardContent>
          </Card>
          <Card className="hover:bg-muted/30 transition-all">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center justify-between">
                {t("dashboard.bookings_count")}
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{stats.totalBookings}</div>
              <p className="text-[10px] text-muted-foreground">{t("dashboard.total")} {t("dashboard.bookings").toLowerCase()}</p>
            </CardContent>
          </Card>
          <Card className="hover:bg-muted/30 transition-all">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center justify-between">
                {t("dashboard.avg_booking_price")}
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{stats.avgBooking.toLocaleString()} PLN</div>
              <p className="text-[10px] text-muted-foreground">{t("dashboard.total")} / {t("dashboard.bookings_count").toLowerCase()}</p>
            </CardContent>
          </Card>
        </div>

        {/* Stats Summary - Row 2 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="hover:bg-muted/30 transition-all"><CardHeader className="pb-2"><CardTitle className="text-xs font-medium">{t("dashboard.avg_nightly_price")}</CardTitle></CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{stats.avgNightly.toLocaleString()} PLN</div>
              <p className="text-[10px] text-muted-foreground">{t("dashboard.total")} / {stats.totalNights} {t("common.nights")}</p>
            </CardContent>
          </Card>
          <Card className="hover:bg-muted/30 transition-all"><CardHeader className="pb-2"><CardTitle className="text-xs font-medium">{t("dashboard.booked_weekends_past")}</CardTitle></CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{Math.round(weekendStats.pastYear || 0)}%</div>
              <p className="text-[10px] text-muted-foreground">{year} {t("dashboard.analytics").toLowerCase()}</p>
            </CardContent>
          </Card>
          <Card className="hover:bg-muted/30 transition-all"><CardHeader className="pb-2"><CardTitle className="text-xs font-medium">{t("dashboard.booked_weekends_3m")}</CardTitle></CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{Math.round(weekendStats.next3Months || 0)}%</div>
              <p className="text-[10px] text-muted-foreground">{t("dashboard.filter_3months")}</p>
            </CardContent>
          </Card>
          <Card className="hover:bg-muted/30 transition-all"><CardHeader className="pb-2"><CardTitle className="text-xs font-medium">{t("dashboard.booked_weekends_6m")}</CardTitle></CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{Math.round(weekendStats.next6Months || 0)}%</div>
              <p className="text-[10px] text-muted-foreground">{t("dashboard.filter_6months")}</p>
            </CardContent>
          </Card>
        </div>

        {/* Chart Section */}
        <Card className="p-4 overflow-hidden border-none shadow-none bg-transparent">
          <div ref={chartContainerRef} className="h-[450px] w-full bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden p-4">
            {isLoading ? (
              <div className="flex h-full items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart 
                  key={`chart-${year}-${metric}-${property}`}
                  data={metric === 'summary' ? chartData : chartData.filter(d => d.month !== 'total')} 
                  margin={{ top: 10, right: 10, left: 10, bottom: 10 }}
                  stackOffset="sign"
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} fontSize={12} tick={{ fill: '#94a3b8' }} dy={10} />
                  <YAxis 
                    width={80}
                    axisLine={false} 
                    tickLine={false} 
                    fontSize={12} 
                    tick={{ fill: '#94a3b8' }} 
                    tickFormatter={(val) => `${val.toLocaleString()}`} 
                  />
                  <Tooltip 
                    cursor={{ fill: '#f8fafc', radius: 8 }} 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', padding: '12px' }} 
                  />
                  <Legend verticalAlign="top" align="center" height={50} iconType="circle" wrapperStyle={{ paddingTop: '0px', paddingBottom: '20px' }} />
                  
                  {metric === "hostRevenue" && (
                    <Bar dataKey="hostRevenue" fill="#3b82f6" name={t("dashboard.host_revenue")} radius={[6, 6, 0, 0]} />
                  )}
                  {metric === "totalPrice" && (
                    <Bar dataKey="totalPrice" fill="#6366f1" name={t("dashboard.total_price")} radius={[6, 6, 0, 0]} />
                  )}
                  {metric === "profit" && (
                    <Bar dataKey="profit" fill="#10b981" name={t("dashboard.profit")} radius={[6, 6, 0, 0]} />
                  )}
                  {metric === "summary" && (
                    <Bar dataKey="profit" stackId="a" fill="#10b981" name={t("dashboard.profit")} />
                  )}
                  {metric === "summary" && (
                    <Bar dataKey="commission" stackId="a" fill="#ef4444" name={t("dashboard.commission")} />
                  )}
                  {metric === "summary" && (
                    <Bar dataKey="cleaningCosts" stackId="a" fill="#3b82f6" name={t("dashboard.cleaning_costs")} />
                  )}
                  {metric === "summary" && (
                    <Bar dataKey="utilityCosts" stackId="a" fill="#eab308" name={t("dashboard.utility_costs")} />
                  )}
                  {metric === "summary" && (
                    <Bar dataKey="purchaseCosts" stackId="a" fill="#94a3b8" name={t("dashboard.purchase_costs")} radius={[6, 6, 0, 0]} />
                  )}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* Data Table */}
        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="border-b bg-slate-50/50 dark:bg-slate-900/50 py-4">
            <CardTitle className="text-lg font-bold">{t("nav.table")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground uppercase text-[10px] tracking-wider font-bold bg-slate-50/30">
                    <th className="px-6 py-4">{t("dashboard.month")}</th>
                    <th className="px-4 py-4 text-right">{t("dashboard.total_price")}</th>
                    <th className="px-4 py-4 text-right">{t("dashboard.extra_cleaning")}</th>
                    <th className="px-4 py-3 text-right">{t("dashboard.cleaning_costs")}</th>
                    <th className="px-4 py-3 text-right">{t("dashboard.utility_costs")}</th>
                    <th className="px-4 py-3 text-right">{t("dashboard.purchase_costs")}</th>
                    <th className="px-4 py-3 text-right text-foreground font-bold">{t("dashboard.profit")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {chartData.filter(d => d.month !== 'total').map((row) => (
                    <tr key={row.month} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-6 py-4 font-semibold text-slate-700 dark:text-slate-300">
                        {format(parse(row.month, "yyyy-MM", new Date()), "MMMM yyyy", { locale: language === "PL" ? pl : enUS })}
                      </td>
                      <td className="px-4 py-4 text-right font-mono text-xs text-slate-600">{row.totalPrice.toLocaleString()} PLN</td>
                      <td className="px-4 py-4 text-right">
                        {property !== "all" ? (
                          <Input type="number" className="h-8 w-24 ml-auto text-right font-mono text-xs bg-white focus:bg-white transition-all ring-offset-background" defaultValue={row.extraCleaning} 
                            onBlur={(e) => {
                              const v = parseFloat(e.target.value);
                              if (v !== row.extraCleaning) handleUpdateAdjustment(row.month, String(v));
                            }} 
                          />
                        ) : <span className="font-mono text-xs text-slate-500">{row.extraCleaning.toLocaleString()} PLN</span>}
                      </td>
                      <td className="px-4 py-4 text-right font-mono text-xs text-slate-600">{row.cleaningCosts.toLocaleString()} PLN</td>
                      <td className="px-4 py-4 text-right font-mono text-xs text-slate-600">{row.utilityCosts.toLocaleString()} PLN</td>
                      <td className="px-4 py-4 text-right font-mono text-xs text-slate-600">{row.purchaseCosts.toLocaleString()} PLN</td>
                      <td className={`px-4 py-4 text-right font-bold font-mono text-xs ${(metric === 'profit' || metric === 'summary') ? 'text-primary' : 'text-slate-900 dark:text-white'}`}>{row.profit.toLocaleString()} PLN</td>
                    </tr>
                  ))}
                  {metric === 'summary' && (
                    <tr className="bg-slate-50/50 dark:bg-slate-900/50 font-bold border-t-2">
                      <td className="px-6 py-5">{t("dashboard.total")}</td>
                      <td className="px-4 py-5 text-right font-mono">{Math.round(stats.totalRevenue).toLocaleString()} PLN</td>
                      <td className="px-4 py-5 text-right font-mono">{Math.round(monthlyData.reduce((acc, d) => acc + Number(d.extraCleaning || 0), 0)).toLocaleString()} PLN</td>
                      <td className="px-4 py-5 text-right font-mono">{Math.round(monthlyData.reduce((acc, d) => acc + Number(d.cleaningCosts || 0), 0)).toLocaleString()} PLN</td>
                      <td className="px-4 py-5 text-right font-mono">{Math.round(monthlyData.reduce((acc, d) => acc + Number(d.utilityCosts || 0), 0)).toLocaleString()} PLN</td>
                      <td className="px-4 py-5 text-right font-mono">{Math.round(monthlyData.reduce((acc, d) => acc + Number(d.purchaseCosts || 0), 0)).toLocaleString()} PLN</td>
                      <td className="px-4 py-5 text-right text-primary font-mono">{Math.round(stats.totalProfit).toLocaleString()} PLN</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
