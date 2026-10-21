# Terms and Privacy text audit

Report only. No wording was changed anywhere. Based on `origin/main` at 343d396 (2026-10-21). Everything here comes from the repository. Nothing was checked against the Firebase console or the live sites.

## 1. Where the text lives and how it is reached

| # | Copy | Reachable from |
|---|---|---|
| A | `src/screens/settings/TermsScreen.tsx` ("Terms of Service", 12 sections) | Registered as route `Terms` in `src/navigation/stacks/MainStack.tsx:305`. No `navigate('Terms')` caller was found in `src/`, so it may be unreachable from the UI |
| B | `src/screens/legal/TermsScreen.tsx` ("Terms of Use", placeholder) | Not registered in any navigator. `src/screens/AboutScreen.tsx:32` navigates to `DevTerms`, but no `DevTerms` route exists, and `AboutScreen` itself is not registered. Appears unreachable |
| C | `src/screens/legal/PrivacyScreen.tsx` ("Privacy Policy", placeholder) | Same as B: navigated to as `DevPrivacy` (`AboutScreen.tsx:33`), and that route is not registered |
| D | `web/terms/index.html` ("Terms of Use", 13 sections) | Firebase Hosting: `firebase.json` sets `hosting.public` to `web`, so this is served at `/terms/` on the tallyup-f1463 Hosting site (default domain `tallyup-f1463.web.app` per `ARCHITECTURE.md:18`). The only rewrite is `/app/**`, so `/terms/` is served as a static file. No in-repo link to it was found |
| E | `web/privacy/index.html` ("Privacy Policy", 11 sections) | Same as D, at `/privacy/`. No in-repo link found |
| F | `src/components/LegalFooter.tsx` (one-line consent footer) | Rendered in `SettingsScreen.tsx:1436` and `AboutScreen.tsx:36` |
| G | External links in `src/screens/settings/SettingsScreen.tsx:1302` (`https://www.hosti.co.nz/legal/privacy`) and `:1308` (`https://www.hosti.co.nz/legal/terms`) | Settings, Legal section. The content of those pages is not in this repo |

`web-app/` contains no Terms or Privacy text. The only "terms" matches there are unrelated: a contract-notes placeholder and CSV header detection.

The in-app copy A links to a third URL: `https://www.hosti.co.nz/privacy-policy` (`settings/TermsScreen.tsx:62`). Settings uses `/legal/privacy`. Both are on www.hosti.co.nz and neither is in the repo.

## 2. Differences between copies

B and C are one-paragraph placeholders. B says "These terms are placeholder scaffolding for V2. Replace with your real legal copy." (`legal/TermsScreen.tsx:16`). They are not compared further.

A (in-app) against D (web):

| Topic | A: settings/TermsScreen.tsx | D: web/terms/index.html |
|---|---|---|
| Title | Terms of Service | Terms of Use |
| Product name | Hosti | Hosti-STOCK |
| Entity | Not named ("Hosti") | "Stack Mosaic Ltd / Hosti Ltd" |
| Acceptance | s1 | Intro paragraph |
| Eligibility, age 18+, accounts, security | Absent | s1.1 to s1.4 |
| Service description | s2 | s2.1 (permitted use list) |
| Prohibited use | s5 (short) | s2.2 (longer: bots, malicious code, auth bypass) |
| Data ownership | s3: "You own your data", stored in "Google Firebase (us-central1)", deletion via office@hosti.co.nz | s3: data controlled by the venue, "we act primarily as a data processor". No region given |
| Uploaded files | Absent | s4 |
| AI features | s4 | s5 (adds "not used to train public models") |
| Third-party services | Absent | s6 (Firebase, cloud hosting, AI/LLM providers) |
| Updates and availability | Absent | s7 |
| Pricing | s6 "Free Access Period": 30 days notice before charges | s8 "Fees & Billing": paid features possible, beta may be free |
| Supplier portal | s7 | Absent |
| Liability cap | s8: fees paid in the preceding 3 months | s9.2: amount paid in the preceding 12 months |
| Termination | Absent | s10 |
| Changes to terms | Absent | s11 |
| Privacy reference | s9: www.hosti.co.nz/privacy-policy | None (the separate page E exists) |
| Governing law | s10: New Zealand | s12: New Zealand, non-exclusive jurisdiction |
| Contact | s11: office@hosti.co.nz, www.hosti.co.nz | s13: support@stackmosaic.com |
| Fair use (AI scanning limits) | s12 | Absent |

## 3. Effective and last-updated dates

| Copy | Date shown | Hardcoded? |
|---|---|---|
| A | "Last updated: April 2026" (`settings/TermsScreen.tsx:25`) | Yes, string literal |
| B, C | None | n/a |
| D | "Last updated: 16 November 2025" (`web/terms/index.html:152`) | Yes |
| E | "Last updated: 16 November 2025" (`web/privacy/index.html:158`) | Yes |
| F | Copyright year from `new Date().getFullYear()` (`LegalFooter.tsx:12`) | Dynamic |
| D, E footers | Copyright year filled by JS `new Date().getFullYear()` | Dynamic |

