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

IZZY
- Ask Izzy anything about how to use the app
- Available on every screen via the ✦ button in the header

SUITEE (manager/owner only)
- Ask Suitee questions about your venue data
- Available in the Reports screen
`,

  planned: `
FEATURES PLANNED FOR FUTURE UPDATES:
- Voice counting (say the number out loud, count is recorded)
- POS integration (Lightspeed, Square, Wizbang Onetap, BEPOZ, Impos)
- Xero accounting integration
- Photo counting (count bottles visible in a photo)
- Gamification and staff performance tracking
- Supplier scorecards
- Multi-venue management
- Predictive ordering
- Weekly summary email
`,

  unavailable: `
IF ASKED ABOUT ANYTHING NOT IN THE ABOVE LISTS:
Respond that the feature is not currently available and suggest contacting support at office@hosti.co.nz.
`,
};
