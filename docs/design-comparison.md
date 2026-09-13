# Pickup vs Returns comparison (authoritative artifact)

Compared `DukeDrop.dc.html` in full (template, `Component.CONFIG`, state, VM, validation, memo/consent/payment services) to the pre-change `main` UI.

| Behavior | Pickup | Returns | Restored in app |
|---|---|---|---|
| Intro/rates | “We grab it…”; parcels per trip; $3.99/$2.99/$1.99 | “Leave it at your door…”; parcels per trip; $4.99/$3.99/$2.99 | Yes: service-specific intro, rate header and rows |
| Quantity/pricing | 1–50, tier rate × quantity | 1–50, tier rate × quantity | Existing calculation retained and rendered per service |
| Destination fields | Dorm, room, Amazon tracking; mailroom/locker toggle with conditional building + box/code; full name for mailroom | Dorm, room, Amazon tracking only; door drop | Existing conditional validation retained |
| Consent | Mailroom: name-based consent text and send/copy before Step 2 payment; locker skips consent | No consent step; payment note is authorization | Pickup-only consent remains; Returns has no source/consent inputs |
| Memo/payment | `PICKUP`, location/source and name details; Venmo/Zelle/Card | `RETURN`, tracking and dorm/room; Venmo/Zelle/Card | Service-specific memo and independent totals retained |
| Zelle | 469-964-9545 and copyable natural-space note | Same number and copyable natural-space note | Preserved |

The generic merged form lacked the artifact’s service-specific copy, rate presentation, and consent callout; these are now explicitly rendered from `SERVICE_DETAILS`.