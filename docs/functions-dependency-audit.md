# functions/ dependency audit

Report only. Nothing was upgraded, and package.json and lockfiles are unchanged.

## How this was run

- Date: 21 Oct 2026 (NZDT)
- node v22.23.3, npm 10.9.9
- `npm install` in functions/, then `npm audit`. functions/ has no committed lockfile, so these results depend on how the semver ranges in functions/package.json resolved at install time. A fresh install on another day may resolve differently.
- Resolved direct versions: firebase-admin 12.7.0, firebase-functions 5.1.1, nodemailer 9.1.1, csv-parse 5.6.0, jest 29.7.0.

## Totals

46 vulnerable packages: 0 critical, 32 high, 14 moderate, 0 low.

Most of the count comes from a few root causes that npm reports once per package in the chain:

| Root cause | Severity | Packages flagged | Ships to Cloud Functions? |
|---|---|---|---|
| nodemailer advisories | high | 1 | yes |
| node-forge (via firebase-admin) | high | 1 + firebase-admin, firebase-functions | yes |
| uuid < 11.1.1 (via firebase-admin / Google Cloud libs) | moderate | ~8 | yes |
| csv-parse < 7.0.2 | moderate | 1 | yes (but appears unused) |
| braces/micromatch, js-yaml/argparse/sprintf-js (via jest) | high/moderate | ~30 | no, devDependencies only |

## Findings by package

### nodemailer (direct, high)

- Installed 9.1.1. Range `^9.0.3`. Advisories cover `<=10.0.8`:
  - GHSA-6vj9-mwq6-2f5v: process-global DNS cache reuses TLS servername across transports (<10.0.2)
  - GHSA-8vvx-rff5-p5rq: nested recipient arrays cause stack exhaustion (<10.0.2)
  - GHSA-g57g-f23g-4646: quoted local-part gives malformed envelope recipient (>=9.1.0 <10.0.9)
  - GHSA-v53p-9fqp-m79j, GHSA-prgh-xp8r-p3m5: quadratic addressparser DoS
- Reachability: used once, in src/api.ts (supplier registration notification). It creates a single Gmail transport, `to` is hard-coded to poni@hosti.co.nz, and `from` is the env sender. User input (company name and so on) goes only into the subject and the plain-text body, not into address fields. The address-parser DoS and recipient advisories look low-risk here. The cross-transport credential issue needs more than one transport, and the code uses only one. Plausibly reachable, but low practical exposure as the code stands.
- Fix: needs nodemailer 10.0.9 or later, which is a major bump (outside `^9`). npm reports `fixAvailable: true`, but that only holds because npm would move it outside the declared range. Breaking changes in 10.x weren't checked in detail. The usage is a basic `createTransport({ service: "gmail", auth })` + `sendMail({ from, to, subject, text })`, so it's probably low-impact. Check the 10.0.0 changelog, and @types/nodemailer may need to move too.

### node-forge (transitive via firebase-admin, high)

- Installed 1.4.0. GHSA-86w9-cpqp-85rv: RSA PKCS#1 v1.5 signature verification accepts extra nested DigestAlgorithm elements.
- Reachability: firebase-admin 12 uses node-forge for credential and token handling. Whether the vulnerable verification path runs in this code (for example verifyIdToken) isn't clear from our code alone. Uncertain, so treat it as possibly reachable.
- Fix: npm's suggested fix is firebase-admin 14.5.0, a major bump from 12. A newer node-forge may fix this without bumping firebase-admin. It wasn't checked, because that would need an `overrides` entry, which is a package.json change.

### uuid < 11.1.1 (transitive, moderate)

- Paths: firebase-admin → uuid 10.0.0; firebase-admin → @google-cloud/firestore → google-gax → uuid 9.0.1; firebase-admin → @google-cloud/storage → gaxios / teeny-request / retry-request → uuid 9.0.1. This flags firebase-admin, firebase-functions, @google-cloud/firestore, @google-cloud/storage, google-gax, gaxios, teeny-request and retry-request.
- GHSA-w5hq-g745-h8pq: missing buffer bounds check in v3/v5/v6 only when a `buf` argument is passed. These libraries use v4 for request IDs, so it's unlikely to be reachable.
- Side note: src/venueCreate.ts does `import { v4 as uuidv4 } from "uuid"`, but uuid isn't a declared dependency. It currently works only because firebase-admin's uuid 10.0.0 is hoisted. It isn't vulnerable as used (v4, no buf), but it's fragile. It should become a declared dependency in a separate change.
- Fix: comes with firebase-admin 14.5.0 (major). gaxios alone shows a non-breaking fix, but it's pinned underneath storage 7.x, so on its own it doesn't clear the chain.

### csv-parse (direct, moderate)

- Installed 5.6.0. GHSA-8cw4-87c7-c6xx: prototype replacement via the `columns` option (<7.0.2).
- Reachability: no import of csv-parse was found anywhere in functions/src, so it looks unused at runtime (the CSV handling in api.ts appears hand-rolled). Not reachable as far as the code shows.
- Fix: 7.0.3, a major bump (5 to 7). If it really is unused, removing the dependency is the simpler fix. Confirm with Poni first.

### firebase-admin / firebase-functions (direct, high / moderate)

- These are flagged only because of the node-forge and uuid chains above, with no advisory of their own.
- Fix: firebase-admin 12.7.0 → 14.5.0 and firebase-functions 5.1.1 → 7.4.0, both major. firebase-functions 7.4.0 accepts firebase-admin ^11–^14 as a peer. firebase-admin 14 requires node >=22 (engines is already 22).
- Likely breaking areas to check (not verified line by line):
  - firebase-admin 13/14: dropped older Node versions, and some namespaced APIs were deprecated in favour of modular imports (`firebase-admin/firestore`, and so on). This code uses the namespaced `admin.storage()` and `admin.firestore.FieldValue` heavily.
  - firebase-functions 6/7: the default import moved to v2 (v1 APIs live under `firebase-functions/v1`), and config/params changed. This affects every trigger definition. Triggers are off-limits for me, so this needs Poni.

### jest toolchain (devDependencies, high/moderate, about 30 packages)

- Root causes: braces (GHSA-vfj7-8cjw-p6xm, stack-exhaustion DoS) via micromatch, and sprintf-js (GHSA-hp3w-g68c-fv3c) via argparse → js-yaml → @istanbuljs/load-nyc-config. Everything else (@jest/*, jest-*, babel-jest, expect, @types/jest) is just carrying these.
- Reachability: test-time only. Not deployed and not reachable in Cloud Functions.
- Fix: jest 30.5.2 plus @types/jest 30, major. ts-jest would need its 30-compatible release too. Jest 30 changes some config defaults and snapshot formats, and drops older Node, so expect test churn.

## Recommended order

1. nodemailer → 10.x. It's the only high advisory in runtime code with a clear, small surface (one call site). Major bump, but low-risk. Needs a changelog read and a test email.
2. csv-parse. Confirm it's unused, then remove it (or bump to 7 if something does use it).
3. Declare uuid as a direct dependency (fragility, not a vulnerability).
4. firebase-admin 14 + firebase-functions 7 together. This clears node-forge and the whole uuid chain, but it's the biggest change and touches triggers. Uncertain: whether node-forge's vulnerable path is reachable, and how much v1 → v2 trigger migration it forces. This needs Poni to plan, and it can't be validated without a staging project.
5. jest 30 toolchain. Dev-only, lowest risk, do it whenever convenient.
