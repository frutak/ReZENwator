import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import { ArrowRight, Search, CheckCircle2, XCircle, AlertCircle, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";
import { getGuestName } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export default function TransferMatching() {
  const { t } = useLanguage();
  const utils = trpc.useUtils();
  const [selectedTransfer, setSelectedTransfer] = useState<any>(null);
  const [matchingOpen, setMatchingOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: transfers = [], isLoading: loadingTransfers } = trpc.transfers.listPending.useQuery();
  const { data: matchedTransfers = [], isLoading: loadingMatched } = trpc.transfers.listMatched.useQuery();
  
  const { data: matches = [], isLoading: loadingMatches } = trpc.transfers.getMatches.useQuery(
    { transferId: selectedTransfer?.id },
    { enabled: !!selectedTransfer }
  );

  const manualMatch = trpc.transfers.manualMatch.useMutation({
    onSuccess: () => {
      toast.success(t("transfers.success_match"));
      setMatchingOpen(false);
      setSelectedTransfer(null);
      utils.transfers.listPending.invalidate();
      utils.transfers.listMatched.invalidate();
      utils.bookings.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const markIrrelevant = trpc.transfers.markIrrelevant.useMutation({
    onSuccess: () => {
      toast.success(t("transfers.success_ignore"));
      utils.transfers.listPending.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const filteredMatches = matches.filter(m => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const guestName = getGuestName(m.booking as any).toLowerCase();
    return guestName.includes(q) || m.booking.property.toLowerCase().includes(q);
  });

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 max-w-7xl mx-auto">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{t("transfers.title")}</h1>
            <p className="text-muted-foreground mt-1">
              {t("transfers.subtitle")}
            </p>
          </div>
        </header>

        <Tabs defaultValue="pending" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="pending" className="gap-2">
              <AlertCircle className="h-4 w-4" />
              {t("transfers.pending")}
              {transfers.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 w-5 p-0 flex items-center justify-center rounded-full bg-amber-100 text-amber-700">
                  {transfers.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="matched" className="gap-2">
              <CheckCircle2 className="h-4 w-4" />
              {t("transfers.matched")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending">
            <Card className="border shadow-sm overflow-hidden">
              <CardContent className="p-0">
                {transfers.length === 0 ? (
                  <div className="p-12 text-center text-muted-foreground">
                    <div className="mb-2 flex justify-center"><CheckCircle2 className="h-8 w-8 text-green-500/50" /></div>
                    {t("transfers.no_pending")}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50 uppercase text-[10px] font-bold tracking-wider">
                        <TableHead className="px-6">{t("transfers.date")}</TableHead>
                        <TableHead className="px-6">{t("transfers.sender")}</TableHead>
                        <TableHead className="px-6">{t("transfers.title_column")}</TableHead>
                        <TableHead className="px-6">{t("transfers.amount")}</TableHead>
                        <TableHead className="px-6 text-right"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transfers.map((transfer) => (
                        <TableRow key={transfer.id} className="hover:bg-muted/20 transition-colors">
                          <TableCell className="px-6 font-medium whitespace-nowrap">
                            {format(new Date(transfer.transferDate), "dd.MM.yyyy")}
                          </TableCell>
                          <TableCell className="px-6 truncate max-w-[200px]" title={transfer.senderName}>
                            {transfer.senderName}
                          </TableCell>
                          <TableCell className="px-6 truncate max-w-[300px]" title={transfer.transferTitle}>
                            {transfer.transferTitle}
                          </TableCell>
                          <TableCell className="px-6 font-bold text-primary whitespace-nowrap">
                            {parseFloat(transfer.amount).toLocaleString("pl-PL")} {transfer.currency}
                          </TableCell>
                          <TableCell className="px-6 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 gap-2"
                                onClick={() => {
                                  setSelectedTransfer(transfer);
                                  setMatchingOpen(true);
                                  setSearchQuery("");
                                }}
                              >
                                <Search className="h-3.5 w-3.5" />
                                {t("transfers.find_matches")}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 text-muted-foreground hover:text-destructive"
                                onClick={() => markIrrelevant.mutate({ transferId: transfer.id })}
                              >
                                <XCircle className="h-3.5 w-3.5" />
                                {t("transfers.ignore")}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="matched">
            <Card className="border shadow-sm overflow-hidden">
              <CardContent className="p-0">
                {matchedTransfers.length === 0 ? (
                  <div className="p-12 text-center text-muted-foreground">
                    {t("transfers.no_matched")}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50 uppercase text-[10px] font-bold tracking-wider">
                        <TableHead className="px-6">{t("transfers.date")}</TableHead>
                        <TableHead className="px-6">{t("transfers.sender")}</TableHead>
                        <TableHead className="px-6">{t("transfers.amount")}</TableHead>
                        <TableHead className="px-6">{t("transfers.booking")}</TableHead>
                        <TableHead className="px-6 text-right"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {matchedTransfers.map(({ transfer, booking }) => (
                        <TableRow key={transfer.id} className="hover:bg-muted/20 transition-colors">
                          <TableCell className="px-6 font-medium whitespace-nowrap">
                            {format(new Date(transfer.transferDate), "dd.MM.yyyy")}
                          </TableCell>
                          <TableCell className="px-6 truncate max-w-[200px]" title={transfer.senderName}>
                            {transfer.senderName}
                          </TableCell>
                          <TableCell className="px-6 font-bold text-primary whitespace-nowrap">
                            {parseFloat(transfer.amount).toLocaleString("pl-PL")} {transfer.currency}
                          </TableCell>
                          <TableCell className="px-6">
                            {booking ? (
                              <div className="flex flex-col">
                                <span className="font-semibold text-sm">{getGuestName(booking as any)}</span>
                                <span className="text-xs text-muted-foreground">{booking.property} • {format(new Date(booking.checkIn), "dd.MM.yyyy")}</span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground italic text-xs">Deleted booking</span>
                            )}
                          </TableCell>
                          <TableCell className="px-6 text-right">
                             <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 gap-1.5 py-1 px-3">
                               <CheckCircle2 className="h-3 w-3" />
                               Matched
                             </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={matchingOpen} onOpenChange={setMatchingOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t("transfers.matching_for")}</DialogTitle>
              <DialogDescription>
                <div className="mt-2 p-3 bg-muted/50 rounded-lg flex flex-wrap gap-x-6 gap-y-2 text-foreground font-medium">
                  <div><span className="text-muted-foreground font-normal">{t("transfers.sender")}:</span> {selectedTransfer?.senderName}</div>
                  <div><span className="text-muted-foreground font-normal">{t("transfers.amount")}:</span> {selectedTransfer ? parseFloat(selectedTransfer.amount).toLocaleString("pl-PL") : ""} {selectedTransfer?.currency}</div>
                  <div><span className="text-muted-foreground font-normal">{t("transfers.date")}:</span> {selectedTransfer ? format(new Date(selectedTransfer.transferDate), "dd.MM.yyyy") : ""}</div>
                </div>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("dashboard.new_booking") + "..."}
                  className="pl-10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground px-1">{t("transfers.close_matches")}</h3>
                {loadingMatches ? (
                  <div className="py-8 text-center animate-pulse text-muted-foreground">
                    {t("common.loading")}
                  </div>
                ) : filteredMatches.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground border rounded-lg bg-muted/20">
                    {t("transfers.no_matches")}
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {filteredMatches.map((match) => (
                      <div
                        key={match.bookingId}
                        className="flex items-center justify-between p-4 border rounded-xl hover:border-primary/50 hover:bg-primary/5 transition-all group"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-lg">{getGuestName(match.booking as any)}</span>
                            <Badge variant="secondary" className="bg-primary/10 text-primary border-0">
                              {match.booking.property}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                            <span>{format(new Date(match.booking.checkIn), "dd.MM.yyyy")} — {format(new Date(match.booking.checkOut), "dd.MM.yyyy")}</span>
                            <span>{match.booking.channel}</span>
                            <span className="font-semibold text-foreground">
                              {parseFloat(match.booking.totalPrice || "0").toLocaleString("pl-PL")} PLN
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <div className="text-xs text-muted-foreground mb-1">{t("transfers.score")}</div>
                            <Badge className={match.score > 70 ? "bg-green-500" : match.score > 40 ? "bg-amber-500" : "bg-slate-500"}>
                              {match.score}%
                            </Badge>
                          </div>
                          <Button
                            size="sm"
                            className="gap-2"
                            disabled={manualMatch.isPending}
                            onClick={() => manualMatch.mutate({
                              transferId: selectedTransfer.id,
                              bookingId: match.bookingId
                            })}
                          >
                            <ArrowRight className="h-4 w-4" />
                            {t("transfers.select")}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
