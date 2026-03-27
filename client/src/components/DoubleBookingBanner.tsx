import { trpc } from "@/lib/trpc";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { format } from "date-fns";

export function DoubleBookingBanner() {
  const { data: conflicts = [] } = trpc.bookings.doubleBookings.useQuery(undefined, {
    refetchInterval: 60000, // Refresh every minute
  });

  if (conflicts.length === 0) return null;

  return (
    <Alert variant="destructive" className="mb-6 bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800">
      <AlertTriangle className="h-5 w-5 text-red-600" />
      <AlertTitle className="text-red-800 dark:text-red-400 font-bold">
        ⚠️ Double-Booking Detected ({conflicts.length})
      </AlertTitle>
      <AlertDescription className="text-red-700 dark:text-red-300 mt-1">
        There are overlapping bookings on the same property. Please review the following conflicts:
        <ul className="mt-2 list-disc list-inside space-y-1 text-sm">
          {conflicts.map((c, i) => (
            <li key={i}>
              <span className="font-semibold">{c.property}:</span>{" "}
              #{c.booking1.id} ({c.booking1.guestName || "Guest A"}) vs{" "}
              #{c.booking2.id} ({c.booking2.guestName || "Guest B"}) |{" "}
              {format(new Date(c.booking1.checkIn), "dd MMM")} → {format(new Date(c.booking1.checkOut), "dd MMM")}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
