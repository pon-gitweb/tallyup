# TallyUp

Expo + React Native + Firebase MVP

## Current MVP Features (branch: mvp-stocktake-flow)

- **Auth**
  - Login, Register, Dev Login (pinned test@example.com)
- **Dashboard**
  - Shows CTA depending on department/area state
  - Live badges (Not Started, In Progress, Completed)
- **Stock Take Flow**
  - Departments → Areas → Inventory screen
  - Input modes: numeric, long-press keypad, Bluetooth scale stub, Photo count stub
  - Submit guard (warns if blanks, auto-saves 0)
  - Finalization flow with timestamp + 24h warning
- **Setup Wizard**
  - Always available from Dashboard & Settings
- **Settings**
  - Account info (email, uid, venue)
  - Reset stock take cycle
  - Manage Suppliers
  - Manage Products (with par levels, cost, default supplier)
  - Suggested Orders (per supplier, based on par levels)
  - Dev utilities (attach dev venue once)
  - Sign Out
- **Suppliers**
  - CRUD: name, email, phone
- **Products**
  - CRUD: name, SKU, unit, par level, pack size, cost, default supplier
- **Suggested Orders**
  - Groups products by supplier
  - Suggests qty = parLevel − onHand (MVP assumes onHand=0)
  - Draft order creation in Firestore
  - Submit orders
  - Email order stub (mailto link)
- **Reports**
  - Last Cycle Summary screen
  - Variance / Movers / Waste / Supplier Performance = stubs

## Dev Testing

For quick access during development:

- **Dev User**
  - Email: `test@example.com`
  - Password: `test1234`
  - UID: `4aYhmfXgiOg22CUQts50sHMTabD3`
- **Dev Venue**
  - venueId: `v_7ykrc92wuw58gbrgyicr7e`
  - Membership role: `staff` (or `owner` if changed in tests)
- This account auto-attaches to the dev venue when using **Dev Login** from the login screen.

## Next Steps
- Wire real on-hand counts into Suggested Orders
- Extend reports (variance, profitability, shrinkage)
- Polish UI/UX
- Optional pre-start guard for Expo

