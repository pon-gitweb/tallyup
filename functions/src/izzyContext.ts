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

SETUP WIZARD
- New users see a 3-step introduction to stocktaking on first login
- Explains what a stocktake is, how the flow works, and how to add products
- Only shown once — never appears again after you've been through it

BATCH PRICE ENTRY
- Add cost prices to multiple products at once from the Reports screen
- The "Add prices for dollar variance" card in Reports links directly to it
- Enter prices inline without leaving the screen
- Save all prices in one tap

RECIPE COSTS (CraftUp)
- Recipes linked to venue products show live cost prices
- COGS updates automatically when invoice prices change
- Ingredients show whether their cost is live (linked to a product) or manual
- Add prices directly from the recipe if a linked product has no price set

IZZY
- Ask Izzy anything about how to use the app
- Available on every screen via the ✦ button in the header

SUITEE (manager/owner only)
- Ask Suitee questions about your venue data
- Available in the Reports screen
`,

  planned: `
FEATURES PLANNED FOR FUTURE UPDATES:
- POS integration (Lightspeed, Square, Wizbang Onetap, BEPOZ, Impos)
- Xero accounting integration
- Photo counting (count bottles visible in a photo)
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



