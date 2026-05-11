import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLanguage } from "@/contexts/LanguageContext";
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle,
  CardDescription 
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter,
  DialogTrigger
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { 
  Plus, 
  Trash2, 
  Zap, 
  Flame, 
  Droplets, 
  ShoppingCart, 
  MoreHorizontal,
  Calendar as CalendarIcon,
  RefreshCw
} from "lucide-react";
import { format } from "date-fns";
import { PROPERTIES } from "@shared/config";

export function ExpensesManager() {
  const { t } = useLanguage();
  const utils = trpc.useUtils();
  const [property, setProperty] = useState<string>("all");
  const [year, setYear] = useState(new Date().getFullYear());

  const { data: expenses = [], isLoading } = trpc.expenses.list.useQuery({
    property: property === "all" ? undefined : property as any,
    year,
  });

  const deleteMutation = trpc.expenses.delete.useMutation({
    onSuccess: () => {
      utils.expenses.list.invalidate();
      utils.bookings.analytics.invalidate();
      toast.success(t("operations.expense_deleted"));
    },
    onError: (err) => {
      toast.error(`Failed to delete: ${err.message}`);
    }
  });

  const addMutation = trpc.expenses.add.useMutation({
    onSuccess: () => {
      utils.expenses.list.invalidate();
      utils.bookings.analytics.invalidate();
      toast.success(t("operations.expense_added"));
      setForm({
        property: "Sadoles",
        category: "power",
        amount: "",
        paymentDate: format(new Date(), "yyyy-MM-dd"),
        startDate: format(new Date(), "yyyy-MM-dd"),
        endDate: format(new Date(), "yyyy-MM-dd"),
        notes: "",
      });
    },
    onError: (err) => {
      toast.error(`Failed to add: ${err.message}`);
    }
  });

  const [isAddUtilityOpen, setIsAddUtilityOpen] = useState(false);
  const [isAddPurchaseOpen, setIsAddPurchaseOpen] = useState(false);

  const [form, setForm] = useState({
    property: "Sadoles",
    category: "power",
    amount: "",
    paymentDate: format(new Date(), "yyyy-MM-dd"),
    startDate: format(new Date(), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    notes: "",
  });

  const handleAddUtility = () => {
    addMutation.mutate({
      ...form,
      property: form.property as any,
      type: "utility",
      paymentDate: new Date(form.paymentDate),
      startDate: new Date(form.startDate),
      endDate: new Date(form.endDate),
    }, {
      onSuccess: () => setIsAddUtilityOpen(false),
    });
  };

  const handleAddPurchase = () => {
    addMutation.mutate({
      ...form,
      property: form.property as any,
      type: "purchase",
      paymentDate: new Date(form.paymentDate),
      startDate: undefined,
      endDate: undefined,
    }, {
      onSuccess: () => setIsAddPurchaseOpen(false),
    });
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "power": return <Zap className="h-4 w-4 text-yellow-500" />;
      case "gas": return <Flame className="h-4 w-4 text-blue-500" />;
      case "water": return <Droplets className="h-4 w-4 text-cyan-500" />;
      default: return <MoreHorizontal className="h-4 w-4 text-gray-500" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex gap-4">
          <Select value={property} onValueChange={setProperty}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t("dashboard.filter_property")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("dashboard.filter_all_properties")}</SelectItem>
              {PROPERTIES.map(p => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[2024, 2025, 2026].map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2">
          <Dialog open={isAddUtilityOpen} onOpenChange={setIsAddUtilityOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Plus className="h-4 w-4 mr-2" />
                {t("operations.add_utility")}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{t("operations.add_utility")}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-muted-foreground">{t("cleaning.property")}</label>
                    <Select value={form.property} onValueChange={v => setForm({...form, property: v})}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PROPERTIES.map(p => (
                          <SelectItem key={p} value={p}>{p}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-muted-foreground">{t("operations.utility_type")}</label>
                    <Select value={form.category} onValueChange={v => setForm({...form, category: v})}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="power">{t("operations.power")}</SelectItem>
                        <SelectItem value="gas">{t("operations.gas")}</SelectItem>
                        <SelectItem value="water">{t("operations.water")}</SelectItem>
                        <SelectItem value="other">{t("operations.other")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-muted-foreground">{t("operations.amount")} (PLN)</label>
                  <Input 
                    type="number" 
                    value={form.amount} 
                    onChange={e => setForm({...form, amount: e.target.value})} 
                    placeholder="0.00"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-muted-foreground">{t("operations.payment_date")}</label>
                  <Input 
                    type="date" 
                    value={form.paymentDate} 
                    onChange={e => setForm({...form, paymentDate: e.target.value})} 
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-muted-foreground">{t("operations.bill_period")} (From)</label>
                    <Input 
                      type="date" 
                      value={form.startDate} 
                      onChange={e => setForm({...form, startDate: e.target.value})} 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-muted-foreground">{t("operations.bill_period")} (To)</label>
                    <Input 
                      type="date" 
                      value={form.endDate} 
                      onChange={e => setForm({...form, endDate: e.target.value})} 
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-muted-foreground">Notes</label>
                  <Textarea 
                    value={form.notes} 
                    onChange={e => setForm({...form, notes: e.target.value})} 
                    placeholder="Additional information..."
                  />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleAddUtility} disabled={addMutation.isPending}>
                  {addMutation.isPending && <RefreshCw className="h-4 w-4 mr-2 animate-spin" />}
                  {t("common.save")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={isAddPurchaseOpen} onOpenChange={setIsAddPurchaseOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                {t("operations.add_purchase")}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{t("operations.add_purchase")}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-muted-foreground">{t("cleaning.property")}</label>
                  <Select value={form.property} onValueChange={v => setForm({...form, property: v})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PROPERTIES.map(p => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-muted-foreground">{t("operations.purchase_item")}</label>
                  <Input 
                    value={form.category} 
                    onChange={e => setForm({...form, category: e.target.value})} 
                    placeholder="e.g. Coffee beans"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-muted-foreground">{t("operations.amount")} (PLN)</label>
                  <Input 
                    type="number" 
                    value={form.amount} 
                    onChange={e => setForm({...form, amount: e.target.value})} 
                    placeholder="0.00"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-muted-foreground">{t("operations.payment_date")}</label>
                  <Input 
                    type="date" 
                    value={form.paymentDate} 
                    onChange={e => setForm({...form, paymentDate: e.target.value})} 
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-muted-foreground">Notes</label>
                  <Textarea 
                    value={form.notes} 
                    onChange={e => setForm({...form, notes: e.target.value})} 
                    placeholder="Optional details..."
                  />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleAddPurchase} disabled={addMutation.isPending}>
                  {addMutation.isPending && <RefreshCw className="h-4 w-4 mr-2 animate-spin" />}
                  {t("common.save")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t("cleaning.date")}</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t("cleaning.property")}</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t("operations.category")}</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t("operations.bill_period")}</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t("operations.amount")}</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={6} className="text-center py-8">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </td>
                </tr>
              )}
              {!isLoading && expenses.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-muted-foreground">
                    No expenses recorded for this period.
                  </td>
                </tr>
              )}
              {expenses.map((expense) => (
                <tr key={expense.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {format(new Date(expense.paymentDate), "dd.MM.yyyy")}
                  </td>
                  <td className="px-4 py-2.5">
                    {expense.property}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      {expense.type === "utility" ? getCategoryIcon(expense.category) : <ShoppingCart className="h-4 w-4 text-primary" />}
                      <span className="capitalize">{expense.category}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {expense.startDate && expense.endDate ? (
                      <div className="flex items-center gap-1">
                        <CalendarIcon className="h-3 w-3" />
                        {format(new Date(expense.startDate), "MM/yy")} - {format(new Date(expense.endDate), "MM/yy")}
                      </div>
                    ) : (
                      <span className="italic">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold">
                    {Math.round(Number(expense.amount)).toLocaleString(undefined, { maximumFractionDigits: 0 })} PLN
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="text-muted-foreground hover:text-destructive h-8 w-8"
                      onClick={() => deleteMutation.mutate({ id: expense.id })}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
