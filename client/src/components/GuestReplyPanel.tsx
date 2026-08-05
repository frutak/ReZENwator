import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Send, X, Save, AlertTriangle, Banknote, PawPrint, Inbox, UserSearch } from "lucide-react";
import { format } from "date-fns";

/** Intents that never auto-send; shown so the reason is visible on the card. */
const MONEY_INTENT = "question_payment";

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800",
    sent: "bg-green-100 text-green-800",
    rejected: "bg-gray-100 text-gray-600",
    failed: "bg-red-100 text-red-800",
  };
  return <Badge className={`${styles[status] ?? ""} border-0`}>{status}</Badge>;
}

export function GuestReplyPanel() {
  const utils = trpc.useUtils();
  const { data: rows, isLoading } = trpc.guestReplies.list.useQuery();

  // Edits live here until sent or explicitly saved, keyed by draft id, so
  // switching between cards does not lose work in progress.
  const [edits, setEdits] = useState<Record<number, string>>({});

  const invalidate = () => utils.guestReplies.list.invalidate();

  const approve = trpc.guestReplies.approve.useMutation({
    onSuccess: (r) => {
      invalidate();
      toast.success(r.animalsApplied ? "Wysłane. Liczba zwierząt zaktualizowana." : "Wysłane do gościa.");
    },
    onError: (e) => toast.error(`Nie wysłano: ${e.message}`),
  });

  const reject = trpc.guestReplies.reject.useMutation({
    onSuccess: () => { invalidate(); toast.success("Draft odrzucony."); },
    onError: (e) => toast.error(e.message),
  });

  const saveEdit = trpc.guestReplies.saveEdit.useMutation({
    onSuccess: () => { invalidate(); toast.success("Zapisano zmiany."); },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Ładowanie…</p>;

  const pending = (rows ?? []).filter((r) => r.draft.status === "pending");
  const handled = (rows ?? []).filter((r) => r.draft.status !== "pending");

  if (!rows?.length) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          <Inbox className="mx-auto mb-2 h-6 w-6 opacity-40" />
          Brak wiadomości od gości do odpowiedzi.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">
          Czeka na Ciebie ({pending.length})
        </h3>
        <div className="space-y-4">
          {pending.map(({ draft, booking }) => {
            const body = edits[draft.id] ?? draft.editedBody ?? draft.draftBody ?? "";
            const missing = (draft.missingInfo as string[] | null) ?? [];
            const busy = approve.isPending || reject.isPending || saveEdit.isPending;

            return (
              <Card key={draft.id} className="border-0 shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-base">
                      {booking ? `${booking.property} #${booking.id}` : "Bez rezerwacji"} — {draft.inboundFrom}
                    </CardTitle>
                    <StatusBadge status={draft.status} />
                    {draft.needsHuman === 1 && (
                      <Badge className="border-0 bg-amber-100 text-amber-800">
                        <AlertTriangle className="mr-1 h-3 w-3" /> wymaga Ciebie
                      </Badge>
                    )}
                    {draft.matchMethod === "name" && (
                      <Badge className="border-0 bg-violet-100 text-violet-800">
                        <UserSearch className="mr-1 h-3 w-3" /> dopasowane po nazwisku
                      </Badge>
                    )}
                    {draft.intent === MONEY_INTENT && (
                      <Badge className="border-0 bg-rose-100 text-rose-800">
                        <Banknote className="mr-1 h-3 w-3" /> pieniądze
                      </Badge>
                    )}
                    {draft.proposedAnimalsCount !== null && (
                      <Badge className="border-0 bg-sky-100 text-sky-800">
                        <PawPrint className="mr-1 h-3 w-3" /> zwierzęta → {draft.proposedAnimalsCount}
                      </Badge>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {format(new Date(draft.receivedAt), "dd.MM HH:mm")}
                    </span>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      Wiadomość gościa — {draft.inboundSubject}
                    </p>
                    <div className="whitespace-pre-wrap rounded border-l-2 border-gray-300 bg-gray-50 p-3 text-sm text-gray-700">
                      {draft.inboundBody}
                    </div>
                  </div>

                  {missing.length > 0 && (
                    <div className="rounded bg-amber-50 p-3 text-sm">
                      <p className="font-medium text-amber-900">Model nie miał tych informacji:</p>
                      <ul className="ml-4 list-disc text-amber-800">
                        {missing.map((m, i) => <li key={i}>{m}</li>)}
                      </ul>
                    </div>
                  )}

                  {draft.modelNotes && (
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium">Notatka modelu:</span> {draft.modelNotes}
                    </p>
                  )}

                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      Odpowiedź — {draft.draftSubject}
                    </p>
                    <Textarea
                      value={body}
                      rows={12}
                      onChange={(e) => setEdits((p) => ({ ...p, [draft.id]: e.target.value }))}
                      className="font-sans text-sm"
                    />
                  </div>

                  {draft.errorMessage && (
                    <p className="text-sm text-red-600">{draft.errorMessage}</p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={busy || !body.trim()}
                      onClick={() => approve.mutate({ id: draft.id, body })}
                    >
                      <Send className="mr-1.5 h-3.5 w-3.5" />
                      Wyślij do gościa
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || edits[draft.id] === undefined}
                      onClick={() => saveEdit.mutate({ id: draft.id, body })}
                    >
                      <Save className="mr-1.5 h-3.5 w-3.5" />
                      Zapisz bez wysyłki
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => reject.mutate({ id: draft.id })}
                    >
                      <X className="mr-1.5 h-3.5 w-3.5" />
                      Odrzuć
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {pending.length === 0 && (
            <p className="text-sm text-muted-foreground">Nic nie czeka.</p>
          )}
        </div>
      </div>

      {handled.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-medium text-muted-foreground">Historia</h3>
          <Card className="border-0 shadow-sm">
            <CardContent className="divide-y p-0">
              {handled.map(({ draft, booking }) => (
                <div key={draft.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <StatusBadge status={draft.status} />
                  <span className="text-muted-foreground">
                    {booking ? `${booking.property} #${booking.id}` : "—"}
                  </span>
                  <span className="truncate">{draft.inboundFrom}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {draft.sentAt
                      ? format(new Date(draft.sentAt), "dd.MM HH:mm")
                      : format(new Date(draft.receivedAt), "dd.MM HH:mm")}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
