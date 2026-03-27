import React from "react";
import { Badge } from "@/components/ui/badge";

export function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    pending: "Pending",
    confirmed: "Confirmed",
    portal_paid: "Portal Paid",
    paid: "Paid",
    finished: "Finished",
    cancelled: "Cancelled",
  };

  const variants: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
    pending: "secondary",
    confirmed: "default",
    portal_paid: "outline",
    paid: "default",
    finished: "outline",
    cancelled: "destructive",
  };


  return (
    <Badge variant={variants[status] || "outline"}>
      {labels[status] ?? status}
    </Badge>
  );
}

export function DepositBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    pending: "Dep: Pending",
    paid: "Dep: Paid",
    returned: "Dep: Returned",
    not_applicable: "N/A",
  };

  const variants: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
    pending: "destructive",
    paid: "default",
    returned: "secondary",
    not_applicable: "outline",
  };

  if (status === "not_applicable") return null;

  return (
    <Badge variant={variants[status] || "outline"}>
      {labels[status] ?? status}
    </Badge>
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
    <Badge variant="secondary" className={`channel-${channel}`}>
      {labels[channel] ?? channel}
    </Badge>
  );
}