A and D disagree on the last-updated date (April 2026 against 16 November 2025). Neither copy states an effective date separately from the last-updated date.

## 4. Data location statements and declared regions

### Statements in the legal text (quoted exactly)

- `src/screens/settings/TermsScreen.tsx:38`: "You own your data. We store it securely in Google Firebase (us-central1)."
- `web/terms/index.html:219`: "Google Firebase (Authentication, Firestore, Storage, Cloud Functions)."
- `web/privacy/index.html:175`: "Where this is stored: Firebase Authentication and Firestore."
- `web/privacy/index.html:188`: "Where this is stored: Firestore and Cloud Storage (for related documents)."
- `web/privacy/index.html:198`: "Where this is stored: Firebase Storage."
- `web/privacy/index.html:243`: "Google Firebase (Authentication, Firestore, Storage, Cloud Functions)."
- `web/privacy/index.html:261`: "Data may be stored or processed in data centres located outside New Zealand (for example, in Australia, the United States, or other regions used by our infrastructure providers)."

### What the repo declares

| Item | Declared location | Source |
|---|---|---|
| Firebase project | `tallyup-f1463` | `.firebaserc` |
| Firestore database location | Not declared in the repo | `firebase.json` names only the rules and indexes files |
| Storage bucket name | `tallyup-f1463.appspot.com` (web-app). The mobile app reads `EXPO_PUBLIC_FB_STORAGE_BUCKET`, which is not set in any tracked file | `web-app/src/firebase.ts:15`, `src/services/firebase.ts:11` |
| Storage bucket location | Not declared in the repo | n/a |
| Cloud Functions, us-central1 | 22 explicit region declarations, e.g. `api.ts:6150`, `api.ts:7873`, `index.ts:73`, `invites.ts:65`, `analytics.ts:12`, `ocrInvoicePhoto.ts:1551`, `weeklySummary.ts:454`, `legacyFunctions.ts` (several) | `functions/src` |
| Cloud Functions, australia-southeast1 | 8 explicit region declarations: `trial.ts` (REGION constant at line 4, used 3 times), `trialReminder.ts:108`, `createVenueOwnedByUser.ts:44`, `snapshotNeutraliseTrigger.ts` (REGION constant at line 5, used at 200 and 230), `legacyFunctions.ts:359` | `functions/src` |
| Main API endpoint used by the clients | `https://us-central1-tallyup-f1463.cloudfunctions.net/api` | `app.json:63-64`, `eas.json` (4 profiles), `src/config/ai.ts:5`, `web-app/src/services/*.ts` |
| Hosting | Firebase Hosting (`web/`). No region concept | `firebase.json` |

### Side by side

- Copy A says data is stored in us-central1. The repo shows us-central1 only for most Cloud Functions, which process data rather than store it. The repo does not declare where Firestore or the Storage bucket actually live, so A's claim cannot be confirmed or refuted from the repo. Our earlier non-repo read (Firestore and Storage in australia-southeast1) would contradict it. That needs checking in the console, which was out of scope here.
- Copies D and E name no region. E's international transfers clause mentions Australia and the United States, which matches the two function regions declared in the repo.

## 5. Other possibly out-of-date facts (flagged, not fixed)

- **Entity:** D and E name "Stack Mosaic Ltd / Hosti Ltd" (`web/terms/index.html:154, 274, 282`; `web/privacy/index.html:160, 257, 303, 311`), and their meta descriptions say "Stack Mosaic / Hosti Ltd" (line 7 in both). The footer F says "Hosti Ltd" (`LegalFooter.tsx:12`). A names no entity. HOSTI LIMITED does not appear anywhere.
- **Contact:** D and E use `support@stackmosaic.com` (`web/terms/index.html:275`, `web/privacy/index.html:304`). A uses `office@hosti.co.nz` (lines 38, 70, 85). There are two different contact addresses across the copies.
- **Product name:** D, E and F use "Hosti-STOCK" or "HOSTI-STOCK" (`LegalFooter.tsx:10`). A uses "Hosti".
- **Privacy URL:** there are three different targets: `www.hosti.co.nz/privacy-policy` (A), `www.hosti.co.nz/legal/privacy` (Settings) and `/privacy/` on Firebase Hosting (E).
- **Pricing:** A describes a complimentary period with 30 days notice. D describes beta access that may be free. Neither mentions current paid plans or add-ons, although the repo contains Stripe billing (`web-app/src/pages/BillingPage.tsx`).
- **Liability cap:** 3 months in A against 12 months in D.
- **Features:** D and E do not mention the supplier portal, fair-use limits, POS or sales imports, or festival features. A does not mention uploaded files, third-party processors or termination.
- **Placeholders:** B and C still contain V2 placeholder text.

## Unsure

- Whether route `Terms` (copy A) is reachable through a path the text search missed, such as a computed route name.
- What www.hosti.co.nz/legal/* currently shows. It is outside the repo.
- Where Firestore and Storage live. The repo cannot show this.

Jace (Chris's dev agent)
