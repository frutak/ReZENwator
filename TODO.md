# TODO

Decisions worth taking deliberately, not fixes waiting to be applied. Each one
works acceptably as it stands; what is written down is the reason it might be
worth changing, and what it would cost.

## To consider

### Backfill historical manual payments as transfers

Since 2026-08-13 a payment recorded by hand creates a row in `bank_transfers`,
which is what put hand-entered money into the cashflow view for the first time
— that view reads `bank_transfers`, not `bookings`.

Payments entered by hand *before* that date still have no row, so they remain
invisible there. The consequence is a seam in the series: months before and
after today are not counted the same way.

Two honest options, and the choice is an accounting one:

- **Leave it.** Cashflow is already reported only from `CASHFLOW_START_MONTH`
  (2026-05) because transfers were not recorded before 2026-04-30. Moving the
  start forward, or noting the seam, keeps the data untouched.
- **Backfill.** Write the missing payments in as transfers with `source:
  "manual"`, dated when the money actually arrived. Makes the series uniform,
  but the amounts would have to come from bank statements — the bookings only
  record totals, not when each part landed.

Booking #77 is the example that surfaced this: its payment was recorded by hand,
so nothing backed the balance, and the real Airbnb payout drifted onto a
neighbouring stay.

### Undoing a split payout

A payout covering several bookings is recorded by splitting it: the parent
transfer becomes `split` and a child row carries each booking's share
(`transfers.matchSplit`). There is no way back. Nothing un-splits a transfer —
the parent appears in neither the pending nor the matched list, so the screen
offers no handle on it, and `manualMatch` refuses it outright rather than
crediting one booking the full amount while the children still credit their
shares.

That is the safe behaviour, not the complete one. Confirming a split against
the wrong bookings currently needs a guarded script: revert each child with
`revertTransferMatch`, delete the children, put the parent back to `pending`.

Why it has not been built: the proposal is only ever offered when the parts add
up to the payout exactly, in one unambiguous way, in the property the transfer
names — the search refuses to guess rather than presenting a coin flip. So a
wrong split needs the owner to confirm an arithmetically exact coincidence.
Worth building if that ever happens, or alongside anything else that needs to
walk `parentTransferId`; not worth speculative UI before then.

### Read the guest/portal split from tagged transfers

`calculateAmountsDue` splits what is still owed between the guest and the portal
by reading the booking's status: it treats `paid`/`finished` as "the guest has
settled". That is true today because the matcher sets `paid` exactly when the
guest's balance lands — but it is an inference, and a change to the status rules
would quietly move the figures quoted to guests.

Since 2026-08-13 every transfer records who sent it (`bank_transfers.source`),
so the split could be read off the transfers themselves instead of being derived.

What it costs: `calculateAmountsDue` is a pure function over a booking row,
called from the client as well as the server. Reading transfers means either
passing their sums in, or turning it into something that queries — and the
client would need those sums delivered with the booking. Worth doing when
something else already requires that shape; not worth a refactor on its own
while the inference holds.

The reconciliation check added the same day is the safety net in the meantime:
if the two ledgers ever disagree, the daily report says so.
