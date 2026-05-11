
// ─── Channel colours ──────────────────────────────────────────────────────────

const CHANNEL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  airbnb:    { bg: "#fce7f3", text: "#9d174d", border: "#f9a8d4" },
  booking:   { bg: "#dbeafe", text: "#1e40af", border: "#93c5fd" },
  slowhop:   { bg: "#ffe4e6", text: "#9f1239", border: "#fecdd3" },
  alohacamp: { bg: "#ccfbf1", text: "#115e59", border: "#99f6e4" },
  direct:    { bg: "#ede9fe", text: "#4c1d95", border: "#ddd6fe" },
  unknown:   { bg: "#f1f5f9", text: "#475569", border: "#e2e8f0" },
};

const CHANNEL_LABELS: Record<string, string> = {
  airbnb: "Airbnb",
  booking: "Booking.com",
  slowhop: "Slowhop",
  alohacamp: "Alohacamp",
  direct: "Direct",
};

const CLEANING_COLORS = [
  { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", icon: "text-emerald-500" },
  { bg: "bg-sky-50", border: "border-sky-200", text: "text-sky-700", icon: "text-sky-500" },
  { bg: "bg-violet-50", border: "border-violet-200", text: "text-violet-700", icon: "text-violet-500" },
  { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", icon: "text-amber-500" },
];

const BOOKING_INFO_COLORS = [
  { bg: "bg-slate-100", border: "border-slate-300", text: "text-slate-700", bar: "bg-slate-400" },
  { bg: "bg-blue-100", border: "border-blue-300", text: "text-blue-700", bar: "bg-blue-400" },
  { bg: "bg-purple-100", border: "border-purple-300", text: "text-purple-700", bar: "bg-purple-400" },
  { bg: "bg-rose-100", border: "border-rose-300", text: "text-rose-700", bar: "bg-rose-400" },
];
export { CHANNEL_COLORS, CHANNEL_LABELS, CLEANING_COLORS, BOOKING_INFO_COLORS };
