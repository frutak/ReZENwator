import { useState, useMemo, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Home, Calendar as CalendarIcon, Loader2, SoapDispenserDroplet, Clock } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, addMonths, subMonths, addDays, startOfDay } from "date-fns";
import { pl, enUS } from "date-fns/locale";
import BookingDetailModal from "@/components/BookingDetailModal";
import { Booking } from "@shared/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DoubleBookingBanner } from "@/components/DoubleBookingBanner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, getGuestName } from "@/lib/utils";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLanguage } from "@/contexts/LanguageContext";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { toast } from "sonner";
import { ListIcon } from "lucide-react";
import { CLEANING_STAFF } from "@shared/config";


import { CHANNEL_COLORS, CHANNEL_LABELS, CLEANING_COLORS, BOOKING_INFO_COLORS } from "./constants";
// ─── Legends ──────────────────────────────────────────────────────────────────

function BookingLegend() {
  return (
    <div className="flex flex-wrap gap-4 mb-6 px-2">
      {Object.entries(CHANNEL_LABELS).map(([key, label]) => {
        const colors = CHANNEL_COLORS[key] || CHANNEL_COLORS.unknown;
        return (
          <div key={key} className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-sm border" style={{ backgroundColor: colors.bg, borderColor: colors.border }} />
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

export { BookingLegend };
