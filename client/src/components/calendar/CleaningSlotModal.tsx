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
// ─── Cleaning Slot Modal ───────────────────────────────────────────────────────

function CleaningSlotModal({ slot, onClose }: { slot: { from: Date; to: Date; property: string } | null, onClose: () => void }) {
  const { t } = useLanguage();
  if (!slot) return null;

  return (
    <DialogContent className="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <SoapDispenserDroplet className="h-5 w-5 text-emerald-500" />
          {t("nav.cleaning")}
        </DialogTitle>
      </DialogHeader>
      <div className="py-6 space-y-6">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600">
            <Home className="h-6 w-6" />
          </div>
          <div>
            <h4 className="font-bold text-lg">{slot.property}</h4>
            <p className="text-sm text-muted-foreground">{t("calendar.cleaning_time")}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 rounded-xl bg-muted/50 border">
            <div className="flex items-center gap-2 mb-1 text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span className="text-[10px] font-bold uppercase">{t("cleaning.from")} ({t("cleaning.departure")})</span>
            </div>
            <p className="text-sm font-bold">{format(slot.from, "dd MMM HH:mm")}</p>
          </div>
          <div className="p-3 rounded-xl bg-muted/50 border">
            <div className="flex items-center gap-2 mb-1 text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span className="text-[10px] font-bold uppercase">{t("cleaning.to")} ({t("cleaning.arrival")})</span>
            </div>
            <p className="text-sm font-bold">{format(slot.to, "dd MMM HH:mm")}</p>
          </div>
        </div>

        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] font-bold text-emerald-700 uppercase mb-1">{t("nav.cleaning")}</span>
          <span className="text-2xl font-black text-emerald-800">
            {Math.floor((slot.to.getTime() - slot.from.getTime()) / (1000 * 60 * 60))}h {Math.floor(((slot.to.getTime() - slot.from.getTime()) / (1000 * 60)) % 60)}m
          </span>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={onClose} className="w-full">{t("common.save")}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

export { CleaningSlotModal };
