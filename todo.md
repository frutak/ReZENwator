# Rental Manager - TODO

## Database
- [x] PostgreSQL schema: bookings table with all fields
- [x] Drizzle migration generated and applied
- [x] DB query helpers in server/db.ts

## iCal Polling Service
- [x] iCal parser utility (node-ical)
- [x] Polling logic for all 7 iCal feeds (4 for Sadoleś, 3 for Hacjenda)
- [x] Deduplication logic (uid-based)
- [x] Channel detection from iCal SUMMARY/DESCRIPTION
- [x] Background worker script (server/workers/icalPoller.ts)
- [x] tRPC procedure to trigger manual sync

## Email Parsing Service
- [x] Gmail IMAP connection (imap / mailparser)
- [x] Slowhop email parser (Polish, extract guest name/phone/email/dates/price)
- [x] Airbnb email parser (extract guest name/dates/guests/price/revenue)
- [x] Nestbank bank email parser (extract amount/sender/title)
- [x] Fuzzy matching: bank transfer → booking (by guest name + date)
- [x] Background worker script (server/workers/emailPoller.ts)
- [x] tRPC procedure to trigger manual email check

## Booking Status Logic
- [x] Status flow: pending → confirmed → paid → finished
- [x] Auto-finish bookings past checkout date
- [x] Deposit status: pending/paid/returned/not_applicable
- [x] Airbnb/Booking.com auto-set deposit_status = not_applicable

## tRPC API
- [x] bookings.list (with filters: property, channel, status, dateRange)
- [x] bookings.get (single booking detail)
- [x] bookings.updateStatus (manual override)
- [x] bookings.updateDeposit (manual deposit status change)
- [x] bookings.matchTransfer (manual bank match)
- [x] sync.triggerIcal (manual iCal sync)
- [x] sync.triggerEmail (manual email check)
- [x] sync.getLastRun (last sync timestamps)

## Frontend Dashboard
- [x] DashboardLayout with sidebar navigation
- [x] Bookings list page with filters (property, channel, status, date)
- [x] Booking detail/edit modal
- [x] Status badge component (color-coded)
- [x] Deposit status badge component
- [x] Stats summary cards (total bookings, revenue, upcoming)
- [x] Manual sync buttons
- [x] Sync Status page with logs and feed list

## Deployment
- [x] systemd service configuration in DEPLOYMENT.md
- [x] Environment variable configuration via webdev_request_secrets
- [x] Deployment README for Ubuntu 24.04 (DEPLOYMENT.md)
- [x] Cron job alternative configuration
- [x] Background scheduler (node-cron, 30 min intervals)

## Tests
- [x] Slowhop email parser tests (8 tests)
- [x] Airbnb email parser tests (7 tests)
- [x] Nestbank bank email parser tests (5 tests)
- [x] Email source detection tests (5 tests)
- [x] parseEmail dispatcher tests (2 tests)
- [x] Auth logout test (existing)

## Fixes
- [x] iCal poller: ignore blocks with check-in more than 363 days from today
- [x] Fix: Invalid URL crash on self-hosted deployment (missing VITE_OAUTH_PORTAL_URL)
- [x] Remove auth gate from dashboard (no login required for self-hosted use)
- [x] Fix: booking detail modal has transparent background, make it solid
- [x] Sortable column headers in bookings table, default sort by check-in ascending
- [x] Fix: transparency on all dropdowns, selects, popovers, dialogs - make all solid
- [x] Add calendar view page with per-property monthly calendar
- [ ] Fix: duplicate bookings from same property/dates imported from multiple iCal feeds
- [ ] Add double-booking detection with email alert and UI warning banner
- [ ] Filter out Airbnb 1-day preparation blocker (today → tomorrow, 1-night blocks)
