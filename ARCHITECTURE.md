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
- Web app: Vite + React, desktop-only web client at `web-app/`, deployed via Firebase Hosting to `tallyup-f1463.web.app`
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
  totalStocktakesCompleted          — increments once per DEPARTMENT submission (not per full-venue cycle) — this is the counter used for trial stocktake limits
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
```

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

**Founder UIDs** (2 accounts each, so each of the 4 people has both a primary and secondary account with founder status):
- Poni: `ChpWVbutHwSCRQKr3THR79EIw1X2`, `nIIcWSEbb2QjkKlwrALBUFXIXtu2`
- Chris: `XdxYqrCUeQYvfHkJkptjOoXDEwl2`, `OIvPVgL6FpN960FMqTybe7aMRZG3`
- Izzy: `DyydVaTSaPN5MWrLyHczVeZbzDv2`, (second account — check `FOUNDER_UIDS` in `VenueProvider.tsx` for the current value if not yet filled in here)
- Shayle: `WXQtR9QUsCShHtmKzopGEwiQYLV2`, (second account — same note)

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

## Email infrastructure

**Postmark is already deployed — do not introduce a different email provider or the Firebase "Trigger Email" extension.** `POSTMARK_API_KEY` is a Firebase Secret Manager secret. Existing send sites: `functions/src/invites.ts` (team invites), `functions/src/weeklySummary.ts` (weekly manager/owner summary), two sites in `functions/src/api.ts`. All go direct to `https://api.postmarkapp.com/email`. Sender domain `hosti.co.nz` is already configured. New transactional email types should get their own dedicated Postmark message stream (for deliverability tracking), not reuse an existing one — created manually in the Postmark console.

## Standing engineering rules

- **Verify every reported commit against actual `origin/main`** (`git fetch && git log origin/main --oneline -1`) before treating any diff as real. Work has repeatedly been reported as complete while sitting uncommitted or unpushed locally.
- **No awaited Firestore writes in UI paths.** An awaited write genuinely hangs indefinitely offline (the promise never resolves) — this caused a real, confirmed live bug. Use the offline outbox for anything that needs to survive being offline.
- **New Firestore collection = matching security rules in the same commit.** Deploy order: rules → functions → app build.
- **Additive-only Firestore schema changes** where practical.
- **Link products/entities by ID, never by name** in any new feature.
- **Check for an existing pattern before adding a new dependency or building new infrastructure** — the offline outbox, the email system, and the entitlement system have all been reused rather than duplicated once already discovered.
- Before installing any new native dependency, check its compatibility with the exact `react@19.1.0` pin and this project's New Architecture setting — don't assume `npx expo install` succeeding is sufficient; check for peer-dependency conflicts explicitly.
- A build/deploy command reported as run is not the same as the change being live — `git push` updates GitHub only; web needs an explicit `vite build` + `firebase deploy --only hosting`; mobile needs an actual EAS build. OTA (`eas update`) has a known, unresolved Android fingerprint-drift issue between local machine and build servers and is **not** the current release path — native rebuilds are.

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
