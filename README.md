# DukeDrop

Mobile-friendly order form for DukeDrop parcel delivery. It calculates service pricing and prepares a Venmo payment handoff to **@Timothymei71**.

## Run

Requires Node.js 18+. Run `npm test`, then `npm start` and open http://localhost:4173.

Before enabling payment, the form requires dorm name, dorm/room number, package size (S/M/L), quantity, tracking number, and carrier. The Venmo deep link uses Venmo's documented `venmo://paycharge?txn=pay&recipients=...&amount=...&note=...` convention; a browser link and manual-account fallback are shown in the handoff message.

Payment is not completed by DukeDrop: the user must review and submit it in Venmo. Orders cannot be tracked inside this app, and no order/payment completion is claimed.
