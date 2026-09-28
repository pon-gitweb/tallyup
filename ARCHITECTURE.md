# Hosti-Stock — Architecture & Context Guide

For any developer or AI session picking this up: read this first. This document exists because real facts about this codebase were repeatedly re-discovered from scratch across sessions — sometimes at real cost (a stranded user, a compliance gap left live for weeks). Keep it updated in the same commit as any change that affects it.

## What this is

Hosti (internally, the repo and product are called "TallyUp"/"Hosti-Stock") is a hospitality inventory and stocktake platform for bars, cafes, restaurants and casual dining venues in NZ and Australia. It replaces spreadsheets with a fast, offline-capable, AI-assisted counting and ordering system.

**"Festi"** is Poni's internal/informal name for the festival-mode package within Hosti — not a public product name. Publicly, the app is just "Hosti." Festi is a `venueType: 'festival'` venue, sharing the same Firestore `venues` collection and much of the same infrastructure as a regular venue, with its own dedicated screens under `src/screens/festival/`.

A separate, related product called **Crew** (festival-first crew scheduling/staff management) is planned to eventually integrate with Hosti/Festi, but is currently a distinct codebase and out of scope for this document.

## Tech stack

- Framework: Expo (React Native), New Architecture enabled (`newArchEnabled: true` in `app.json`)
- **`react` is pinned to an exact version (`19.1.0`) — never loosen this to a range.** A prior React/React Native version mismatch caused a production-blocking white-screen crash. Any new native dependency must be checked for peer-dependency compatibility with this exact pin before installing (`react-native-reanimated`, for example, was evaluated and rejected for a minor UX fix specifically because installing it required `--legacy-peer-deps` to bypass a conflict with this pin — not worth the risk for a small fix; a pure-JS alternative was used instead).
- Backend: Firebase (Firestore, Auth, Storage, Cloud Functions), project `tallyup-f1463`
- Web app: Vite + React, desktop-first responsive web client at `web-app/`, deployed via Firebase Hosting to `tallyup-f1463.web.app` (responsive via `@media max-width 768px` in `DashboardLayout`, `FestivalLayout`, `SupplierLayout` — renders on phones; "desktop = payment surface" is a product decision under Path A, not a technical constraint)
- AI: Anthropic Claude via Cloud Functions (`functions/src/api.ts`)
- Build: EAS Build (Android AAB/APK, iOS via App Store Connect)
- Email: Postmark (already deployed — see Email infrastructure below)
- Repo: `github.com/pon-gitweb/tallyup`

## Navigation — read this carefully, it has caused a real production bug

**Do not trust the claim that `MainStack.tsx` alone determines what's reachable.** `MainTabs.tsx` (the bottom tab bar) is itself registered as a single screen inside `MainStack.tsx`, and each tab renders its own component **directly, with no nested stack navigator inside any tab.**

This matters because of a real, confirmed bug class: if the same component (or the same route *name*) is registered **both** as a tab inside `MainTabs` and as a separate, standalone screen in `MainStack`, any screen that gets pushed on top of a tab (which is nearly everything — an order detail, an invoice summary, anything reached by tapping into a tab) shares `MainStack` as its *nearest* navigator. Calling `navigate('SomeName')` from such a screen resolves to the **nearest** matching route — the standalone `MainStack` duplicate, not back into the tab bar. The result: the screen renders with a header but no tab bar, and the user is stranded with no way back to normal navigation.

This exact bug stranded a real user (no path to venue/festival creation) before being traced and fixed. A systematic audit found it had happened **five separate times** (`Dashboard`, `Orders`, `Reports`, `FestivalBarSelection`, `FestivalReports` were all duplicate-registered this way). All five were fixed:
- Where the tab's own name matched the duplicate exactly (`Orders`, `Reports`), the duplicate was simply removed — existing callers correctly fall through to the tab.
- Where the tab's real name differed from the duplicate (`Dashboard`→tab `Home`, `FestivalBarSelection`→tab `Stock`), every caller had to be found and updated to the tab's real name *before* the duplicate could be safely removed — removing the duplicate first would have broken every caller instead of fixing them.

**Rule going forward:** never register the same component, or route names that could collide, in both `MainTabs.tsx` and `MainStack.tsx`. If you need a screen reachable both as a tab's home content and as something pushed from elsewhere, give the pushed version a genuinely distinct route name.

Every screen registered directly in `MainStack.tsx` uses only `{ title: '...' }` as its options (confirmed via full audit) — meaning every one gets React Navigation's default header with its automatic back button. None have `headerShown: false` set at registration, and none override their header at runtime. This structural class of dead-end is confirmed absent across the whole app as of this audit. A *behavioral* audit (does every terminal/confirmation screen actually lead somewhere sensible after success, does every form have a clean cancel path) has not yet been done and remains open.

## Firestore structure (core paths)

