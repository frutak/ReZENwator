import { useState } from "react";
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
} from "lucide-react";
import { format } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Booking = {
  id: number;
  property: string;
  channel: string;
  checkIn: Date | string;
  checkOut: Date | string;
  status: string;
  depositStatus: string;
  guestName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  guestCount: number | null;
  adultsCount: number | null;
  childrenCount: number | null;
  animalsCount: number | null;
  amountPaid: string | null;
  totalPrice: string | null;
  hostRevenue: string | null;
  currency: string | null;
  transferAmount: string | null;
  transferSender: string | null;
  transferTitle: string | null;
  transferDate: Date | string | null;
  matchScore: number | null;
  notes: string | null;
  createdAt: Date | string;
};

// ─── Badge helpers ────────────────────────────────────────────────────────────

export function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    pending: "Pending",
    confirmed: "Confirmed",
    paid_to_intermediary: "Paid to Intermediary",
    paid: "Paid",
    finished: "Finished",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border status-${status}`}
    >
      {labels[status] ?? status}
    </span>
  );
}

export function DepositBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    pending: "Dep: Pending",
    paid: "Dep: Paid",
    returned: "Dep: Returned",
    not_applicable: "Dep: N/A",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border deposit-${status}`}
    >
      {labels[status] ?? status}
    </span>
  );
}

