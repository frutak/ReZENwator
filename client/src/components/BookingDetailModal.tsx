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
} from "lucide-react";
import { format, addDays } from "date-fns";
import { Booking } from "@shared/types";
import { StatusBadge, DepositBadge } from "@/components/ui/badges";
import { cn } from "@/lib/utils";

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
    checkOut: booking.checkOut ? format(new Date(booking.checkOut), "yyyy-MM-dd") : format(addDays(new Date(), 2), "yyyy-MM-dd"),
    guestName: booking.guestName ?? "",
    guestCountry: booking.guestCountry ?? "",
    guestEmail: booking.guestEmail ?? "",
    guestPhone: booking.guestPhone ?? "",
    guestCount: booking.guestCount ?? 0,
    adultsCount: booking.adultsCount ?? 0,
    childrenCount: booking.childrenCount ?? 0,
    animalsCount: booking.animalsCount ?? 0,
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
      checkOut: booking.checkOut ? format(new Date(booking.checkOut), "yyyy-MM-dd") : format(addDays(new Date(), 2), "yyyy-MM-dd"),
      guestName: booking.guestName ?? "",
      guestCountry: booking.guestCountry ?? "",
      guestEmail: booking.guestEmail ?? "",
      guestPhone: booking.guestPhone ?? "",
      guestCount: booking.guestCount ?? 0,
      adultsCount: booking.adultsCount ?? 0,
      childrenCount: booking.childrenCount ?? 0,
      animalsCount: booking.animalsCount ?? 0,
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
    const revenue = parseFloat(form.hostRevenue) || 0;
    const paid = parseFloat(form.amountPaid) || 0;
    return Math.max(0, revenue - paid).toFixed(2);
  }, [form.hostRevenue, form.amountPaid]);

  const handleSave = () => {
    if (isNew) {
      createBooking.mutate({
        ...form,
        property: form.property as any,
        checkIn: new Date(form.checkIn),
        checkOut: new Date(form.checkOut),
        channel: form.channel as any,
        status: form.status as any,
        depositStatus: form.depositStatus as any,
      });
    } else {
      updateDetails.mutate({
        id: booking.id!,
        ...form,
        channel: form.channel as any,
        status: form.status as any,
        depositStatus: form.depositStatus as any,
      });
    }
  };

  const inputClass = "w-full border rounded-lg px-3 py-2 text-sm bg-background focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all";
  const labelClass = "text-[10px] uppercase font-bold text-muted-foreground mb-1 block ml-1";

  return (
    <DialogContent className="max-w-2xl max-h-[95vh] overflow-y-auto p-0 border-0 shadow-2xl overflow-hidden">
      <DialogHeader className="p-6 bg-muted/30 border-b relative">
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

      <div className="p-6 space-y-8">
        {/* Dates & Quick Status */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-3 rounded-xl bg-primary/5 border border-primary/10">
            <div className="flex items-center gap-2 mb-1 text-primary/60">
              <Calendar className="h-3.5 w-3.5" />
              <span className="text-[10px] font-bold uppercase">Dates</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input 
                type="date"
                className="bg-transparent border-0 p-0 text-xs font-bold focus:ring-0 w-full"
                value={form.checkIn}
                onChange={(e) => handleChange("checkIn", e.target.value)}
              />
              <input 
                type="date"
                className="bg-transparent border-0 p-0 text-xs font-bold focus:ring-0 w-full"
                value={form.checkOut}
                onChange={(e) => handleChange("checkOut", e.target.value)}
              />
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5 font-medium">{nights} nights total</p>
          </div>
          <div className="p-3 rounded-xl bg-secondary/30 border border-secondary">
            <div className="flex items-center gap-2 mb-1 text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span className="text-[10px] font-bold uppercase">Status</span>
            </div>
            <div className="mt-1">
              <StatusBadge status={form.status} />
            </div>
          </div>
          <div className="p-3 rounded-xl bg-secondary/30 border border-secondary">
            <div className="flex items-center gap-2 mb-1 text-muted-foreground">
              <Banknote className="h-3.5 w-3.5" />
              <span className="text-[10px] font-bold uppercase">Deposit</span>
            </div>
            <div className="mt-1">
              <DepositBadge status={form.depositStatus} />
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
      </div>

      <footer className="p-6 bg-muted/30 border-t flex items-center justify-end gap-3">
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
      </footer>
    </DialogContent>
  );
}
