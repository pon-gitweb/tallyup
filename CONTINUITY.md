# Hosti — Business Continuity Guide

This is not architecture. `ARCHITECTURE.md` tells you how the code works. This file tells you what exists *outside* the code that no amount of reading the repo would ever surface — where things live, who can act on them, and what to do first if something breaks that isn't a code problem. Keep it short. If an entry starts explaining *why* a decision was made, it belongs in `ARCHITECTURE.md` or the Notion Decision Log instead.

## Account map

| Service | What it's for | Entity | Notes |
|---|---|---|---|
| Firebase | Backend, hosting, functions | `tallyup-f1463` project | Live project — confirm there is no separate staging/test project in active use |
| Stripe | Billing | Live mode confirmed active | Hosti Ltd GST number (147-312-687) used for Stripe Tax |
| Postmark | Transactional email | — | Sender domain `hosti.co.nz` configured |
| GitHub | Repo | `pon-gitweb/tallyup` | — |
| EAS (Expo) | Mobile builds | — | Free-tier monthly Android build quota — confirm current plan |
| Apple Developer Program | iOS distribution | **Individual, Poni's personal Apple ID** | **Single point of failure — see below. Fix agreed, not yet actioned.** |
| Google Play Console | Android distribution | — | Chris confirmed co-owner/admin |
| Squarespace | hosti.co.nz marketing site + DNS | — | Chris has access |

**Fill in / confirm, don't guess:** who is the actual billing contact on each paid service (Stripe, Postmark, EAS, Firebase Blaze plan, Squarespace, Apple, Google Play) — i.e. whose card is on file and who gets the "payment failed" email. That person failing to notice a lapsed payment is a real, silent way for a service to go dark.

## Apple Developer account — known single point of failure

Enrolled as an **Individual** account under Poni's personal Apple ID. Chris has no Apple ID and no access at all today.

**Agreed fix (28 Sep 2026), not yet done:**
1. Chris creates an Apple ID (free, a few minutes).
2. Add him as a team Admin on the current account (possible today, even under Individual enrollment) — gives immediate, real working access to builds and App Store Connect.
3. Request conversion of the enrollment from Individual to Organization (needs Hosti's D-U-N-S number — confirm whether one already exists or needs requesting from Dun & Bradstreet).
4. Once converted, transfer the Account Holder role to Chris, or agree who formally holds it — this is self-service once the account is an Organization, with no emergency required.

**If nothing above has happened and the Account Holder becomes unreachable:** Apple does have a process for this (their own documentation explicitly covers the Account Holder being deceased), but it requires direct contact with Apple Developer Support, is not self-service, and will need documentation. Don't assume it's fast.

## Where secrets live (locations only — never values, never here)

- `POSTMARK_API_KEY` — Firebase Secret Manager, referenced via `.runWith({ secrets: [...] })` in Cloud Functions.
- Stripe secret key, webhook secret — [confirm exact location: Firebase Secret Manager vs. `functions/.env` vs. EAS environment variables — not independently confirmed, check before relying on this line].
- EAS Build credentials (Android keystore, iOS signing) — held remotely by Expo's own credential service per `eas.json`'s config; confirm whether a local backup of the Android keystore exists anywhere, since Expo remote credentials still require you to be signed into the correct Expo account.
- `.env` / local-only values — [confirm which, if any, exist outside of what's already captured in Firebase Secret Manager and EAS env vars].

## If something's on fire

**Cut a mobile release:**
```
cd tallyup
git pull
eas build --platform android --profile production   # or ios / ios-store
```
Native rebuild only — OTA (`eas update`) is not the release path (see `ARCHITECTURE.md`, OTA section).

**Kill checkout immediately** (stop anyone from being charged):
Re-disable the purchase buttons in `PricingScreen.tsx` (mobile) and `BillingPage.tsx` (web) — revert to the "checkout reopening shortly" disabled state, redeploy web (`cd web-app && npx vite build && firebase deploy --only hosting`), and ship a mobile build. This is the same disabled state that shipped for most of this project's history, so reverting to it is low-risk.

**Check EAS build quota before assuming a build will succeed:**
The free tier resets monthly. A build can fail purely on quota exhaustion with no code problem at all — check this first if a build fails with no clear error.

**Deploy order, always:** Firestore rules → Cloud Functions → app build. Never the reverse — a function or client expecting a rule that isn't deployed yet will fail in a way that's confusing to debug.

## Who to actually contact

- Stripe: [confirm account owner's login / support contact]
- Postmark: [confirm account owner's login / support contact]
- Firebase / Google Cloud: [confirm — likely Poni's Google account; confirm Chris has at least Viewer/Editor access on the actual Firebase project, not just app-level access]
- Apple Developer Support: only reachable by the current Account Holder, or through the process above
- Google Play Console: Chris has access directly
- Domain (hosti.co.nz via Squarespace): Chris has access directly

## Open items

- Apple Developer account conversion (Individual → Organization) — agreed, not started.
- Secret locations for Stripe keys and any local `.env` files — not independently confirmed, needs a direct check rather than assumption.
- Billing contacts across all paid services — not yet confirmed for any of them.
