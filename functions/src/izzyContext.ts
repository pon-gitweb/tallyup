/**
 * izzyContext.ts — single source of truth for what Izzy knows about the app.
 * Update this file whenever features are added or removed.
 */

export const IZZY_FEATURES = {

  available: `
FEATURES AVAILABLE RIGHT NOW:

STOCKTAKE
- Create departments and areas
- Add products to areas
- Count stock by tapping a number or using steppers
- Counting products:
  - Enter any decimal for partial items (0.5 = half, 0.75 = three quarters)
  - Cases: use the case counter plus loose units separately
  - Kegs: use the fraction selector (Full, 3/4, 1/2, 1/4, Nearly empty) or enter a percentage directly
  - Weight items: enter the weight in your chosen unit (kg, g, L, mL)
  - The system calculates values automatically from whatever number you enter
- Submit completed areas
- Multi-user counting (different staff count different areas simultaneously)
- View incomplete counts before submitting
- Reset stocktake cycle (manager/owner only, in Settings)

ORDERS
- Create a new order to a supplier
- Add products and quantities to an order
- Submit an order to a supplier
- Fast Receive — scan a delivery invoice to receive stock directly
- View submitted and draft orders

SUPPLIERS
- Add a supplier manually
- Add a supplier from the Hosti Directory (13 major NZ suppliers pre-loaded)
- Scan an invoice photo to create a supplier automatically
- Upload a PDF or CSV invoice to identify the supplier
- Photograph a business card to add supplier contact details
- View and edit supplier details
- Account number saved per supplier

PRODUCTS
- Add a product manually
- Photograph the front and back of a bottle (identifies one product, captures barcode)
- Photograph a shelf section to identify multiple products
- Import products from a supplier catalogue
- Import products from a CSV or PDF stocktake sheet (up to 40 pages)
- Search venue products to add to a stocktake area
- Browse and add from the Hosti Starter Catalogue

REPORTS
- Stock Holding Report after first stocktake
  (counts and value by category or A-Z, PDF export, CSV export)
- Variance report from the second stocktake onwards
- AI Insights button in the Reports screen (tap to analyse the current stocktake)
- Ask Suitee questions about your venue data (manager/owner only, in Reports)
- Slow moving stock alerts
- Price change alerts when invoice prices differ from previous orders

INVOICES
- Scan an invoice photo — reads supplier name, products, PO number, and prices
- Upload a PDF or CSV invoice
- Duplicate invoice detection
- Historical invoice handling — invoices older than 90 days are captured for reference without affecting current stock
- Purchase order auto-matching (links scanned invoice to an open order)

TEAM
- Invite team members by email
- Assign roles: owner, manager, or staff
- Role-based access throughout the app

SETTINGS
- Edit your display name
- Edit venue name (owner only)
- Invite team members
- Reset stocktake cycle (manager/owner only)
- Delete account

BARCODE SCANNER
- Tap 📷 Scan in the stocktake area header to open the barcode camera
- Point camera at any barcode on a bottle or product
- If found in your venue or Hosti catalogue it appears instantly
- If it's a new product, photograph front and back to add it
- Every scan helps build the NZ hospitality product catalogue

BLUETOOTH SCALES
- Long press any product during stocktake to connect a Bluetooth scale
- Supported models are shown in the scale settings screen (Settings → Bluetooth Scale)
- Once connected the scale weight is read automatically

VOICE COUNTING (hands-free mode)
- Tap the 🎤 microphone button at the top of the stocktake area screen to start voice mode
- Say a product name — the app finds it in your list automatically
- Then say the count — say "twenty four", "one hundred", "1.5", or "half"
- Say "done" or tap the mic button again to stop voice mode at any time
- Normal counting with steppers and number inputs works alongside voice mode — switch freely
- If a product has multiple matches say "one", "two", or "three" to select
- If a product is not found say "skip" to move on
- Works with AirPods and Bluetooth earphones automatically — no setup needed
- Best in quieter environments (walk-in chiller, prep area, pre-service) — for noisy service use steppers

Voice counting commands:
 Say a product name then a number to count: "Heineken, 24"

 Correction commands:
 "undo" — removes the last count
 "actually [number]" — corrects it, e.g. "actually 22"
 "correction [number]" — same as above
 "change that to [number]" — same

 Navigation commands:
 "skip" or "next" — skips current item
 "recount [product]" — finds a product, e.g. "recount Heineken"
 "go to [product]" — same as recount

 Playback commands:
 "repeat" — reads back last counted item
 "what did I say" — same as repeat

 Skipped items are shown before you submit so nothing gets missed.

STOCKTAKE TIMING:
- The app tracks active counting time separately from total elapsed time
- A break is detected when there is more than 3 minutes of inactivity between counts
- The stocktake duration shown on the summary screen is active counting time only — breaks are excluded
- The summary shows how many breaks occurred and how many minutes were excluded
- Example: "23 min active counting · 2 breaks (8 min) not included" means the counter was active for 23 minutes, took 2 breaks totalling 8 minutes, and the full elapsed time was 31 minutes
- This is intentional — it gives a fair measure of counting speed without penalising staff for legitimate pauses (phone calls, serving customers, moving between areas)
- If a user asks why their time looks short: the displayed time is active counting only, breaks are shown separately
- If a user asks how to improve their Labour Efficiency KPI: count without stopping, minimise breaks between products, count one area at a time without interruption

SETUP WIZARD
- New users see a 3-step introduction to stocktaking on first login
- Explains what a stocktake is, how the flow works, and how to add products
- Only shown once — never appears again after you've been through it

BATCH PRICE ENTRY
- Add cost prices to multiple products at once from the Reports screen
- The "Add prices for dollar variance" card in Reports links directly to it
- Enter prices inline without leaving the screen
- Save all prices in one tap

RECIPE COSTS (CraftIt)
- Recipes linked to venue products show live cost prices
- COGS updates automatically when invoice prices change
- Ingredients show whether their cost is live (linked to a product) or manual
- Add prices directly from the recipe if a linked product has no price set

IZZY
- Ask Izzy anything about how to use the app
- Available on every screen via the ✦ button in the header

SUITEE (manager/owner only)
- Ask Suitee questions about your venue data — variance, stock, recipes, suppliers, performance score, and more
- Available in the Reports screen on mobile (tap the chat icon)
- Also available on the Hosti web dashboard at app.hosti.co.nz — better for longer analysis sessions at a desk

HOSTI WEB DASHBOARD:
- Access your full venue data on any computer browser — no download needed
- Log in at app.hosti.co.nz with your existing Hosti email and password
- Same data as your mobile app — updated in real time
- Best for: reviewing reports, analysing variance trends, managing products and suppliers, inviting team members
- Available sections: Hosti Health score and charts, Reports with variance tables, Orders overview, CraftIt recipe GP analysis, Ask Suitee (full conversation), Products (bulk edit, CSV import/export), Suppliers, Import (drag-and-drop CSV for opening stock, sales data, invoices, catalogues), Team management, Account settings
- Import page: drag your stocktake CSV, sales reports, supplier invoices, or price lists from your computer — much easier than uploading from a phone
- What stays on mobile: stocktake counting (voice, barcode, camera), invoice scanning via camera, real-time stockout alerts, festival operations during an event
- If a user asks whether they can see reports or data on a bigger screen: yes — direct them to app.hosti.co.nz

PERFORMANCE SCREEN (HOSTI HEALTH):
- View your venue's Hosti Health score (0–100) from the dashboard — tap "View Performance"
- The score is made up of five KPIs: Stock Accuracy, Labour Efficiency, Inventory Health, Ordering Intelligence, and Waste Control
- Labour Efficiency specifically measures: how long the stocktake takes vs the venue's set baseline (configured in Settings → hourly rate and stocktake baseline)
- The time used for Labour Efficiency is active counting time — breaks over 3 minutes are automatically excluded from the calculation
- A faster stocktake relative to baseline = higher Labour Efficiency score
- To improve Labour Efficiency: count more efficiently, reduce breaks between product counts, use voice counting to speed up entry
- Stage 1 (no stocktakes): shows a building baseline checklist
- Stage 2 (1 stocktake): shows an estimated score range
- Stage 3 (2+ stocktakes): shows your full confirmed score with trend and financial impact
- Each KPI card is tappable — shows exactly how the score is calculated
- The Focus List shows the top 3 products driving your variance (your biggest opportunities)
- Insights show what the data most likely means (e.g. "concentrated variance — possible overpouring")
- Stock Predictions show which products are at risk of running out and when
- Configure your hourly rate and target Days of Cover in Settings → My Venue

AI COUNT AND BOTTLE ESTIMATION:
- Long press any count field during a stocktake to trigger AI bottle-level estimation
- Point camera at a spirit bottle — AI estimates what percentage full it is (e.g. 65%)
- The estimated fill level pre-fills the count field — you can adjust before saving
- The toolbar "AI Count" button opens a count assistant for the active item
- Shelf photo counting: take a photo of a shelf and AI counts the units visible

INVOICE SCANNING:
- Photograph or upload a supplier invoice to scan it automatically
- The app extracts supplier details, products, quantities, prices, and PO numbers
- Products on the invoice are matched to your existing products and stock is updated
- Unmatched products are surfaced with an "Add to products" button
- Duplicate invoices are detected automatically
- If no matching order exists, a retrospective order is created automatically

SUGGESTED ORDERS:
- After a stocktake, go to Orders → Suggested Orders to see what needs reordering
- Orders are grouped by supplier with quantities based on your velocity and PAR levels
- Each line shows a confidence badge (High/Medium/Low) based on how much data exists
- Low confidence = fewer stocktakes completed, treat suggestions as a starting point
- High confidence = 6+ stocktakes, suggestions are based on reliable velocity patterns
- Long press a product's count field to see its stockout prediction
`,

  planned: `
FEATURES PLANNED FOR FUTURE UPDATES:
- Waste Control tracking (log wastage by product and reason — coming soon)
- POS integrations (Square, Wizbang, Bepoz — connection screens visible in Settings, activation in progress)
- Desktop onboarding experience — guided tour for new web dashboard users (coming soon)
- CraftIt recipe editing on desktop — create and edit recipes with a keyboard (coming soon)
- Accounting integrations (Xero, MYOB — connection screens visible in Settings, activation in progress)
- Gamification and staff performance tracking
- Supplier scorecards
- Multi-venue management
- Predictive ordering
- Weekly summary email
- Unit labels next to count fields — planned for kitchen and weight-based products in a future update
`,

  unavailable: `
IF ASKED ABOUT ANYTHING NOT IN THE ABOVE LISTS:
Respond that the feature is not currently available and suggest contacting support at office@hosti.co.nz.
`,
};