```
venues/{venueId}
  ownerUid                          — set at creation, used for founder-access checks
  createdAt                         — used for pilot/trial eligibility
  venueType                         — 'festival' for Festi venues, otherwise absent/other
  totalStocktakesCompleted          — incremented by `incrementFullStocktakeCompleted` (src/services/trialStocktake.ts; the function name is misleading — not per full-venue cycle) from three call sites: department completion (StockTakeAreaInventoryScreen) and both onboarding imports (BringYourDataScreen, InventoryImportPreviewScreen), so an import counts as a stocktake; import call sites wrap it in try/catch so a failure silently under-counts. Consumed by: D-039 trial cap, Hosti Health stage gating, and the "Based on N stocktakes" insight text in abductiveInsights.ts (which reports department submissions plus imports, not full cycles). ReportsIndexScreen.tsx ~283 has a stale comment ("only increments when ALL departments finish at once") that contradicts current behaviour — see Open items; treat the code as truth.
  trialStatus                       — denormalized copy of billing/trialState.status, so Cloud Functions can query across venues without a collection-group scan. Kept in sync at both resolution points (trial start, stocktake-limit expiry) — NOT updated on time-limit expiry (see Known accepted trade-offs)
  subscription                      — Stripe subscription state (webhook-driven)
  subscriptionOverride              — Console-only, never client-writable; explicit manual override
  legacyFreeAccess                  — Console-only flag; grandfathered permanent access, distinct from the founder-UID mechanism
  members/{uid}
    role                            — 'owner' | 'manager' | 'staff'
    email                           — denormalized from Firebase Auth at creation (see Known accepted trade-offs — historically NOT always populated; a backfill script exists at scripts/admin/backfill-owner-email.js)
  departments/{deptId}/areas/{areaId}/items/{itemId}
  orders/{orderId}
  requests/{requestId}              — festival delivery/transfer requests
  onHand/{entryId}                  — festival stock-on-hand register
  equipment/{itemId}                — festival equipment register (never inventory)
  billing/trialState                — single doc: startedAt, stocktakesAtStart, stocktakesUsed, status, resolvedAt, resolvedReason, reminderSentAt
  billing/moduleTrialState          — flat map keyed by moduleId, for the one-time 14-day new-module trial
  event/details                     — festival event configuration
  products/{id}/priceHistory        — per-product price history written by priceTracking.ts
  priceChangeFlags                  — price-change flags in any state (status pending / acknowledged / dismissed), including stale-invoice conflict flags written by buildStaleFlagDoc; the Price Change Flags screen lists status == 'pending'; get_supplier_price_trend aggregates them
  pendingDeliveries                 — pending deliveries for the "Match to invoice" flow
  fastReceives                      — snapshots persisted by InventoryImportScreen before proposal review, from both the photo path and the PDF/CSV path (see Invoice and product intake)
  profitRecoverySnapshots/{YYYY-MM} — monthly Hosti Health snapshot (mobile writes; see Hosti Health)
  hostiHealthHistory/{YYYY-MM}      — monthly Hosti Health history (web writes; trend charts need two distinct months)
```

This is a subset. `firestore.rules` is the source of truth; it declares ~100 collection matches.

## Entitlement & billing system

**There are two, deliberately separate, entitlement-related files — do not conflate them:**
- `src/services/entitlement.ts` — narrow, AI-feature-specific (`isEntitled`/`checkEntitlement`). Currently a deliberate, still-correct "beta hard-load TRUE" bypass for AI features specifically. Used by `AiExplainButton.tsx`.
- `src/services/billing/entitlements.ts` — the real module/subscription system, consumed by `VenueProvider.tsx`. Its `Addons`/`BillingState` shape is a derived, denormalized view computed *from* the real module check (`hasModule`) for backward compatibility — not a separate source of truth.
- `src/context/VenueProvider.tsx` is the actual, live, canonical entitlement resolver. It uses `onSnapshot` on the venue doc — updates propagate automatically on any write (webhook, admin script, etc.), no client restart needed.

**`VenueProvider`'s entitlement resolution is a priority-ordered chain, evaluated fresh on every read (never cached, never dependent on a possibly-stale denormalized flag for the actual access decision):**

1. `subscriptionOverride` exists (Console-only) → explicit manual override wins.
2. `legacyFreeAccess` flag set (Console-only) → permanent full access. A separate mechanism from the founder-UID branch below — kept as a general-purpose escape hatch even though founders/Matchbox now have their own named branches.
3. `venue.ownerUid` is one of the founder UIDs → permanent full access. **Live check** — if ownership is ever transferred away from a founder, this branch stops matching automatically, no manual intervention needed.
4. `venue.id` is the Matchbox venue → full access until `pilotTriggerDate + 365 days`, then 50% off Core.
5. `venue.createdAt < pilotTriggerDate` (any other pre-launch venue) → 50% off Core until `pilotTriggerDate + 365 days`, then falls through to branch 7.
6. `venue.createdAt >= pilotTriggerDate` (a genuinely new, post-launch venue) → the D-039 free trial (see below).
7. Final branch — real Stripe subscription status only. `isPilot`/`isActive` computed from `subscription.status` (`'active'` or `'trialing'` = active). Only genuinely reachable for post-launch venues once branch 6's trial has resolved.

**`pilotTriggerDate`** lives in Firestore at `config/billing.pilotTriggerDate` (read live via `onSnapshot`) — not hardcoded — specifically so the actual go-live date can be adjusted without a rebuild if app store review timing shifts.

