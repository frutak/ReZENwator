import { useState, useMemo, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Home, Tag, Loader2, Settings, Plus, Trash2, AlertTriangle, Info, RefreshCw } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, addMonths, subMonths, startOfDay, addDays } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/_core/hooks/useAuth";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// ─── Constants ───────────────────────────────────────────────────────────────

const PLAN_COLORS: Record<string, string> = {
  Low: "#f1f5f9",      // Slate 100
  Mixed: "#fef9c3",    // Yellow 100
  High: "#ffedd5",     // Orange 100
  Special: "#fee2e2",  // Red 100
  New: "#fae8ff",      // Fuchsia 100
};

// ─── Pricing Plan Modal ────────────────────────────────────────────────────────

function PricingPlanModal({ plan, onClose, onUpdated }: { plan: any, onClose: () => void, onUpdated: () => void }) {
  const [price, setPrice] = useState(plan.nightlyPrice);
  const [minStay, setMinStay] = useState(plan.minStay);

  const updateMutation = trpc.pricing.updatePlan.useMutation({
    onSuccess: () => {
      toast.success("Pricing plan updated");
      onUpdated();
      onClose();
    },
    onError: (err) => toast.error(err.message)
  });

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Edit Pricing Plan</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label>Plan Name</Label>
          <Input value={plan.planName} disabled className="bg-muted" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Nightly Price (PLN)</Label>
            <Input type="number" value={price} onChange={e => setPrice(parseInt(e.target.value))} />
          </div>
          <div className="space-y-2">
            <Label>Min Stay (Nights)</Label>
            <Input type="number" value={minStay} onChange={e => setMinStay(parseInt(e.target.value))} />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => updateMutation.mutate({ id: plan.planId, nightlyPrice: price, minStay })} disabled={updateMutation.isPending}>
          {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Changes
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ─── Property Settings Modal ──────────────────────────────────────────────────

function PropertySettingsModal({ property, onClose }: { property: "Sadoles" | "Hacjenda", onClose: () => void }) {
  const utils = trpc.useUtils();
  const { data: settings, isLoading } = trpc.booking.getPropertySettings.useQuery({ property });
  
  const [fixedFee, setFixedFee] = useState(800);
  const [petFee, setPetFee] = useState(200);
  const [lmDiscount, setLmDiscount] = useState(0.05);
  const [lmDays, setLmDays] = useState(14);
  const [peopleDiscounts, setPeopleDiscounts] = useState<{ maxGuests: number, multiplier: number }[]>([]);
  const [stayDiscounts, setStayDiscounts] = useState<{ minNights: number, discount: number }[]>([]);

  useEffect(() => {
    if (settings) {
      setFixedFee(settings.fixedBookingPrice);
      setPetFee(settings.petFee ?? 200);
      setLmDiscount(parseFloat(String(settings.lastMinuteDiscount ?? "0.05")));
      setLmDays(settings.lastMinuteDays ?? 14);
      
      const pDisc = typeof settings.peopleDiscount === 'string' 
        ? JSON.parse(settings.peopleDiscount) 
        : (settings.peopleDiscount || []);
      setPeopleDiscounts(pDisc);
      
      const sDisc = typeof settings.stayDurationDiscounts === 'string'
        ? JSON.parse(settings.stayDurationDiscounts)
        : (settings.stayDurationDiscounts || []);
      setStayDiscounts(sDisc);
    }
  }, [settings]);

  const updateMutation = trpc.pricing.updateSettings.useMutation({
    onSuccess: () => {
      toast.success("Property settings updated");
      utils.booking.getPropertySettings.invalidate({ property });
      onClose();
    },
    onError: (err) => toast.error(err.message)
  });

  if (isLoading) return <div className="p-10 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto" /></div>;

  const handleSave = () => {
    updateMutation.mutate({
      property,
      fixedBookingPrice: fixedFee,
      petFee,
      peopleDiscount: peopleDiscounts,
      lastMinuteDiscount: lmDiscount,
      lastMinuteDays: lmDays,
      stayDurationDiscounts: stayDiscounts,
    });
  };

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Object Price Settings — {property}</DialogTitle>
      </DialogHeader>
      
      <div className="space-y-6 py-4">
        {/* Basic Fees */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Fixed Booking Fee (PLN)</Label>
            <Input type="number" value={fixedFee} onChange={e => setFixedFee(parseInt(e.target.value) || 0)} />
          </div>
          <div className="space-y-2">
            <Label>Pet Fee (PLN per pet)</Label>
            <Input type="number" value={petFee} onChange={e => setPetFee(parseInt(e.target.value) || 0)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Last Minute Discount (%)</Label>
            <Input type="number" step="0.01" value={lmDiscount} onChange={e => setLmDiscount(parseFloat(e.target.value) || 0)} />
            <p className="text-[10px] text-muted-foreground">e.g. 0.05 for 5%</p>
          </div>
          <div className="space-y-2">
            <Label>Last Minute Days</Label>
            <Input type="number" value={lmDays} onChange={e => setLmDays(parseInt(e.target.value) || 0)} />
          </div>
        </div>

        {/* People Discounts */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-base font-semibold">People Multipliers</Label>
            <Button variant="outline" size="sm" onClick={() => setPeopleDiscounts([...peopleDiscounts, { maxGuests: 0, multiplier: 1.0 }])}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Bracket
            </Button>
          </div>
          <div className="space-y-2">
            {[...peopleDiscounts].sort((a,b) => a.maxGuests - b.maxGuests).map((d, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground min-w-[60px]">Up to</span>
                  <Input type="number" className="h-8" value={d.maxGuests} onChange={e => {
                    const newD = [...peopleDiscounts];
                    newD[i].maxGuests = parseInt(e.target.value) || 0;
                    setPeopleDiscounts(newD);
                  }} />
                  <span className="text-xs text-muted-foreground">guests:</span>
                </div>
                <div className="flex-1 flex items-center gap-2">
                  <Input type="number" step="0.01" className="h-8" value={d.multiplier} onChange={e => {
                    const newD = [...peopleDiscounts];
                    newD[i].multiplier = parseFloat(e.target.value) || 0;
                    setPeopleDiscounts(newD);
                  }} />
                  <span className="text-xs text-muted-foreground">multiplier</span>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => {
                  setPeopleDiscounts(peopleDiscounts.filter((_, idx) => idx !== i));
                }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {peopleDiscounts.length === 0 && <p className="text-xs text-muted-foreground italic">No guest count multipliers defined.</p>}
          </div>
        </div>

        {/* Stay Duration Discounts */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-base font-semibold">Stay Duration Discounts</Label>
            <Button variant="outline" size="sm" onClick={() => setStayDiscounts([...stayDiscounts, { minNights: 0, discount: 0 }])}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Discount
            </Button>
          </div>
          <div className="space-y-2">
            {[...stayDiscounts].sort((a,b) => b.minNights - a.minNights).map((d, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-2">
                  <Input type="number" className="h-8" value={d.minNights} onChange={e => {
                    const newD = [...stayDiscounts];
                    newD[i].minNights = parseInt(e.target.value) || 0;
                    setStayDiscounts(newD);
                  }} />
                  <span className="text-xs text-muted-foreground">nights or more:</span>
                </div>
                <div className="flex-1 flex items-center gap-2">
                  <Input type="number" step="0.01" className="h-8" value={d.discount} onChange={e => {
                    const newD = [...stayDiscounts];
                    newD[i].discount = parseFloat(e.target.value) || 0;
                    setStayDiscounts(newD);
                  }} />
                  <span className="text-xs text-muted-foreground">discount (%)</span>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => {
                  setStayDiscounts(stayDiscounts.filter((_, idx) => idx !== i));
                }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {stayDiscounts.length === 0 && <p className="text-xs text-muted-foreground italic">No duration-based discounts defined.</p>}
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={updateMutation.isPending}>
          {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save All Settings
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ─── Property Pricing Calendar ──────────────────────────────────────────────

function PropertyPricingCalendar({
  property,
  pricing,
  month,
  onSelectPricingPlan,
}: {
  property: string;
  pricing: any[];
  month: Date;
  onSelectPricingPlan: (plan: any) => void;
}) {
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const firstDayOfWeek = (getDay(monthStart) + 6) % 7;
  const paddingDays = Array.from({ length: firstDayOfWeek });

  return (
    <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
      <div className="bg-muted/30 px-4 py-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Home className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold">{property}</h3>
        </div>
      </div>

      <div className="grid grid-cols-7 text-center border-b bg-muted/10">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="py-2 text-[10px] uppercase font-bold text-muted-foreground">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 auto-rows-[minmax(80px,auto)]">
        {paddingDays.map((_, i) => (
          <div key={`pad-${i}`} className="border-r border-b bg-muted/5 last:border-r-0" />
        ))}

        {days.map((day) => {
          const dayStr = format(day, "yyyy-MM-dd");
          const dayPricing = pricing.find(p => p.date === dayStr);
          
          let planType = "";
          if (dayPricing) {
            const parts = dayPricing.planName.split(" ");
            planType = parts[1] || "";
            if (planType === "Mid") planType = "Mixed";
          }
          
          const bgColor = PLAN_COLORS[planType] || "#ffffff";

          return (
            <div 
              key={day.toString()} 
              className={cn(
                "border-r border-b p-1 min-h-[80px] last:border-r-0 group transition-colors cursor-pointer hover:border-primary/50"
              )}
              style={{ backgroundColor: bgColor }}
              onClick={() => {
                if (dayPricing) onSelectPricingPlan(dayPricing);
              }}
            >
              <div className="text-right flex justify-between items-start">
                {dayPricing && (
                  <span className="text-[9px] font-bold text-muted-foreground/60 p-0.5 leading-none">
                    {dayPricing.nightlyPrice} zł
                  </span>
                )}
                <div className="flex-1" />
                <span className={`text-xs ${isSameDay(day, new Date()) ? "bg-primary text-white h-5 w-5 inline-flex items-center justify-center rounded-full" : "text-muted-foreground"}`}>
                  {format(day, "d")}
                </span>
              </div>

              <div className="mt-2 flex flex-col items-center justify-center gap-1">
                {dayPricing && (
                  <>
                    <div className="text-[8px] font-bold uppercase tracking-tighter text-center leading-none text-muted-foreground/80">
                      {dayPricing.planName.split(": ")[1]}
                    </div>
                    <div className="text-[9px] font-medium text-muted-foreground/60">
                      min {dayPricing.minStay}n
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Manual Audit Modal ──────────────────────────────────────────────────────

function ManualAuditModal({ 
  isOpen, 
  onClose, 
  property, 
  checkIn, 
  checkOut, 
  onConfirm 
}: { 
  isOpen: boolean;
  onClose: () => void;
  property: string;
  checkIn: Date | null;
  checkOut: Date | null;
  onConfirm: (cin: Date, cout: Date) => void;
}) {
  console.log("ManualAuditModal rendered, isOpen:", isOpen);
  const [cin, setCin] = useState<string>("");
  const [cout, setCout] = useState<string>("");

  useEffect(() => {
    if (checkIn) setCin(format(checkIn, "yyyy-MM-dd"));
    if (checkOut) setCout(format(checkOut, "yyyy-MM-dd"));
  }, [checkIn, checkOut, isOpen]);

  const handleConfirm = () => {
    if (cin && cout) {
      onConfirm(new Date(cin), new Date(cout));
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manual Price Audit</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Property</Label>
            <Input value={property} disabled className="bg-muted" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Check-in</Label>
              <Input type="date" value={cin} onChange={e => setCin(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Check-out</Label>
              <Input type="date" value={cout} onChange={e => setCout(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground italic">
            This will trigger a new probe on all portals for the selected dates. 
            The process runs in the background and may take up to 2 minutes.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleConfirm}>Run Audit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Auditor Calendar View ───────────────────────────────────────────────────

function AuditorCalendar({
  property,
  audits,
  month,
  onDateClick,
}: {
  property: string;
  audits: any[];
  month: Date;
  onDateClick: (date: Date) => void;
}) {
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const firstDayOfWeek = (getDay(monthStart) + 6) % 7;
  const paddingDays = Array.from({ length: firstDayOfWeek });

  // Only show the latest audit for a given date range
  const latestAudits = useMemo(() => {
    const map = new Map<string, any>();
    audits.forEach(audit => {
      const cin = format(new Date(audit.checkIn), "yyyy-MM-dd");
      const cout = format(new Date(audit.checkOut), "yyyy-MM-dd");
      const key = `${cin}_${cout}`;
      const existing = map.get(key);
      if (!existing || new Date(audit.dateScraped) > new Date(existing.dateScraped)) {
        map.set(key, audit);
      }
    });
    return Array.from(map.values());
  }, [audits]);

  return (
    <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
      <div className="bg-muted/30 px-4 py-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Home className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold">{property} Auditor</h3>
        </div>
      </div>

      <div className="grid grid-cols-7 text-center border-b bg-muted/10">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="py-2 text-[10px] uppercase font-bold text-muted-foreground">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 auto-rows-[minmax(80px,auto)]">
        {paddingDays.map((_, i) => (
          <div key={`pad-${i}`} className="border-r border-b bg-muted/5 last:border-r-0" />
        ))}

        {days.map((day) => {
          // Audits starting today
          const startingAudits = latestAudits.filter(a => isSameDay(new Date(a.checkIn), day));
          
          // Audits ongoing today (after check-in, before check-out)
          const ongoingAudits = latestAudits.filter(a => {
            const cin = startOfDay(new Date(a.checkIn));
            const cout = startOfDay(new Date(a.checkOut));
            const d = startOfDay(day);
            return d > cin && d < cout;
          });

          // Audits ending today
          const endingAudits = latestAudits.filter(a => isSameDay(new Date(a.checkOut), day));

          return (
            <div 
              key={day.toString()} 
              className={cn(
                "border-r border-b p-1 min-h-[80px] last:border-r-0 group transition-colors bg-white cursor-pointer hover:bg-muted/10"
              )}
              onClick={() => onDateClick(day)}
            >
              <div className="text-right flex justify-between items-start">
                <div className="flex-1" />
                <span className={`text-xs ${isSameDay(day, new Date()) ? "bg-primary text-white h-5 w-5 inline-flex items-center justify-center rounded-full" : "text-muted-foreground"}`}>
                  {format(day, "d")}
                </span>
              </div>

              <div className="mt-2 flex flex-col gap-1.5">
                {/* Ongoing/Ending audit bars (thin lines) */}
                {[...ongoingAudits, ...endingAudits].map((audit, idx) => {
                  const isEnding = isSameDay(new Date(audit.checkOut), day);
                  const isRed = audit.maxDeviation > 0.15;
                  return (
                    <div 
                      key={`ongoing-${audit.id}-${idx}`}
                      className={cn(
                        "h-1.5 opacity-60",
                        isRed ? "bg-red-500" : "bg-green-500",
                        isEnding ? "rounded-l-none rounded-r-full mr-2" : "rounded-none"
                      )}
                    />
                  );
                })}

                {/* Starting audit blocks (with tooltip and text) */}
                {startingAudits.map((audit, idx) => (
                  <TooltipProvider key={audit.id}>
                    <Tooltip>
                      <TooltipTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <div 
                          className={cn(
                            "text-[9px] font-bold px-1.5 py-1 rounded-l-md shadow-sm cursor-help flex items-center justify-between transition-transform hover:scale-[1.02]",
                            audit.maxDeviation > 0.15 ? "bg-red-500 text-white" : "bg-green-600 text-white"
                          )}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="truncate">Stay {Math.round((new Date(audit.checkOut).getTime() - new Date(audit.checkIn).getTime()) / (1000*60*60*24))}n</span>
                          <span className="ml-1 opacity-80">{Math.round(audit.maxDeviation * 100)}%</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="w-64 p-3 z-50">
                        <div className="space-y-2">
                          <div className="font-bold border-b pb-1 flex justify-between items-center">
                            <span>{format(new Date(audit.checkIn), "dd MMM")} - {format(new Date(audit.checkOut), "dd MMM")}</span>
                            {audit.isMinStayTest === 1 && <span className="bg-blue-100 text-blue-700 text-[8px] px-1 rounded">Min Stay Test</span>}
                          </div>
                          <div className="flex flex-col gap-0.5 border-b pb-1.5 mb-1.5">
                            <div className="flex justify-between text-xs">
                              <span className="text-muted-foreground font-semibold">Portal Price:</span>
                              <span className="font-bold">{audit.portalPrice} zł</span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-muted-foreground font-semibold">Benchmark Price:</span>
                              <span className="font-bold">{audit.portalPrice} + {audit.offsetPrice} = {audit.internalPrice} zł</span>
                            </div>
                          </div>
                          {Object.entries(audit.deviations).map(([portal, dev]: [any, any]) => (
                            <div key={portal} className="flex justify-between text-xs">
                              <span className="capitalize">{portal}:</span>
                              <div className="flex gap-2 items-center">
                                <span className="text-muted-foreground">{audit[`${portal}Price`]} zł</span>
                                <span className={cn("font-bold", dev > 0.15 ? "text-red-500" : "text-green-600")}>
                                  {dev > 0 ? `+${Math.round(dev * 100)}%` : "0%"}
                                </span>
                              </div>
                            </div>
                          ))}
                          <div className="text-[10px] italic text-muted-foreground pt-1 border-t mt-1">
                            {audit.bookingStatus !== "OK" && <div>Booking: {audit.bookingStatus}</div>}
                            {audit.airbnbStatus !== "OK" && <div>Airbnb: {audit.airbnbStatus}</div>}
                            {audit.slowhopStatus !== "OK" && <div>Slowhop: {audit.slowhopStatus}</div>}
                            {audit.alohacampStatus !== "OK" && audit.alohacampStatus && <div>Alohacamp: {audit.alohacampStatus}</div>}
                          </div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Legends ──────────────────────────────────────────────────────────────────

function PricingLegend() {
  const types = [
    { label: "Low Season", color: PLAN_COLORS.Low },
    { label: "Mixed Season", color: PLAN_COLORS.Mixed },
    { label: "High Season", color: PLAN_COLORS.High },
    { label: "Special Holiday", color: PLAN_COLORS.Special },
    { label: "New Year", color: PLAN_COLORS.New },
  ];

  return (
    <div className="flex flex-wrap gap-4 mb-6 px-2">
      {types.map((t) => (
        <div key={t.label} className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm border" style={{ backgroundColor: t.color }} />
          <span className="text-xs font-medium text-muted-foreground">{t.label}</span>
        </div>
      ))}
    </div>
  );
}

function AuditorLegend() {
  return (
    <div className="flex flex-wrap gap-4 mb-6 px-2">
      <div className="flex items-center gap-1.5">
        <div className="h-3 w-3 rounded-sm border bg-green-100 border-green-200" />
        <span className="text-xs font-medium text-muted-foreground">Price In Sync (&lt;15%)</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="h-3 w-3 rounded-sm border bg-red-500 border-red-600" />
        <span className="text-xs font-medium text-muted-foreground">High Deviation (&gt;15%)</span>
      </div>
      <div className="flex items-center gap-1.5 ml-4">
        <Info className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground">Prices shown are RAW guest-facing prices without adjustments.</span>
      </div>
    </div>
  );
}

// ─── Main Pricing Page ────────────────────────────────────────────────────────

export default function PricingDashboard() {
  const { user } = useAuth();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [activeTab, setActiveTab] = useState("plans");
  const [selectedPlan, setSelectedPlan] = useState<any>(null);
  const [settingsProperty, setSettingsProperty] = useState<"Sadoles" | "Hacjenda" | null>(null);

  const [manualAuditOpen, setManualAuditOpen] = useState(false);
  const [manualProperty, setManualProperty] = useState<"Sadoles" | "Hacjenda">("Sadoles");
  const [manualCheckIn, setManualCheckIn] = useState<Date | null>(null);
  const [manualCheckOut, setManualCheckOut] = useState<Date | null>(null);

  const windowStart = useMemo(() => subMonths(month, 1), [month]);
  const windowEnd = useMemo(() => endOfMonth(addMonths(month, 1)), [month]);

  const { data: pricingS = [], isLoading: isLoadingS, refetch: refetchS } = trpc.pricing.getPricing.useQuery({
    property: "Sadoles",
    from: windowStart,
    to: windowEnd,
  }, { enabled: activeTab === "plans" && (!user?.propertyAccess || user.propertyAccess === "Sadoles") });

  const { data: pricingH = [], isLoading: isLoadingH, refetch: refetchH } = trpc.pricing.getPricing.useQuery({
    property: "Hacjenda",
    from: windowStart,
    to: windowEnd,
  }, { enabled: activeTab === "plans" && (!user?.propertyAccess || user.propertyAccess === "Hacjenda") });

  const { data: auditsS = [], isLoading: isLoadingAuditS } = trpc.pricingAudit.getAudits.useQuery({
    property: "Sadoles",
    from: windowStart,
    to: windowEnd,
  }, { enabled: activeTab === "auditor" && (!user?.propertyAccess || user.propertyAccess === "Sadoles") });

  const { data: auditsH = [], isLoading: isLoadingAuditH } = trpc.pricingAudit.getAudits.useQuery({
    property: "Hacjenda",
    from: windowStart,
    to: windowEnd,
  }, { enabled: activeTab === "auditor" && (!user?.propertyAccess || user.propertyAccess === "Hacjenda") });

  const triggerAuditMutation = trpc.pricingAudit.trigger.useMutation({
    onSuccess: () => toast.success("Audit worker started in background"),
    onError: (err) => toast.error(err.message),
  });

  const triggerManualMutation = trpc.pricingAudit.triggerManual.useMutation({
    onSuccess: () => toast.success("Manual audit started in background"),
    onError: (err) => toast.error(err.message),
  });

  const handleAuditClick = (property: "Sadoles" | "Hacjenda", date: Date) => {
    console.log("Audit click triggered for", property, date);
    setManualProperty(property);
    setManualCheckIn(date);
    setManualCheckOut(addDays(date, 3));
    setManualAuditOpen(true);
  };

  const isDataLoading = activeTab === "plans" ? (isLoadingS || isLoadingH) : (isLoadingAuditS || isLoadingAuditH);

  const showSadoles = !user?.propertyAccess || user.propertyAccess === "Sadoles";
  const showHacjenda = !user?.propertyAccess || user.propertyAccess === "Hacjenda";

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold tracking-tight">Pricing Management</h1>
            <div className="flex items-center bg-muted rounded-lg p-1">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMonth(subMonths(month, 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="px-3 text-sm font-semibold min-w-[120px] text-center">
                {format(month, "MMMM yyyy")}
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMonth(addMonths(month, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Tabs defaultValue="plans" value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="w-[300px] grid grid-cols-2">
                <TabsTrigger value="plans" className="flex items-center gap-2">
                  <Tag className="h-3.5 w-3.5" />
                  Pricing Plans
                </TabsTrigger>
                <TabsTrigger value="auditor" className="flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Auditor
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="outline" size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>
              Today
            </Button>
          </div>
        </div>

        <div className="mb-6 flex items-center justify-between">
          <div>
            {activeTab === "plans" ? <PricingLegend /> : <AuditorLegend />}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setSettingsProperty("Sadoles")}>
              <Settings className="h-3.5 w-3.5" /> Sadoleś Settings
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setSettingsProperty("Hacjenda")}>
              <Settings className="h-3.5 w-3.5" /> Hacjenda Settings
            </Button>
            <Button 
              variant="default" 
              size="sm" 
              className="gap-2" 
              onClick={() => triggerAuditMutation.mutate()}
              disabled={triggerAuditMutation.isPending}
            >
              {triggerAuditMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Run Audit Now
            </Button>
          </div>
        </div>

        {isDataLoading ? (
          <div className="text-center py-20 text-muted-foreground">Loading pricing data…</div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {activeTab === "plans" ? (
              <>
                {showSadoles && (
                  <PropertyPricingCalendar
                    property="Sadoleś"
                    pricing={pricingS}
                    month={month}
                    onSelectPricingPlan={setSelectedPlan}
                  />
                )}
                {showHacjenda && (
                  <PropertyPricingCalendar
                    property="Hacjenda"
                    pricing={pricingH}
                    month={month}
                    onSelectPricingPlan={setSelectedPlan}
                  />
                )}
              </>
            ) : (
              <>
                {showSadoles && (
                  <AuditorCalendar
                    property="Sadoles"
                    audits={auditsS}
                    month={month}
                    onDateClick={(date) => handleAuditClick("Sadoles", date)}
                  />
                )}
                {showHacjenda && (
                  <AuditorCalendar
                    property="Hacjenda"
                    audits={auditsH}
                    month={month}
                    onDateClick={(date) => handleAuditClick("Hacjenda", date)}
                  />
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Pricing plan editor modal */}
      <Dialog open={!!selectedPlan} onOpenChange={(open) => !open && setSelectedPlan(null)}>
        {selectedPlan && (
          <PricingPlanModal
            plan={selectedPlan}
            onClose={() => setSelectedPlan(null)}
            onUpdated={() => {
              refetchS();
              refetchH();
            }}
          />
        )}
      </Dialog>

      {/* Property settings modal */}
      <Dialog open={!!settingsProperty} onOpenChange={(open) => !open && setSettingsProperty(null)}>
        {settingsProperty && (
          <PropertySettingsModal
            property={settingsProperty}
            onClose={() => setSettingsProperty(null)}
          />
        )}
      </Dialog>

      {/* Manual Audit Modal */}
      <ManualAuditModal
        isOpen={manualAuditOpen}
        onClose={() => setManualAuditOpen(false)}
        property={manualProperty}
        checkIn={manualCheckIn}
        checkOut={manualCheckOut}
        onConfirm={(cin, cout) => {
          triggerManualMutation.mutate({
            property: manualProperty,
            checkIn: cin,
            checkOut: cout
          });
        }}
      />
    </DashboardLayout>
  );
}
