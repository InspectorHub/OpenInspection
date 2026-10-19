# Booking slots, and the race between two bookers

How the public booking page decides what to offer, and what happens when two people take the same time at once.

## How a booking is stored

An inspection keeps its start in `inspections.date`, a wall-clock ISO string in the company's own time (`2027-03-09T09:00:00Z`; the `Z` is a storage convention, not UTC). Once the booking is accepted the row also carries `duration_min` and the precise instants `scheduled_start_ms` / `scheduled_end_ms`. Older rows, and rows created by hand, may have no duration. Who works an inspection is in `inspection_inspectors` (a lead and any helpers); that table has no time on it.

## What the page offers, and the length of a booking

A booking occupies the inspector for a **window**: the booked services' total minutes when they carry durations, otherwise the window the customer picked (540 for all-day, 240 for morning or afternoon, 180 for anything else, which is also what the page assumes before a window is chosen). One function (`bookingWindowMin`) gives that length to the slot grid, to admission and to the stored row, so the three cannot disagree.

For each qualified inspector the page takes the weekly hours, then judges every candidate start over `[start, start + window)` against: a manual blocking override for the day (only starts inside its extra hours survive), calendar blocks, busy events synced from a connected calendar, and existing inspections. An existing inspection that **records a duration** removes every candidate whose window overlaps its own; one that ends exactly when a window starts leaves it free. An inspection with **no recorded duration** removes only the candidate that starts at the same time, as before.

**What customers see.** Because the whole window must fit, the page offers fewer starts around existing inspections and time off than it used to: a 3-hour booking next to a recorded 11:00-13:00 inspection is no longer offered 09:30 or 10:00, where before only 11:00 was taken. Longer services lose more starts than shorter ones. The weekly hours are still judged by the start alone, as before.

## Two bookers at once

Reading the slots and inserting the booking are not atomic and D1 has no row locks, so two submissions can both pass the check. The booking resolves it after the insert and before anything is sent:

- The row is written WITH its duration and instants in the insert itself (never stamped afterwards), so no row is ever visible to a racer without them.
- Each booker looks at the same inspector's non-cancelled inspections that day. Two collide when both carry a duration and their windows overlap (back-to-back is fine), or when at least one has no duration and they start at the same minute. The sibling inspections of one multi-service booking never collide with each other.
- The earliest `(created_at, id)` wins. The other deletes its own rows, gives the inspection allowance back, and answers 409 "That time slot is no longer available".
- A winner is then checked once more against time off added since the page was read (a calendar block, a manual blocking override whose extra hours do not include its start, or an overlapping busy event from a connected calendar). If one now covers the booking it is retracted the same way.

Because the grid and the arbitration judge over the same window, a start the page offers is a start the arbitration accepts; a 409 now means someone really did take the time.

## Why there is no unique index

A database index cannot express "this inspector, this window, once". The sibling inspections of a multi-service booking share an inspector and a start time on purpose, the link table has no time, and a window is a range, which a unique index cannot compare. The arbitration above is the guard; it does not need a migration.

## Checking a database for existing double bookings

Read-only; it groups by inspector and start and ignores siblings of one booking:

```sql
SELECT ii.user_id, i.date, COUNT(*) AS inspections,
       COUNT(DISTINCT COALESCE(i.request_id, i.id)) AS bookings, GROUP_CONCAT(i.id) AS ids
FROM inspection_inspectors ii
JOIN inspections i ON i.id = ii.inspection_id
WHERE i.status <> 'cancelled' AND length(i.date) >= 16
GROUP BY ii.user_id, i.date
HAVING COUNT(DISTINCT COALESCE(i.request_id, i.id)) > 1
ORDER BY bookings DESC;
```
