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

import { ENV } from "../_core/env";

export const getICalFeeds = (): ICalFeed[] => [
  // ─── Sadoleś ────────────────────────────────────────────────────────────────
  {
    url: ENV.icalSadolesSlowhop,
    property: "Sadoles",
    channel: "slowhop",
    label: "Sadoles / Slowhop",
  },
  {
    url: ENV.icalSadolesAlohacamp,
    property: "Sadoles",
    channel: "alohacamp",
    label: "Sadoles / Alohacamp",
  },
  {
    url: ENV.icalSadolesBooking,
    property: "Sadoles",
    channel: "booking",
    label: "Sadoles / Booking.com",
  },
  {
    url: ENV.icalSadolesAirbnb,
    property: "Sadoles",
    channel: "airbnb",
    label: "Sadoles / Airbnb",
  },

  // ─── Hacjenda ───────────────────────────────────────────────────────────────
  {
    url: ENV.icalHacjendaSlowhop,
    property: "Hacjenda",
    channel: "slowhop",
    label: "Hacjenda / Slowhop",
  },
  {
    url: ENV.icalHacjendaBooking,
    property: "Hacjenda",
    channel: "booking",
    label: "Hacjenda / Booking.com",
  },
  {
    url: ENV.icalHacjendaAirbnb,
    property: "Hacjenda",
    channel: "airbnb",
    label: "Hacjenda / Airbnb",
  },
];

/** Polling interval in milliseconds (30 minutes) */
export const ICAL_POLL_INTERVAL_MS = 30 * 60 * 1000;