export const COUNTING_GUIDANCE = `
PRACTICAL COUNTING GUIDANCE:

Partial bottles:
Enter a decimal — 0.5 for half, 0.75 for three quarters, 0.25 for a quarter.
The system knows the bottle size and calculates the value automatically.
You never need to convert to mL or L.

Kegs:
Use the fraction selector buttons (Full / 3/4 / 1/2 / 1/4 / Nearly empty)
or type a percentage like 50 for half full.
The system handles the rest.

Weight products (flour, oil, proteins):
Enter the weight in kg — for example 12.5 for a half-open 25kg bag.
If you're estimating that's fine — use your best judgement.

Barcodes:
The barcode is on the back or bottom of the packaging — the number underneath
the black and white stripes.
It's usually 8 to 13 digits long.
You can leave it blank and add it later by scanning the product.

Using the Bluetooth scale:
Long press the product in your stocktake area.
Tap 'Weigh this bottle'.
Place the bottle on the scale.
The count is calculated automatically.

Units:
The unit shown next to the count field tells you what you're counting in.
You can change the counting unit for any product by long pressing it in the area.

Counting a case with loose bottles:
Use 'Both' counting mode — enter full cases in the left box and loose bottles
in the right box.
The total is calculated automatically.

If a product ran out:
Enter 0. The system records it as empty and flags it for reorder if below PAR.
`;

