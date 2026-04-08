import { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Home,
  User,
  Phone,
  Mail,
  Banknote,
  StickyNote,
  Trash2,
  Calendar,
  CheckCircle2,
  Globe,
  Users,
  Save,
  RefreshCw,
  Activity,
  Clock,
} from "lucide-react";
import { format, addDays, setHours, setMinutes } from "date-fns";
import { Booking } from "@shared/types";
import { StatusBadge, DepositBadge } from "@/components/ui/badges";
import { cn } from "@/lib/utils";

// ─── Activity Item Component ───────────────────────────────────────────────────

function ActivityItem({ activity }: { activity: any }) {
  const date = new Date(activity.createdAt);
  
  const icon = useMemo(() => {
    switch (activity.type) {
      case "email": return <Mail className="h-3 w-3" />;
      case "status_change": return <CheckCircle2 className="h-3 w-3" />;
      case "manual_edit": return <Save className="h-3 w-3" />;
      case "enrichment": return <Globe className="h-3 w-3" />;
      default: return <Activity className="h-3 w-3" />;
    }
  }, [activity.type]);

  const bgColor = useMemo(() => {
    switch (activity.type) {
      case "email": return "bg-blue-500/10 text-blue-500";
      case "status_change": return "bg-green-500/10 text-green-500";
      case "manual_edit": return "bg-amber-500/10 text-amber-500";
      case "enrichment": return "bg-purple-500/10 text-purple-500";
      default: return "bg-zinc-500/10 text-zinc-500";
    }
  }, [activity.type]);

  return (
    <div className="flex gap-3 relative pb-4 last:pb-0">
      <div className="absolute left-[13px] top-7 bottom-0 w-[1px] bg-muted last:hidden" />
      <div className={cn("h-7 w-7 rounded-full flex items-center justify-center shrink-0 z-10 shadow-sm", bgColor)}>
        {icon}
      </div>
      <div className="flex-1 pt-0.5">
        <div className="flex justify-between items-start">
          <p className="text-xs font-bold leading-none">{activity.action}</p>
          <span className="text-[9px] font-medium text-muted-foreground whitespace-nowrap">
            {format(date, "MMM d, HH:mm")}
          </span>
        </div>
        {activity.details && (
          <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{activity.details}</p>
        )}
      </div>
    </div>
  );
}

// ─── Booking Detail Modal ─────────────────────────────────────────────────────

