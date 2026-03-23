/**
 * iCal feed configuration for all properties and channels.
 * Each entry maps a feed URL to its property and channel.
 */

export type ICalFeed = {
  url: string;
  property: "Sadoles" | "Hacjenda";
  channel: "slowhop" | "airbnb" | "booking" | "alohacamp" | "direct";
  label: string;
};

export const ICAL_FEEDS: ICalFeed[] = [
  // ─── Sadoleś ────────────────────────────────────────────────────────────────
  {
    url: "https://slowhop.com/icalendar-export/api-v1/97b6a63c3c13b84590355c299994b135.ics",
    property: "Sadoles",
    channel: "slowhop",
    label: "Sadoles / Slowhop",
  },
  {
    url: "https://api.alohacamp.com/icals/export/31ed0ec21a1876234a34fd84393d7ced.d8d681b9-e891-43e5-a2a7-5883396f0d9f.ics",
    property: "Sadoles",
    channel: "alohacamp",
    label: "Sadoles / Alohacamp",
  },
  {
    url: "https://ical.booking.com/v1/export?t=a74e8c0f-631e-4ad6-be02-d0bf845df870",
    property: "Sadoles",
    channel: "booking",
    label: "Sadoles / Booking.com",
  },
  {
    url: "https://www.airbnb.com/calendar/ical/39273784.ics?s=563df136ba803160a039397b3eb68de7",
    property: "Sadoles",
    channel: "airbnb",
    label: "Sadoles / Airbnb",
  },

  // ─── Hacjenda ───────────────────────────────────────────────────────────────
  {
    url: "https://slowhop.com/icalendar-export/api-v1/9e92af14bb5c437731b0c936dfed62af.ics",
    property: "Hacjenda",
    channel: "slowhop",
    label: "Hacjenda / Slowhop",
  },
  {
    url: "https://ical.booking.com/v1/export?t=c13d6960-4da0-4c5e-8d53-536646dfe394",
    property: "Hacjenda",
    channel: "booking",
    label: "Hacjenda / Booking.com",
  },
  {
    url: "https://www.airbnb.com/calendar/ical/1327633659929514853.ics?s=97a2e65adac1a91e0bcfee5964969aa5",
    property: "Hacjenda",
    channel: "airbnb",
    label: "Hacjenda / Airbnb",
  },
];

/** Polling interval in milliseconds (30 minutes) */
export const ICAL_POLL_INTERVAL_MS = 30 * 60 * 1000;