export const SUITEE_COUNTING_NOTE = `
If a user asks Suitee how to count something (partial bottles, kegs, weight items,
barcodes, scales), direct them to Izzy for step-by-step guidance:
"For counting how-to questions, Izzy is your best bet — tap the ✦ button in the
header and ask her directly."
`;

export const FESTIVAL_IZZY_FEATURES = `
FESTIVAL MODE FEATURES:

HOW FESTIVAL STOCK IS ORGANISED:
- HQ / Central Store: the central receiving and storage hub for the entire event.
  Stock is received at HQ first, then distributed to individual bars.
  HQ has one or more named storage locations (e.g. "Main walkway", "Walk-in chiller").
- Bars: individual serving bars at the event (e.g. "Bar 1", "Garden Bar").
  Each bar has a "back of house" storage area where distributed stock lands.
- The flow is: Goods In → HQ storage location → Goods In distribute → Bar back of house
- Session counts are done per bar — staff count the bar's back-of-house stock.
- Top-up requests are raised by bar staff when they need more stock from HQ.
- Transfers move stock between bars (bar-to-bar) without going through HQ.

SESSION COUNTS:
- A session count is a stock count for a specific bar's back-of-house area.
  It uses the same counting screen as a regular venue stocktake.
- When a bar starts a session count, it opens the bar's "back of house" area.
- Session counts record how much stock is physically present at the bar.
- Staff can do a session count at start-of-shift, mid-session, or end-of-session.
- The count creates a snapshot of bar stock at that point in time.
- You can count from FestivalBarDashboard → "Count now" button.

TOP-UP REQUESTS:
- Raised by bar staff to request more stock from HQ.
- A request contains: which products, how many, urgency (ASAP / next round / planning).
- Ops team sees all pending requests in the Delivery Tasks screen.
- An ops runner accepts the task, collects stock from HQ, and marks it delivered.
- When marked delivered, bar stock is automatically updated.

GOODS IN (receiving stock at HQ):
- Stock arrives at a named HQ storage location (e.g. "Main walkway").
- Record received quantities in the Goods In screen.
- Then distribute: allocate stock from that location to individual bars.
- Distributed stock goes into each bar's "back of house" area.
- HQ stock is deducted when distribution is confirmed.

SHARED STORAGE:
- HQ storage locations can be configured to serve specific bars.
- This links a storage location to the bars it primarily supplies.
- Viewing which storage location serves which bars: Event Setup → Source Locations.

WHAT IZZY CAN EXPLAIN (festival mode):
- How to do a session count (go to the bar, tap "Count now")
- How to raise a top-up request
- How goods are received and distributed at HQ
- How transfers work between bars
- How to read the Ops overview screen
- The difference between HQ stock and bar stock

WHAT IZZY CANNOT TELL YOU:
- Live current stock levels (ask Suitee for data questions)
- Which bars have the most stock right now (ask Suitee)
- Velocity data (ask Suitee)

WEEKLY SNAPSHOTS
- Suitee can summarise a week's activity from weekly snapshot data
- Snapshots capture: sessions, transfers, requests, wastage, stock at close, orders
- Weekly snapshots are written manually or by the close-week flow
- Suitee can answer: "How did Week 2 go?" or "Which products moved fastest last week?"

RETURN ALLOWANCE
- Each supplier has a configurable return allowance percentage (default 5%, range 1–20%)
- Set in Event Setup → Supplier Setup
- Suitee can report on projected surplus and whether you're within allowance per supplier
- Return Risk screen shows per-supplier breakdown with suggested operational actions
- Suitee CANNOT suggest pricing changes — only operational actions (redistribution, transfers)

YEAR 2 PLANNING
- When setting up a new event, prior event product velocity is carried forward
- Products have a continuityFlag: 'keep' (2+ events), 'review' (1 event), 'new' (no history)
- Suitee can answer: "Which products should I order more of next year?"
- Year 2 seeds are stored as debriefRecommendations after event close

DEBRIEF
- Auto-generated after event close via /writeFestivalDebrief endpoint
- Three sections: What worked well, What to improve, Year 2 seeds
- Suitee can summarise debrief findings for an event
- Accessible via Event History → View debrief

WHAT SUITEE CAN ANSWER (festival mode):
- Current stock levels across all bars and HQ storage locations
- Which bars are running low or high on specific products
- Velocity (sales rate) per product over any period with data
- Supplier return risk — projected surplus vs allowance
- Weekly snapshot summaries
- Year-on-year velocity comparisons (if prior event data exists)
- Obligation and rider fulfilment status

HISTORICAL DATA IMPORT:
If you have sales or stock data from a prior year you can import it to improve
your order prediction accuracy. Go to Event Setup → Section 6 (Historical data)
and tap "Import prior year data".

Three ways to import:
1. Upload a spreadsheet or CSV — Excel, Numbers, or any CSV from your POS or spreadsheet.
   We detect columns automatically (product name, quantity sold).
2. Photograph a printed stocktake sheet — we read the numbers using OCR.
3. Type in the figures manually — enter quantities sold for each product from memory or notes.

After importing, your AI prediction uses real historical velocity instead of industry
benchmarks. Prediction confidence improves from MEDIUM to HIGH.

You can import multiple years — the system uses the most recent year as primary reference.
Leave quantity blank for products that weren't sold that year (blank = unknown, not zero).

To import: go to Event Setup → Section 6 → Import prior year data.

VELOCITY AND TIME-OF-DAY:
Velocity calculations are based on average consumption since the last session count.
They do not account for time-of-day variation (e.g. peak demand during headliner sets,
or slower periods in the afternoon before crowds build).

For events with predictable demand peaks (headline acts, key sessions) add a manual
buffer when requesting top-ups before those periods. Submit session counts more
frequently during peak periods to improve accuracy — more counts = better velocity.

If a user asks whether velocity accounts for busy headliner periods, be honest:
"Velocity is based on your average since the last session count. It doesn't predict
surge periods automatically. If you're expecting a peak in the next 2 hours, order
more than the estimate suggests and count again after the peak."

WHAT SUITEE CANNOT ANSWER (festival mode):
- Pricing recommendations or price changes — not in scope
- Till system integration data (no POS connected)
- Cash reconciliation or GP calculations (no sales price data, unless uploaded)
- Live crowd data or attendance predictions
- Anything outside the data captured in Hosti

AI-ASSISTED ORDERING (Purchasing Prediction screen):
After the math prediction loads, tap "✦ Refine with AI" to get product-specific
adjustments. The AI only adjusts market share splits within categories — it never
changes category totals.

The AI considers:
- Your event type and season (NZ seasons: summer = high beer, winter = more hot drinks)
- Product characteristics (lager vs craft ale, house wine vs premium, etc.)
- Historical data from prior years if available
- Sponsor obligations that must be met

Each product shows the math baseline and the AI suggestion side by side.
You choose which to use per product — or adjust manually.

If you have run this event before, the AI uses your actual sales history to improve
accuracy. If this is your first year it uses industry knowledge and event context.

The AI never changes category totals — only the split between products within
a category. You can clear the AI refinement at any time and return to equal splits.

This feature counts toward your monthly AI usage. You have 5–20 refinements per
month depending on your plan. Each refinement covers all products in the prediction.

SALES DATA UPLOAD:
Go to Dashboard → Upload sales data
or Reports → Sales data.

You can upload a CSV from your POS (Square, Wavier, or any system)
or enter sales manually.

We detect the date range automatically and map your product names to your
festival catalogue. Mappings are saved so future uploads are faster.

Upload end-of-night to improve next-day ordering accuracy.
Upload end-of-week before closing a weekly snapshot.
Upload at event close for precise reconciliation.

The system works without sales data using session counts as estimates.
Sales uploads improve accuracy but are never required.
`;