export default function BookingDetailModal({
  booking,
  onClose,
}: {
  booking: Partial<Booking>;
  onClose: () => void;
}) {
  const isNew = !booking.id;
  const utils = trpc.useUtils();
  
  const updateDetails = trpc.bookings.updateDetails.useMutation({
    onSuccess: () => {
      utils.bookings.list.invalidate();
      utils.bookings.stats.invalidate();
      toast.success("Booking updated");
      onClose();
    },
    onError: (err) => {
      toast.error(`Failed to update: ${err.message}`);
    },
  });

  const createBooking = trpc.bookings.create.useMutation({
    onSuccess: () => {
      utils.bookings.list.invalidate();
      utils.bookings.stats.invalidate();
      toast.success("Booking created");
      onClose();
    },
    onError: (err) => {
      toast.error(`Failed to create: ${err.message}`);
    },
  });

  const deleteBooking = trpc.bookings.delete.useMutation({
    onSuccess: () => {
      utils.bookings.list.invalidate();
      utils.bookings.stats.invalidate();
      toast.success("Booking deleted");
      onClose();
    },
    onError: (e) => toast.error(`Failed to delete: ${e.message}`),
  });

  const [form, setForm] = useState({
    property: booking.property ?? "Sadoles",
    checkIn: booking.checkIn ? format(new Date(booking.checkIn), "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"),
    checkInTime: booking.checkIn ? format(new Date(booking.checkIn), "HH:mm") : "16:00",
    checkOut: booking.checkOut ? format(new Date(booking.checkOut), "yyyy-MM-dd") : format(addDays(new Date(), 2), "yyyy-MM-dd"),
    checkOutTime: booking.checkOut ? format(new Date(booking.checkOut), "HH:mm") : "10:00",
    guestName: booking.guestName ?? "",
    guestCountry: booking.guestCountry ?? "",
    guestEmail: booking.guestEmail ?? "",
    guestPhone: booking.guestPhone ?? "",
    guestCount: booking.guestCount ?? 0,
    adultsCount: booking.adultsCount ?? 0,
    childrenCount: booking.childrenCount ?? 0,
    animalsCount: booking.animalsCount ?? 0,
    purpose: booking.purpose ?? "leisure",
    companyName: (booking as any).companyName ?? "",
    nip: (booking as any).nip ?? "",
    totalPrice: booking.totalPrice ?? "",
    commission: (booking as any).commission ?? "0.00",
    hostRevenue: booking.hostRevenue ?? "",
    amountPaid: booking.amountPaid ?? "0.00",
    depositAmount: booking.depositAmount ?? "500.00",
    channel: booking.channel ?? "direct",
    status: booking.status ?? "confirmed",
    depositStatus: booking.depositStatus ?? "pending",
    notes: booking.notes ?? "",
  });

  // Sync form if booking changes
  useEffect(() => {
    setForm({
      property: booking.property ?? "Sadoles",
      checkIn: booking.checkIn ? format(new Date(booking.checkIn), "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"),
      checkInTime: booking.checkIn ? format(new Date(booking.checkIn), "HH:mm") : "16:00",
      checkOut: booking.checkOut ? format(new Date(booking.checkOut), "yyyy-MM-dd") : format(addDays(new Date(), 2), "yyyy-MM-dd"),
      checkOutTime: booking.checkOut ? format(new Date(booking.checkOut), "HH:mm") : "10:00",
      guestName: booking.guestName ?? "",
      guestCountry: booking.guestCountry ?? "",
      guestEmail: booking.guestEmail ?? "",
      guestPhone: booking.guestPhone ?? "",
      guestCount: booking.guestCount ?? 0,
      adultsCount: booking.adultsCount ?? 0,
      childrenCount: booking.childrenCount ?? 0,
      animalsCount: booking.animalsCount ?? 0,
      purpose: booking.purpose ?? "leisure",
      companyName: (booking as any).companyName ?? "",
      nip: (booking as any).nip ?? "",
      totalPrice: booking.totalPrice ?? "",
      commission: (booking as any).commission ?? "0.00",
      hostRevenue: booking.hostRevenue ?? "",
      amountPaid: booking.amountPaid ?? "0.00",
      depositAmount: booking.depositAmount ?? "500.00",
      channel: booking.channel ?? "direct",
      status: booking.status ?? "confirmed",
      depositStatus: booking.depositStatus ?? "pending",
      notes: booking.notes ?? "",
    });
  }, [booking]);

  const handleChange = (field: string, value: any) => {
    setForm(prev => {
      const next = { ...prev, [field]: value };
      
      // Auto-calculations
      if (field === "totalPrice" || field === "commission") {
        const total = parseFloat(next.totalPrice) || 0;
        const comm = parseFloat(next.commission) || 0;
        next.hostRevenue = (total - comm).toFixed(2);
      } else if (field === "hostRevenue") {
        const total = parseFloat(next.totalPrice) || 0;
        const rev = parseFloat(next.hostRevenue) || 0;
        next.commission = (total - rev).toFixed(2);
      }
      
      return next;
    });
  };

  const nights = Math.round(
    (new Date(form.checkOut).getTime() - new Date(form.checkIn).getTime()) /
      (1000 * 60 * 60 * 24)
  );

  const toBePaid = useMemo(() => {
    const total = parseFloat(form.totalPrice) || 0;
    const revenue = parseFloat(form.hostRevenue) || total;
    const paid = parseFloat(form.amountPaid) || 0;
    return Math.max(0, revenue - paid).toFixed(2);
  }, [form.hostRevenue, form.totalPrice, form.amountPaid]);

  const handleSave = () => {
    const parseDateTime = (dateStr: string, timeStr: string) => {
      const [hours, minutes] = timeStr.split(":").map(Number);
      const d = new Date(dateStr);
      return setMinutes(setHours(d, hours), minutes);
    };

    const finalCheckIn = parseDateTime(form.checkIn, form.checkInTime);
    const finalCheckOut = parseDateTime(form.checkOut, form.checkOutTime);

    if (isNew) {
      createBooking.mutate({
        ...form,
        property: form.property as any,
        checkIn: finalCheckIn,
        checkOut: finalCheckOut,
        channel: form.channel as any,
        status: form.status as any,
        depositStatus: form.depositStatus as any,
      });
    } else {
      updateDetails.mutate({
        id: booking.id!,
        ...form,
        checkIn: finalCheckIn,
        checkOut: finalCheckOut,
        channel: form.channel as any,
        status: form.status as any,
        depositStatus: form.depositStatus as any,
      });
    }
  };

  const { data: activities = [], isLoading: isLoadingActivities } = trpc.bookings.getActivities.useQuery(
    { bookingId: booking.id! },
    { enabled: !!booking.id }
  );

  const inputClass = "w-full border rounded-lg px-3 py-2 text-sm bg-background focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all";
  const labelClass = "text-[10px] uppercase font-bold text-muted-foreground mb-1 block ml-1";

  return (
    <DialogContent className="max-w-2xl h-[90vh] flex flex-col p-0 border-0 shadow-2xl overflow-hidden gap-0">
      <DialogHeader className="p-6 bg-muted/30 border-b relative shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
            <Home className="h-5 w-5" />
          </div>
          <div>
            <DialogTitle className="text-xl font-bold">
              {isNew ? "New Booking" : form.property}
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              {isNew ? "Manually add a reservation" : `Booking #${booking.id} • ${form.channel}`}
            </p>
          </div>
        </div>
        
        {!isNew && (
          <div className="absolute top-6 right-12 flex items-center gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete booking?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently remove this reservation. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction 
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => deleteBooking.mutate({ id: booking.id! })}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </DialogHeader>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* Dates Section - Full Width */}
        <section className="w-full">
          <div className="p-4 rounded-xl bg-primary/5 border border-primary/10">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <div className="flex items-center gap-1.5 mb-2 text-primary/60">
                  <Calendar className="h-3.5 w-3.5" />
                  <span className="text-[11px] font-bold uppercase tracking-wider">Check-in</span>
                </div>
                <div className="flex gap-4 items-center">
                  <div className="flex items-center w-[165px] border-b border-primary/20">
                    <input 
                      type="date"
                      className="bg-transparent border-0 p-1 px-0 text-sm font-bold focus:ring-0 w-full"
                      value={form.checkIn}
                      onChange={(e) => handleChange("checkIn", e.target.value)}
                    />
                  </div>
                  <div className="flex items-center w-[100px] border-b border-primary/20">
                    <input 
                      type="time"
                      className="bg-transparent border-0 p-1 px-0 text-sm font-bold focus:ring-0 w-full"
                      value={form.checkInTime}
                      onChange={(e) => handleChange("checkInTime", e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 mb-2 text-primary/60">
                  <Calendar className="h-3.5 w-3.5" />
                  <span className="text-[11px] font-bold uppercase tracking-wider">Check-out</span>
                </div>
                <div className="flex gap-4 items-center">
                  <div className="flex items-center w-[165px] border-b border-primary/20">
                    <input 
                      type="date"
                      className="bg-transparent border-0 p-1 px-0 text-sm font-bold focus:ring-0 w-full"
                      value={form.checkOut}
                      onChange={(e) => handleChange("checkOut", e.target.value)}
                    />
                  </div>
                  <div className="flex items-center w-[100px] border-b border-primary/20">
                    <input 
                      type="time"
                      className="bg-transparent border-0 p-1 px-0 text-sm font-bold focus:ring-0 w-full"
                      value={form.checkOutTime}
                      onChange={(e) => handleChange("checkOutTime", e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-primary/10 flex justify-between items-center">
              <p className="text-xs text-muted-foreground font-medium">{nights} nights total</p>
              <div className="flex gap-3">
                 <StatusBadge status={form.status} />
                 <DepositBadge status={form.depositStatus} />
              </div>
            </div>
          </div>
        </section>

        {/* Form Sections */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Guest Information */}
          <section className="space-y-4">
            <div className="flex items-center gap-2 border-b pb-2">
              <User className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-bold uppercase tracking-wider">Guest Info</h3>
            </div>
            
            <div className="space-y-3">
              {isNew && (
                <div>
                  <label className={labelClass}>Property</label>
                  <Select value={form.property} onValueChange={(v) => handleChange("property", v)}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Sadoles">Sadoleś</SelectItem>
                      <SelectItem value="Hacjenda">Hacjenda</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div>
                <label className={labelClass}>Name</label>
                <input
                  className={inputClass}
                  value={form.guestName}
                  onChange={(e) => handleChange("guestName", e.target.value)}
                  placeholder="Full name"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Purpose</label>
                  <Select value={form.purpose} onValueChange={(v) => handleChange("purpose", v)}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="leisure">Leisure</SelectItem>
                      <SelectItem value="production">Production</SelectItem>
                      <SelectItem value="company">Company</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className={labelClass}>Channel</label>
                  <Select value={form.channel} onValueChange={(v) => handleChange("channel", v)}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="slowhop">Slowhop</SelectItem>
                      <SelectItem value="airbnb">Airbnb</SelectItem>
                      <SelectItem value="booking">Booking.com</SelectItem>
                      <SelectItem value="alohacamp">Alohacamp</SelectItem>
                      <SelectItem value="direct">Direct</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {form.purpose !== "leisure" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Company Name</label>
                    <input
                      className={inputClass}
                      value={form.companyName}
                      onChange={(e) => handleChange("companyName", e.target.value)}
                      placeholder="Company name"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>NIP</label>
                    <input
                      className={inputClass}
                      value={form.nip}
                      onChange={(e) => handleChange("nip", e.target.value)}
                      placeholder="VAT ID"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className={labelClass}>Country</label>
                  <div className="relative">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      className={cn(inputClass, "pl-9")}
                      value={form.guestCountry}
                      onChange={(e) => handleChange("guestCountry", e.target.value)}
                      placeholder="e.g. PL"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className={labelClass}>Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    className={cn(inputClass, "pl-9")}
                    value={form.guestEmail}
                    onChange={(e) => handleChange("guestEmail", e.target.value)}
                    placeholder="email@example.com"
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Phone</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    className={cn(inputClass, "pl-9")}
                    value={form.guestPhone}
                    onChange={(e) => handleChange("guestPhone", e.target.value)}
                    placeholder="+48..."
                  />
                </div>
              </div>
              
              <div className="pt-2">
                <label className={labelClass}>Party Composition</label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { key: "guestCount", label: "Total", icon: Users },
                    { key: "adultsCount", label: "Adults", icon: null },
                    { key: "childrenCount", label: "Kids", icon: null },
                    { key: "animalsCount", label: "Pets", icon: null },
                  ].map((field) => (
                    <div key={field.key} className="text-center">
                      <input
                        type="number"
                        className={cn(inputClass, "px-1 text-center h-9")}
                        value={(form as any)[field.key]}
                        onChange={(e) => handleChange(field.key, parseInt(e.target.value) || 0)}
                      />
                      <span className="text-[9px] font-bold text-muted-foreground uppercase mt-1 block">
                        {field.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Pricing & Status */}
          <section className="space-y-4">
            <div className="flex items-center gap-2 border-b pb-2">
              <Banknote className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-bold uppercase tracking-wider">Financials</h3>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Total Price</label>
                  <div className="relative">
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-muted-foreground">PLN</span>
                    <input
                      className={inputClass}
                      value={form.totalPrice}
                      onChange={(e) => handleChange("totalPrice", e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Amount Paid</label>
                  <div className="relative">
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-muted-foreground">PLN</span>
                    <input
                      className={inputClass}
                      value={form.amountPaid}
                      onChange={(e) => handleChange("amountPaid", e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Commission</label>
                  <div className="relative">
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-muted-foreground">PLN</span>
                    <input
                      className={cn(inputClass, "border-amber-200 bg-amber-50/30")}
                      value={form.commission}
                      onChange={(e) => handleChange("commission", e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Host Revenue</label>
                  <div className="relative">
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-muted-foreground">PLN</span>
                    <input
                      className={cn(inputClass, "font-bold border-primary/30 bg-primary/5")}
                      value={form.hostRevenue}
                      onChange={(e) => handleChange("hostRevenue", e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-800 flex justify-between items-center">
                <span className="text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-400">Balance due (Net)</span>
                <span className="text-base font-black text-emerald-700 dark:text-emerald-400">{toBePaid} PLN</span>
              </div>

              {form.channel === "booking" && parseInt(form.animalsCount) > 0 && (
                <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800 flex justify-between items-center">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold uppercase text-amber-700 dark:text-amber-400">Extra: Pet Fee</span>
                    <span className="text-[9px] text-amber-600/80 dark:text-amber-500/80 font-medium">To be paid directly by guest</span>
                  </div>
                  <span className="text-base font-black text-amber-700 dark:text-amber-400">{(parseInt(form.animalsCount) * 200).toFixed(2)} PLN</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Booking Status</label>
                  <Select value={form.status} onValueChange={(v) => handleChange("status", v)}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="confirmed">Confirmed</SelectItem>
                      <SelectItem value="portal_paid">Portal Paid</SelectItem>
                      <SelectItem value="paid">Fully Paid</SelectItem>
                      <SelectItem value="finished">Finished</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className={labelClass}>Deposit Status</label>
                  <Select value={form.depositStatus} onValueChange={(v) => handleChange("depositStatus", v)}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="returned">Returned</SelectItem>
                      <SelectItem value="not_applicable">N/A</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <label className={labelClass}>Notes</label>
                <div className="relative">
                  <StickyNote className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <textarea
                    className={cn(inputClass, "pl-9 min-h-[60px] py-2 resize-none text-xs")}
                    value={form.notes}
                    onChange={(e) => handleChange("notes", e.target.value)}
                    placeholder="Add private notes..."
                  />
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Activity History */}
        {!isNew && (
          <section className="space-y-4 pt-4 border-t">
            <div className="flex items-center gap-2 pb-2">
              <Activity className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-bold uppercase tracking-wider">History & Activities</h3>
            </div>
            
            <div className="bg-muted/20 rounded-2xl p-6 border border-muted/50">
              {isLoadingActivities ? (
                <div className="flex justify-center py-4">
                  <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : activities.length > 0 ? (
                <div className="space-y-0">
                  {activities.map((activity: any) => (
                    <ActivityItem key={activity.id} activity={activity} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-xs text-muted-foreground italic">No activities recorded yet.</p>
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      <DialogFooter className="p-6 bg-muted/30 border-t flex items-center justify-end gap-3 shrink-0">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button 
          className="px-8 shadow-md"
          onClick={handleSave}
          disabled={updateDetails.isPending || createBooking.isPending}
        >
          {updateDetails.isPending || createBooking.isPending ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          {isNew ? "Create Booking" : "Save Changes"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

