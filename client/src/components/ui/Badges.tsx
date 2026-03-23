import React from "react";

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
    not_applicable: "N/A",
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