export function ChannelBadge({ channel }: { channel: string }) {
  const labels: Record<string, string> = {
    slowhop: "Slowhop",
    airbnb: "Airbnb",
    booking: "Booking.com",
    alohacamp: "Alohacamp",
    direct: "Direct",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium channel-${channel}`}
    >
      {labels[channel] ?? channel}
    </span>
  );
}

// ─── Booking Detail Modal ─────────────────────────────────────────────────────

export default function BookingDetailModal({
  booking,
  onClose,
}: {
  booking: Booking;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const updateStatus = trpc.bookings.updateStatus.useMutation({
    onSuccess: () => {
      utils.bookings.list.invalidate();
      utils.bookings.stats.invalidate();
      toast.success("Status updated");
    },
  });
  const updateDeposit = trpc.bookings.updateDeposit.useMutation({
    onSuccess: () => {
      utils.bookings.list.invalidate();
      toast.success("Deposit status updated");
    },
  });
  const updateNotes = trpc.bookings.updateNotes.useMutation({
    onSuccess: () => {
      utils.bookings.list.invalidate();
      toast.success("Notes saved");
    },
  });

  const updateDetails = trpc.bookings.updateDetails.useMutation({
    onSuccess: () => {
      utils.bookings.list.invalidate();
      utils.bookings.stats.invalidate();
      toast.success("Booking details updated");
    },
    onError: (err) => {
      console.error("Failed to update booking details:", err);
      toast.error(`Failed to update: ${err.message}`);
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

  const [notes, setNotes] = useState(booking.notes ?? "");
  const [guestName, setGuestName] = useState(booking.guestName ?? "");
  const [guestEmail, setGuestEmail] = useState(booking.guestEmail ?? "");
  const [guestPhone, setGuestPhone] = useState(booking.guestPhone ?? "");
  const [guestCount, setGuestCount] = useState(booking.guestCount ?? 0);
  const [adultsCount, setAdultsCount] = useState(booking.adultsCount ?? 0);
  const [childrenCount, setChildrenCount] = useState(booking.childrenCount ?? 0);
  const [animalsCount, setAnimalsCount] = useState(booking.animalsCount ?? 0);
  const [totalPrice, setTotalPrice] = useState(booking.totalPrice ?? "");
  const [hostRevenue, setHostRevenue] = useState(booking.hostRevenue ?? "");
  const [amountPaid, setAmountPaid] = useState(booking.amountPaid ?? "0.00");
  const [currency, setCurrency] = useState(booking.currency ?? "PLN");
  const [channel, setChannel] = useState(booking.channel);

  const nights = Math.round(
    (new Date(booking.checkOut).getTime() - new Date(booking.checkIn).getTime()) /
      (1000 * 60 * 60 * 24)
  );

  const handleSaveDetails = () => {
    updateDetails.mutate({
      id: booking.id,
      guestName,
      guestEmail,
      guestPhone,
      guestCount,
      adultsCount,
      childrenCount,
      animalsCount,
      totalPrice,
      hostRevenue,
      amountPaid,
      currency,
      channel: channel as "slowhop" | "airbnb" | "booking" | "alohacamp" | "direct",
    });
  };

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-white dark:bg-zinc-900 border shadow-xl">
      <DialogHeader className="flex flex-row items-center justify-between">
        <DialogTitle className="flex items-center gap-2">
          <Home className="h-5 w-5 text-primary" />
          {booking.property} — {booking.guestName ?? "Unknown Guest"}
        </DialogTitle>
        <div className="flex items-center gap-2 mr-6">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete this booking from the database. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction 
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => deleteBooking.mutate({ id: booking.id })}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </DialogHeader>

      <div className="grid grid-cols-2 gap-4 mt-2">
        {/* Dates */}
        <div className="col-span-2 bg-muted/50 rounded-lg p-3 grid grid-cols-3 gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Check-in</p>
            <p className="font-semibold">{format(new Date(booking.checkIn), "dd MMM yyyy")}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Check-out</p>
            <p className="font-semibold">{format(new Date(booking.checkOut), "dd MMM yyyy")}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Duration</p>
            <p className="font-semibold">{nights} night{nights !== 1 ? "s" : ""}</p>
          </div>
        </div>

        {/* Channel & Status */}
        <div>
          <p className="text-xs text-muted-foreground mb-1">Channel</p>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger className="h-8 text-xs font-medium border rounded-md px-2 bg-background">
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
        <div>
          <p className="text-xs text-muted-foreground mb-1">Status</p>
          <StatusBadge status={booking.status} />
        </div>

        {/* Guest details form */}
        <div className="col-span-2 border-t pt-4 mt-2">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <User className="h-4 w-4" /> Guest Information
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Guest Name</label>
              <input
                className="w-full border rounded-md px-2 py-1 text-sm bg-background"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Email</label>
              <input
                className="w-full border rounded-md px-2 py-1 text-sm bg-background"
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
                placeholder="email@example.com"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Phone</label>
              <input
                className="w-full border rounded-md px-2 py-1 text-sm bg-background"
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                placeholder="+48..."
              />
            </div>
            <div className="grid grid-cols-4 gap-2 col-span-2">
              <div>
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Total Guests</label>
                <input
                  type="number"
                  className="w-full border rounded-md px-2 py-1 text-sm bg-background"
                  value={guestCount}
                  onChange={(e) => setGuestCount(parseInt(e.target.value) || 0)}
                />
              </div>
              <div>
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Adults</label>
                <input
                  type="number"
                  className="w-full border rounded-md px-2 py-1 text-sm bg-background"
                  value={adultsCount}
                  onChange={(e) => setAdultsCount(parseInt(e.target.value) || 0)}
                />
              </div>
              <div>
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Children</label>
                <input
                  type="number"
                  className="w-full border rounded-md px-2 py-1 text-sm bg-background"
                  value={childrenCount}
                  onChange={(e) => setChildrenCount(parseInt(e.target.value) || 0)}
                />
              </div>
              <div>
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Animals</label>
                <input
                  type="number"
                  className="w-full border rounded-md px-2 py-1 text-sm bg-background"
                  value={animalsCount}
                  onChange={(e) => setAnimalsCount(parseInt(e.target.value) || 0)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Pricing form */}
        <div className="col-span-2 border-t pt-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Banknote className="h-4 w-4" /> Pricing & Payments
          </h3>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Total Price</label>
              <input
                className="w-full border rounded-md px-2 py-1 text-sm bg-background"
                value={totalPrice}
                onChange={(e) => setTotalPrice(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Amount Paid</label>
              <input
                className="w-full border rounded-md px-2 py-1 text-sm bg-green-50 dark:bg-green-900/10"
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Host Revenue</label>
              <input
                className="w-full border rounded-md px-2 py-1 text-sm bg-background"
                value={hostRevenue}
                onChange={(e) => setHostRevenue(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Currency</label>
              <input
                className="w-full border rounded-md px-2 py-1 text-sm bg-background"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              />
            </div>
          </div>
          <Button
            size="sm"
            className="mt-4 w-full"
            onClick={handleSaveDetails}
            disabled={updateDetails.isPending}
          >
            {updateDetails.isPending ? "Saving..." : "Save Guest & Pricing Details"}
          </Button>
        </div>

        {/* Transfer info (read only, derived from matching) */}
        {booking.transferSender && (
          <div className="col-span-2 border rounded-lg p-3 bg-blue-50/50 dark:bg-blue-900/10">
            <div className="flex items-center gap-2 mb-2">
              <Banknote className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium">Bank Transfer</p>
              {booking.matchScore != null && (
                <span className="text-xs text-muted-foreground ml-auto">
                  Match score: {booking.matchScore}%
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">From</p>
                <p>{booking.transferSender}</p>
              </div>
              {booking.transferAmount && (
                <div>
                  <p className="text-xs text-muted-foreground">Amount</p>
                  <p>{parseFloat(booking.transferAmount).toLocaleString("pl-PL")} PLN</p>
                </div>
              )}
              {booking.transferTitle && (
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Title</p>
                  <p className="text-xs">{booking.transferTitle}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Status controls */}
        <div>
          <p className="text-xs text-muted-foreground mb-1">Booking Status</p>
          <Select
            value={booking.status}
            onValueChange={(v) =>
              updateStatus.mutate({
                id: booking.id,
                status: v as "pending" | "confirmed" | "paid_to_intermediary" | "paid" | "finished",
              })
            }
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
              <SelectItem value="paid_to_intermediary">Paid to Intermediary</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="finished">Finished</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <p className="text-xs text-muted-foreground mb-1">Deposit Status</p>
          <Select
            value={booking.depositStatus}
            onValueChange={(v) =>
              updateDeposit.mutate({
                id: booking.id,
                depositStatus: v as "pending" | "paid" | "returned" | "not_applicable",
              })
            }
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="returned">Returned</SelectItem>
              <SelectItem value="not_applicable">Not Applicable</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Notes */}
        <div className="col-span-2">
          <div className="flex items-center gap-2 mb-1">
            <StickyNote className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Notes</p>
          </div>
          <textarea
            className="w-full border rounded-md p-2 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-ring bg-background"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add notes about this booking..."
          />
          <Button
            size="sm"
            variant="outline"
            className="mt-1"
            onClick={() => updateNotes.mutate({ id: booking.id, notes })}
          >
            Save Notes
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}