**Founder UIDs** (6 UIDs in total — Poni and Chris each have 2 accounts in the array; Izzy and Shayle each have 1 live UID, with their second accounts as code-level TODOs not yet filled in):
- Poni: `ChpWVbutHwSCRQKr3THR79EIw1X2`, `nIIcWSEbb2QjkKlwrALBUFXIXtu2`
- Chris: `XdxYqrCUeQYvfHkJkptjOoXDEwl2`, `OIvPVgL6FpN960FMqTybe7aMRZG3`
- Izzy: `DyydVaTSaPN5MWrLyHczVeZbzDv2` (second account not yet added — TODO at `VenueProvider.tsx:37`)
- Shayle: `WXQtR9QUsCShHtmKzopGEwiQYLV2` (second account not yet added — TODO at `VenueProvider.tsx:41`)

**Matchbox venue ID:** `O9pChydjz75nwpWA81KO`

### D-039 — the free trial (built, current)

Confirmed by Chris directly: no card required upfront. Ends read-only (not locked out — data preserved, persistent re-subscribe prompt) at whichever comes first of **3 committed stocktakes or 30 days**. Same trial regardless of monthly/annual billing (billing frequency is only chosen at actual conversion). A reminder email fires with runway before read-only kicks in (not a charge warning — there's no card to charge).

"3 committed stocktakes" resolves to the existing `totalStocktakesCompleted` counter, which increments **per department submission**, not per full-venue cycle — this was a deliberate choice to reuse an already-live, already-tested counter rather than build new instrumentation. A multi-department venue reaches the cap faster in wall-clock terms, which is considered correct behavior (more departments = more real usage demonstrated).

New-module trial: if a module is introduced to the catalog *after* a venue's original trial started, that venue gets a one-time 14-day trial of that specific module on first encounter, tracked in `billing/moduleTrialState`. Module introduction dates live in `MODULE_INTRODUCED_AT` in `src/services/billing/modules.ts`.

Reminder email is a scheduled Cloud Function (`functions/src/trialReminder.ts`), daily, via Postmark, on a dedicated `trial-reminders` message stream (**must be created manually in the Postmark console before this function is deployed — not yet done as of this writing**).

### Current pricing (confirmed 25 Sep 2026, supersedes all earlier figures)

All prices NZD, ex-GST, with GST added at checkout via Stripe Tax (`automatic_tax: { enabled: true }`, `billing_address_collection: "required"` on both checkout session endpoints in `functions/src/api.ts`):

| Item | Monthly (ex-GST) | Annual (ex-GST) |
|---|---|---|
| Core | $149.00 | $1,608.00 |
| Supplier Optimisation | $59.00 | $637.00 |
| Ops Intelligence | $49.00 | $529.00 |
| SO + Ops Combo | $89.00 | $961.00 |
| Live Sales *(gated behind a POS connector that doesn't exist yet — shown as "Coming soon", not purchasable)* | $70.00 | $756.00 |

- **Performance & Incentives is folded into Core as an included feature** — no longer separately sold. The `performance_incentives` module ID is kept internally and resolves as always-granted whenever Core access is granted, for backward compatibility. Its Stripe product is left as-is (not archived), in case it returns.
- **Multi-Venue Command Centre is out of scope for this pricing round** — its Stripe product is left as-is, untouched, dormant. Not shown on either pricing screen.
- Stripe live-mode products/prices were recreated (prices are immutable in Stripe — changing a price always means archiving the old one and creating a new one on the same product, never editing in place). Lookup keys were preserved/reused across the price swap so application code didn't need updating.
- GST number used for Stripe Tax on venue subscriptions: Hosti Ltd's (147-312-687) — confirmed distinct from Stack Mosaic's own, separate GST registration.
- **AI Meter Extension ($40 one-off)** is a known, still-open inconsistency: it's on a different product (not part of the Core/module set above) and its Stripe price's tax-inclusive/exclusive setting needs to match whatever the app displays before its checkout button is safe to re-enable.
- **Checkout buttons on both `PricingScreen.tsx` (mobile) and `BillingPage.tsx` (web) are currently deliberately disabled** ("Updated plans — checkout reopening shortly"), pending a real end-to-end test purchase. The underlying `handleCheckout`/`handleAdd` functions are preserved, not deleted, for re-enabling once tested.

## Invoice price-change intelligence

`functions/src/priceTracking.ts` (`proposeInvoiceChanges`) — called live from three routes (`api.ts` ×2, `ocrInvoicePhoto.ts` ×1), 28/28 tests passing as of this writing. Built to catch a specific, real failure mode: an invoice line reading as a case total (e.g. "$18.00") getting compared directly against a per-unit cost (e.g. "$1.50"), producing a false, alarming price-increase flag.

- **Near-duplicate matching** (`nameMatching.ts`) uses token-subset comparison, not raw substring — deliberately, since substring matching on short names caused real false positives (`"Gin"` matching inside `"Ginger Beer"`).
- **Case-mismatch detection**: when a flagged change exceeds 50%, checks the product's own known case size first, falling back to common sizes (6/12/24) only if unknown, within a 15% tolerance band. On a match, proposes a corrected per-unit price alongside the raw one — the user decides, nothing is silently auto-corrected.
- **Multi-signal reasoning**: for changes that survive the case-mismatch check, attaches whether the change is isolated or trending across the same invoice, whether the invoice's supplier differs from the product's usual one, and how confident the underlying name-match actually was — surfaced together, not just a bare percentage.

## Stocktake correction tool

Desktop-only (`web-app/src/pages/StocktakeCorrectionPage.tsx` + `web-app/src/services/stocktakeCorrection.ts`), gated to owner/manager via a dedicated Firestore rule (`stocktakeCorrections/{correctionId}`, confirmed present). Deliberately not on mobile — this corrects historical financial records, and every other action of that sensitivity in this app already lives on desktop.

**Why this exists:** a miscounted stocktake entry (e.g. 85 typed instead of 0.85) doesn't just corrupt its own cycle — the *next* cycle's opening baseline is read from it, so the error compounds exactly one cycle forward before self-resolving (the cycle after that reads from a genuinely correct baseline). The tool corrects the source cycle and automatically recomputes the one downstream cycle affected, previewing the full before/after for both before anything commits.

**Never overwrites silently.** Every correction is a real batch write (source cycle summary + downstream cycle summary, atomic — a rules denial on either half fails both) plus a permanent, append-only audit record (who, when, original value, corrected value, reason) at `venues/{venueId}/stocktakeCorrections/`. This mirrors D-050's forward-correction principle: a *live, operational* field like a corrected count or a recomputed `costPrice` is expected to update to the most accurate current value — what D-050 protects is a venue's own recorded history from being silently rewritten, which this tool never does.

## App Store / Play Store compliance

**Path A is the confirmed, standing decision: mobile is informational-only. No purchase CTAs, no external payment links, no live checkout calls of any kind, anywhere in the mobile app.** Desktop web-app is the real payment surface, under Apple's 3.1.3(f) reader-app-style exemption. Paths B (native IAP) and C (enterprise-only gating) were considered and set aside.

**A real, live violation of this was found and fixed:** `AiExplainButton.tsx` on mobile rendered `PaymentSheet.tsx`, which called a live function hitting the real Stripe checkout-session endpoint. The actual trigger was commented out (`// disabled for beta`), so it wasn't reachable through normal use — but the live checkout code was still present and one small future change away from becoming reachable. `PaymentSheet.tsx` has been deleted entirely; `AiExplainButton.tsx` now shows an informational message instead, with no purchase path.

`src/screens/dev/StripeTestScreen.tsx` still directly references `createCheckout` — confirmed **not** registered in any navigator, genuinely unreachable through the shipped app. Lower risk than the above, but worth deleting for tidiness rather than leaving orphaned live-checkout code in the source tree.

Desktop web-app still needs (not yet done): App Store/Play Store download badge links, and a full onboarding flow (login → create venue → dashboard) ported from `CreateVenueScreen.tsx` — currently only login/accept-invite exists on desktop.

## Festival mode (Festi)

Agreed phase flow: **Setup → Plan → Order → Bump-in → Live (daily loop) → Bump-out → Close & review.** Guided, never gated — every phase should remain reachable, not a forced sequence.

- Setup = structural configuration only (event basics, bars, storage spaces, suppliers). Product planning and historical data are decided to move out of Setup into Plan — **decision made, not yet implemented.**
- Equipment is never inventory. Consumables (cups, ice) are products flagged not-for-sale.
- A planned allocation map (Plan phase) is reference-only and physical-fit prediction — it does not drive orders.
- A phase-driven dashboard hero (each phase owns the hero + relevant "next steps" while it's the current phase, all phases still reachable) and a festival-only Notifications tab (would be a 5th tab — festival mode currently has 4 tabs vs. regular Hosti's 5, so there's room) are both planned but explicitly deferred ("the next few weeks"), not urgent.

**Offline outbox — complete.** Firestore's `persistentLocalCache` falls back to memory-only on React Native (no IndexedDB), so writes have no real offline persistence via the SDK itself. A custom AsyncStorage-backed outbox (`src/services/offlineOutbox.ts`) was built and migrated across all 14 identified festival screens with awaited or silently-lossy writes. Two entry types: `payload` (a fixed operation + data, safe to replay verbatim — simple `setDoc`/`updateDoc`/`deleteDoc`) and `operation` (a named, registered function re-run fresh at flush time — required for anything that reads current state before deciding what to write, e.g. `runTransaction` calls, multi-step batches). Flushes in strict FIFO order on reconnect (`NetInfo`), stopping and re-queueing on any single failure rather than losing subsequent items.

## Telemetry

`functions/src/analytics.ts` writes to `venues/{venueId}/analyticsEvents` on three real, exported, deployable Cloud Function triggers: `onStocktakeCompleted`, `onOrderSubmitted`, `onAiFeatureUsed` (all confirmed present in `index.ts`'s exports). This is genuine, live data collection, not a stub.

**What's unconfirmed:** the code's own comment states this collection needs the Firebase Extension `firestore-bigquery-export` installed and pointed at it to actually reach BigQuery — installation status can't be confirmed from code, only from the Firebase Console's Extensions tab.

**Deliberately not built yet, per a real decision (not an oversight):** a visualization/dashboard layer for Chris to view this data is explicitly deferred until 25 paid venues are reached (Telemetry & Instrumentation Spec, Notion, D-028.11 — "build for the audience that exists, instrument for the audience that might"). Don't rebuild this decision from scratch if it comes up again before that threshold.

## AI endpoints and metering

All AI features route through `functions/src/api.ts`. Live endpoints as of this writing:

- `/variance-explain` — variance-analysis persona
- `/generate-recipe` — bar or kitchen consultant persona
- `/budget-suggest` — budget advisor persona
- `/ai-insights` — business advisor persona
- `/photo-count` — inventory counter persona
- `/suitee` — venue intelligence persona; branches at `venueType === 'festival'` (~line 3557) to a dedicated festival persona prompt (~line 5434) — that specific call chain has not been fully traced
- `/izzy` — in-app guide persona

**Metering** lives in `functions/src/services/aiMeter.ts` (`checkAiLimit`, `trackAiCall`, `PLAN_LIMITS`). Usage records land at `venues/{venueId}/aiUsage/{YYYY-MM}`. The Stripe webhook adds calls for the AI Meter Extension. **`PLAN_LIMITS` is duplicated** between `aiMeter.ts` and `src/screens/settings/AiUsageScreen.tsx` — both files carry "keep in sync" comments; update both whenever limits change.

Photo/PDF/CSV import is server-metered: `/extract-inventory` and `/process-invoice-photo` each call `checkAiLimit` + `trackAiCall`; the `ocrInvoicePhoto` callable also meters as `'invoice_ocr'`. This server-side metering backs the removal of the UI-level cost gate on `InventoryImportScreen`.

**Meter coverage is not uniform** — see Open items for the confirmation gap.

## Suitee context and grounding

`POST /suitee` in `functions/src/api.ts` gives the model: (a) an ambient context string built server-side over a fixed 90-day window (`ninetyDaysTs` / `ninetyDaysAgo`) and (b) 8 tools from `functions/src/suiteeTools.ts`, registered in the `tools` array (~`api.ts:4793`) and dispatched in the resolver: `get_gp_analysis`, `get_supplier_price_trend`, `get_worst_gp_recipes`, `get_supplier_compliance`, `get_gp_trend`, `get_batch_ratio_consistency`, `get_menu_engineering`, `get_price_change_detail`. `runToolLoop` hard-caps at 3 model rounds.

**Grounding rules (deliberate — do not undo):**
- Ambient context holds pre-aggregated facts only. Per-product price-change lines are intentionally NOT in ambient context; `get_price_change_detail` is the only source (uncapped; `windowChange` is earliest→latest price, never a sum of step percentages; `isHistoricalBackfill` entries excluded).
- Every tool description carries a "relay exactly, never compute/estimate" clause. The system prompt requires the detail tool for per-product price questions and forbids claiming data is unavailable without calling a tool.
- Price averages go through `functions/src/priceChangeSanity.ts` (`ANOMALOUS_CHANGE_THRESHOLD_PCT = 75`): `rawAverage`, `cleanAverage`, `flagged`. Used by `get_supplier_price_trend` and the ambient PRICE CHANGES line. Any new averaging of `changePercent` must use it.

**Invariant:** `changePercent` must be computed from the same value stored as the new price. `priceTracking.ts` has five `changePercent` sites; the near-duplicate/WAC branch used to compute from the raw invoice price while storing `wac4.costPrice` — fixed and tested.

**Known limitations:** (i) velocity/PAR lines come from the latest stocktake cycle (`lastStock` vs `parLevel`): as of last count, not live stock; (ii) their headings print counts after truncation (`BELOW PAR n` after `slice(0,8)`; slow/fast after `slice(0,10)`), so `n` can understate the total — see Open items; (iii) the HOSTI HEALTH block reads `venues/{v}/profitRecoverySnapshots/{YYYY-MM}` with no `calculatedAt` freshness check.

## Hosti Health

Two deliberate implementations (see also Known parallel implementations): `src/services/health/hostiHealth.ts` (mobile) and `web-app/src/services/hostiHealth.ts` (web, computes live in the browser). The Stock Accuracy curve (flat 100 to 1.5% variance, 80 at 5%, 40 at 10%, 0 at 30%) is identical in both. The "improvement vs last cycle" badge (`calcVarianceImprovementPct`, `stockAccuracyImprovementPct`) exists on web only; mobile's `abductiveInsights` still inlines the arithmetic.

**Data:** mobile writes `venues/{v}/profitRecoverySnapshots/{YYYY-MM}` inside a non-fatal `try/catch` (Sentry context `hostiHealth:monthlySnapshotWrite`). Web appends `venues/{v}/hostiHealthHistory/{YYYY-MM}`; trend charts need two distinct months. Both collections: member read, manager/owner write.

**Entry point:** Reports → "Hosti Health" → ProfitInsights. Not on the Dashboard.

## Invoice and product intake

`InventoryImportScreen` ("Add Products" → past stocktake / invoice / scan): photos go `scanInvoicePhoto` → `ocrInvoicePhoto` (Cloud Function) → persisted as a `venues/{v}/fastReceives` snapshot → `InventoryReviewModal`; PDF/CSV goes to `/api/extract-inventory`. Both return `supplierCandidate` + `newProduct` proposals via `supplierResolution.resolveSupplier` and `inventoryMatching.detectNewProducts` (single implementation; `nameMatching.ts` supplies tokenising/overlap). `normNameInline` remains in `ocrInvoicePhoto.ts` only, for supplier-name equality.

Products may carry optional `homeDepartmentId` / `homeAreaId` (`EditProductScreen`, allowed in the rules' `affectedKeys`). No stocktake code reads them. Areas live at `departments/{d}/areas/{a}`.

## Email infrastructure

**Postmark is already deployed — do not introduce a different email provider or the Firebase "Trigger Email" extension.** `POSTMARK_API_KEY` is a Firebase Secret Manager secret. Existing send sites: `functions/src/invites.ts` (team invites), `functions/src/weeklySummary.ts` (weekly manager/owner summary), two sites in `functions/src/api.ts`. All go direct to `https://api.postmarkapp.com/email`. Sender domain `hosti.co.nz` is already configured. New transactional email types should get their own dedicated Postmark message stream (for deliverability tracking), not reuse an existing one — created manually in the Postmark console.

## Build commands and verification gates

**Root (mobile app):**
- `npm ci --ignore-scripts` — uses the tracked `package-lock.json`; `--ignore-scripts` avoids running postinstall hooks against a possibly-mismatched environment
- `npm run check:renderer` — compares the React renderer version bundled inside `react-native` (`ReactNativeRenderer-prod.js` hard-coded version string) against the installed `react` package; **run this before every native build and every `eas update`** — a mismatch is the confirmed cause of the white-screen production crash
- `npm run check:undefined` — runs `tsc --noEmit` and catches identifiers used without being defined or imported (TS2304/TS2552), which throw `ReferenceError` at runtime; exits 0 clean, 1 if undefined identifiers found, 2 if tsc could not run; **run this before every native build and every `eas update`** alongside `check:renderer`; ~30 s
- `npx jest --config jest.unit.config.js` — 42 suites / 366 tests as of this writing

**Functions:**
- `npm install` (no tracked lockfile — installs float, affecting install reproducibility)
- `npx jest` — 20 suites / 340 tests as of this writing

**OTA baseline (`check:ota`):** per the script header, compares the last recorded Android build fingerprint against the current OTA updates; requires EAS and has not been executed here — the behaviour with a stale baseline is unverified. **`.last-android-build-fingerprint` must be updated after every Android native build** — it currently holds build 78's fingerprint and is stale for build 79 (see Open items).

**`deny-backups` / `deny-legacy-orders-imports`** inspect staged files only and pass trivially on a clean tree — they do not protect a branch that has already been committed.

**`tsc --noEmit` from repo root is not a clean gate:** it sweeps `web-app/` and `backend/` without their own dependency trees, producing dozens of errors; the count depends on which dependency trees are installed (56 with a root-only install, 34 on the dev machine at 041a795). Only use it for errors in files outside those two directories, and read the output accordingly.

**Lockfiles:** tracked (verified via `git ls-files`): root `package-lock.json`, `backend/functions/`, and `server/`; whether `backend/functions/` and `server/` are still active packages is unchecked. `functions/` and `web-app/` have none — installs float. `check-ota-safe.sh` itself cites unpinned lockfiles as the root cause of an earlier React version drift. Pinning `functions/package-lock.json` is a known gap.

## OTA / EAS configuration

(See also `check:ota` in Build commands and verification gates.)

Update config lives in three places: `app.json` (the `updates` block; per-platform `runtimeVersion`), the committed native projects (`android/` and `ios/` are tracked; EAS ignores `app.json` values they override, e.g. `android.package`), and `eas.json` profile `channel`.

**Runtime versions:** iOS uses a static `"1.0.0"` (`Expo.plist` + `app.json`). Android uses the fingerprint policy (`expo_runtime_version = file:fingerprint`), so any native-affecting change yields a new runtime version and Android OTA only reaches builds whose fingerprint matches the update's.

**Channel:** both native configs hard-code `expo-channel-name: production` (`AndroidManifest` `UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY`, `Expo.plist` `EXUpdatesRequestHeaders`). `eas.json` sets `channel: production` on `production`, `play-aab`, `ios-simulator`, `ios-store`; profiles `base`, `development`, `preview`, `tester-apk`, `ios-preview` declare no channel. Configuring the channel does not affect already-installed builds (noted in commit `b16b31e`).

**Launch behaviour:** `checkOnLaunch` is `ALWAYS` with `launchWait: 0`; by default an update fetched on launch N applies on launch N+1.

**App code:** only `SettingsScreen.tsx` touches `expo-updates` (the "OTA Update State" panel: `isEmbeddedLaunch`, `channel`, `runtimeVersion`, `updateId`). No app code triggers checks or reloads.

**Status:** OTA application on real devices has not been observed working on Android build 79 / iOS build 45 despite matching fingerprint and channel. Cause unresolved. Unchecked: the channel→branch mapping (run `eas channel:view production` to confirm) and the panel readout. Source: EAS CLI output from a session, not verifiable from the repo alone — see Open items.

## Standing engineering rules

- **Verify every reported commit against actual `origin/main`** (`git fetch && git log origin/main --oneline -1`) before treating any diff as real. Work has repeatedly been reported as complete while sitting uncommitted or unpushed locally.
- **No awaited Firestore writes in UI paths.** An awaited write genuinely hangs indefinitely offline (the promise never resolves) — this caused a real, confirmed live bug. Use the offline outbox for anything that needs to survive being offline.
- **New Firestore collection = matching security rules in the same commit.** Deploy order: rules → functions → app build.
- **Additive-only Firestore schema changes** where practical.
- **Link products/entities by ID, never by name** in any new feature.
- **Check for an existing pattern before adding a new dependency or building new infrastructure** — the offline outbox, the email system, the entitlement system, and `src/services/products/resolveProduct.ts` (the shared merge-chain resolver, correctly reused by `StockHoldingScreen.tsx`, `snapshotWriter.ts`, and `refreshPricesForDepartment.ts` rather than each maintaining its own copy — 8/8 tests passing) have all been reused rather than duplicated once already discovered.
- Before installing any new native dependency, check its compatibility with the exact `react@19.1.0` pin and this project's New Architecture setting — don't assume `npx expo install` succeeding is sufficient; check for peer-dependency conflicts explicitly.
- A build/deploy command reported as run is not the same as the change being live — `git push` updates GitHub only; web needs an explicit `vite build` + `firebase deploy --only hosting`; mobile needs an actual EAS build. OTA application on devices is unresolved; see 'OTA / EAS configuration'.
- **Run `npm run check:renderer` and `npm run check:undefined` before every native build and every `eas update`.** `check:renderer` would have caught the builds 76/77 white-screen crash. `check:undefined` would have caught the `75216ec` `PendingDeliveriesScreen` `FlatList` defect.
- **Verify a removal with two methods before trusting the result.** `grep "today.s update landed"` returns 0 hits on a file containing the text `"today"` + U+2019 + `"s update landed"` (RIGHT SINGLE QUOTATION MARK, not U+0027 APOSTROPHE); a diagnostic banner shipped in two builds because of this. Reproduce:
  ```sh
  git show f435237:src/screens/health/ProfitInsightsScreen.tsx > /tmp/banner.tsx
  grep -c "today.s update landed" /tmp/banner.tsx    # prints 0
  python3 -c "print('today\u2019s update landed' in open('/tmp/banner.tsx', encoding='utf-8').read())"    # prints True
  ```
  Use fixed strings with the exact Unicode code points, or Python's `in`.
- **`grep` basic regex treats `?` literally and is case-sensitive:** use `grep -niE` for extended regex and case-insensitive matching.
- **Any list passed to a model must state total vs shown count.** Never label a post-`slice` length as the count of matching items — the heading may silently understate the real total. See the BELOW PAR / velocity headings in Suitee context and grounding.
- **A regression test must be shown to fail on the pre-fix code before it is trusted.** Restore the parent commit's version of the file under test and rerun: if every test still passes, the test cannot detect the bug and must be replaced. A test that imports the dependency itself or mirrors the logic locally cannot detect a bug in the module it claims to cover — it tests its own copy. `15e7311` is the worked example: a 5-test suite for a missing `FlatList` import passed on the pre-fix screen because it imported `FlatList` from `react-native` directly, never from the screen, and mirrored the modal logic as a pure function; the suite was replaced with `check:undefined`, which correctly exits 1 on the pre-fix file.

## Known parallel implementations (keep in sync)

These are confirmed to exist in more than one place. Changing one without the other will cause silent divergence:

- **Hosti Health** — implemented separately on mobile (`src/`) and on web (`web-app/src/services/hostiHealth.ts`)
- **`mergeProducts`** — implementations in both `src/services/products/` and `web-app/src/services/`; whether they have drifted is last unchecked
- **`computeGpPercent`** — `web-app/src/pages/SetupProductsPage.tsx:119` vs `functions/src/priceTracking.ts:38`; three web-app tests define private copies of this function rather than importing it, so they test the copy, not the production one
- **`PLAN_LIMITS`** — `functions/src/services/aiMeter.ts` and `src/screens/settings/AiUsageScreen.tsx`; both have "keep in sync" comments

## Known, deliberate accepted trade-offs (not bugs — do not "fix" without discussion)

- A venue whose `createdAt` field is permanently missing (very old/legacy data) falls back to generous, ungated access rather than being forced into any specific tier. Deliberate — these predate the whole tier system and are old enough to be treated as legacy.
- `trialStatus` (the denormalized flag on the venue doc, used by the reminder Cloud Function's query) is correctly kept in sync at trial-start and at stocktake-limit expiry, but **not** at time-limit expiry (30 days passing without hitting the stocktake cap). This does not affect real access control (the actual gate reads live counter/timestamp fields, never this flag) — the only cost is the reminder function's daily query keeps a fully time-expired venue in its candidate set indefinitely, which is wasted reads, not incorrect behavior (the function's own per-document check independently confirms real trial status before ever sending anything, and `reminderSentAt` prevents any duplicate or late send regardless).
- Member documents historically did not always have `email` populated (a data gap in `CreateVenueScreen.tsx`'s original venue-creation write, now fixed going forward). A backfill script exists at `scripts/admin/backfill-owner-email.js` for existing affected accounts. Team-identity display everywhere falls back `displayName → email → "Unnamed member"` — never a raw Firebase UID, which is meaningless to an end user.

## Open items as of this writing

- Behavioral dead-end audit (does every screen's terminal/success state and every form's cancel path actually work) — the structural/navigation-registration class of dead-end is confirmed fixed and audited; this finer-grained pass has not been done.
- Web checkout has never been tested end-to-end with a real purchase (recommended: one real low-cost purchase, confirm the Stripe receipt shows the correct GST-inclusive total with GST itemized separately, then refund).
- Trial reminder Cloud Function needs its dedicated Postmark stream created manually before deployment.
- AI Meter Extension's GST-inclusive/exclusive mismatch needs resolving before its checkout button is re-enabled.
- Setup → Plan screen move (agreed, not yet implemented).
- `src/screens/dev/StripeTestScreen.tsx` — orphaned, unreachable, but references live checkout code; worth deleting.
- Android builds are subject to EAS's free-tier monthly quota — check remaining quota before assuming a build will succeed.
- **`ReceiveAlias` manual-receive gap (confirmed, not yet fixed):** `ReceiveAlias.tsx` has two completely separate "Complete Receiving" paths that are never integrated with each other:
  - **Scan path** (`completeScanReceiving`, line ~215): calls `finalizeReceiveFromPhoto` → `finalizeReceiveCore` — correctly updates `incomingQty` on area items, creates an invoice record, runs dedup and period classification. This path works correctly.
  - **Manual path** (`persist(true)`, line ~121, triggered by the "Complete Receiving" button when no scan has been done): writes `receivedQty` onto order line docs and sets `order.status = 'received'`. That is all it does. It never touches area items (`departments/.../items`), never creates an invoice record, never calls `finalizeReceiveCore`, and never increments `incomingQty`. Stock counts are not updated.
  
  This means any operator who receives an order manually without scanning an invoice has their order marked as received but their actual stock levels (`incomingQty`, and therefore the expected count in the next stocktake) never updated. The two paths use different status values (`'received'` vs `'invoiced'`) and are entirely unaware of each other.
  
  **Planned fix (not yet implemented):** After `persist(true)` completes, call `finalizeReceiveCore` using the order's own line quantities as the parsed lines — treating a manually confirmed receive as if it were a confirmed invoice with the ordered quantities. This creates a real invoice record and updates stock, without requiring a physical invoice document. The alternative (Option B) is to keep the paths separate and add a nudge after manual receive: "Order marked received. Scan or upload your invoice to update your stock counts." Option B requires no code change to `finalizeReceiveCore` and carries lower regression risk — preferred if this is being added pre-pilot.
- **Stale OTA baseline:** `.last-android-build-fingerprint` holds build 78's fingerprint and must be updated to build 79's before `check:ota` is meaningful again. Run `npm run check:ota` after updating to confirm it passes cleanly. Until updated, the OTA safety check always diffs against the wrong baseline.
- **AI meter coverage gap (confirm before assuming):** `/upload-file`, `/reconcile-invoice`, and `/writeFestivalDebrief` have no `trackAiCall` in their route bodies. `/variance-explain` and the two `/extract-festival-*` routes call `checkAiLimit` but not `trackAiCall`. 13 `trackAiCall(` calls exist in `api.ts`, 11 attributed to named routes — helpers may cover the remainder. Audit `api.ts` before concluding any route is unmetered.
- **`DeliveryHubScreen.labels.test.ts:234`** compares the literal string `'invoices'` against `'pending'` — these can never be equal, so the assertion may not be testing what it intends. Confirm what the test was meant to assert before relying on it as a correctness signal.
- **`venues/{v}/gpAlerts` missing security rule (unconfirmed):** `web-app/src/pages/SetupProductsPage.tsx` has a client listener that reads and updates `gpAlerts`, but a static reading of `firestore.rules` finds no matching rule for this collection. Confirm in the Rules Playground before assuming writes succeed in production; if missing, add the rule in the same commit as any code change touching it.
- **Suitee velocity/PAR heading counts:** `BELOW PAR n` is printed after `slice(0,8)` and slow/fast counts after `slice(0,10)`, so `n` reflects the shown count, not the total matching items — a model reading the ambient context may underestimate the scope. Fix: pass the total before slicing alongside the truncated list.
- **Stale comment at `ReportsIndexScreen.tsx:~283`:** says `totalStocktakesCompleted` "only increments when ALL departments finish at once" — contradicts current behaviour (increments per department and per import). Treat the code as truth; remove the comment.
- **OTA channel→branch mapping unverified:** run `eas channel:view production` and record which branch it points to. Until done, OTA targeting is unconfirmed.
