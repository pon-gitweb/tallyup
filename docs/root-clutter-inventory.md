# Root clutter inventory

Report only. Nothing has been deleted or moved. Based on `origin/main` at 3b4d4fc (2026-10-21).

Method: every root entry in `ls -A` was checked against `git ls-files`. Candidates were searched with `rg` across the repo, excluding `node_modules`, `.git` and `package-lock.json`. The search covered code, `package.json` scripts, `app.json`, `eas.json`, `firebase.json`, the jest, tsconfig, babel and metro configs, `knip.json`, `.gitignore` and the docs. There is no `.github/` directory, so no CI workflows were checked. "Last touched" is the date of the last commit to that path. Most paths show 2026-09-27, which looks like a bulk history event (for example a re-import), so treat that date as weak evidence of activity.

All entries are tracked unless stated otherwise. `node_modules/` is the only untracked, ignored root entry.

## Core (keep)

| Item | Reason |
|---|---|
| `package.json`, `package-lock.json`, `.npmrc` | Root package and lockfile |
| `App.tsx`, `index.js`, `src/` | App entry and source |
| `app.json`, `eas.json`, `babel.config.js`, `metro.config.js` | Expo, EAS and bundler config |
| `tsconfig.json` | TypeScript config |
| `android/`, `ios/`, `assets/` | Native projects and assets |
| `functions/` | Cloud Functions source (`firebase.json` functions.source) |
| `web/` | Firebase Hosting public dir (`firebase.json` hosting.public) |
| `web-app/` | Web dashboard source. Referenced by sync check scripts and tests. Last touched 2026-10-20 |
| `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`, `storage.rules` | Firebase config, referenced by `firebase.json` and `rules-tests/` |
| `rules-tests/` | `npm run test:rules` |
| `scripts/` | npm scripts and preflight |
| `__tests__/` | Unit tests run by `npm test` |
| `__mocks__/` | Jest picks up root `__mocks__` next to `node_modules` automatically (expo-constants, expo-virtual-env) |
| `jest.unit.config.js`, `jest.unit.config.base.js`, `jest.setup.js` | `npm test` config chain |
| `jest.config.js` | Bridge so that a bare `npx jest` uses the unit config (stated in the file) |
| `docs/`, `README.md`, `ARCHITECTURE.md`, `CONTINUITY.md` | Documentation |
| `.gitignore`, `.fingerprintignore`, `.last-android-build-fingerprint` | Fingerprint files: the last one is used by `scripts/check-ota-safe.sh`, and `.fingerprintignore` is read implicitly by `@expo/fingerprint` (last touched 2026-10-15) |
| `sentry.properties` | No explicit reference, but the `@sentry/react-native` tooling reads it implicitly (plugin in `app.json`) |
| `screenshots/` | `src/screens/auth/LandingScreen.tsx` requires `01_dashboard.png` and `02_reports.png`. Also used for Play Store assets |
| `catalog_pdfs/`, `supplier_catalogs/` | Inputs for the `scripts/catalog/*` npm scripts (`catalog:parse`, `catalog:preview`, `catalog:import`) |
| `knip.json`, `tsconfig.knip.json` | Knip config (`knip.json` references `tsconfig.knip.json`). No npm script, so it is run manually |

## Candidates

| Item | Type | Last touched | References found | Recommendation |
|---|---|---|---|---|
| `App.js.legacy` | file | 2026-09-27 | None | Safe to delete: superseded by `App.tsx`, nothing references it |
| `fix_manual_receive.js` | file | 2026-09-27 | None | Safe to delete: a one-off code snippet for `OrderDetailScreen.tsx`, not a runnable module |
| `manual_receive_fix.patch` | file | 2026-09-27 | None | Archive: a one-off patch. Confirm it was applied before deleting it |
| `orderdetail_fix.patch` | file | 2026-09-27 | None | Archive: as above |
| `rules.fastReceives.patch.txt` | file | 2026-09-27 | None | Archive: a rules patch. Confirm it is reflected in `firestore.rules` |
| `_backup_20251028/` | dir (2 `.broken` files) | 2026-09-27 | None | Safe to delete: broken screen copies, kept in git history |
| `backups/` | dir (67 files) | 2026-09-27 | Ignored by `.gitignore`, jest, tsconfig and knip. `check:no-backups` exists to deny backups | Safe to delete (untrack): it is in `.gitignore` but still tracked, holds timestamped screen copies, and the tooling already excludes it |
| `structure.txt` | file | 2026-09-27 | None (it lists paths itself) | Safe to delete: a stale file-tree dump |
| `dump-sprint-files.sh` | file | 2026-09-27 | None. No npm script | Archive: a manual helper that cats source files for sharing |
| `assign` | file (0 bytes) | 2026-09-27 | None. The rg hits are for the word "assign" | Safe to delete: an empty file, probably a stray shell redirect |
| `sample_products.csv` | file | 2026-09-27 | None | Unsure: possibly an import sample. It differs from `test-data/sample_products.csv` |
| `test-data/` | dir (1 CSV) | 2026-09-27 | None | Unsure: may be used by hand for imports |
| `tests-skipped/` | dir (2 files) | 2026-09-27 | Excluded in jest, knip and `scripts/check-dep.sh` | Archive: intentionally parked tests |
| `jest.expo.config.js` | file | 2026-09-27 | No npm script or file reference | Unsure: may be an alternate config someone runs by hand |
| `tsconfig.jest.json` | file | 2026-09-27 | Only `structure.txt` | Unsure: no jest transform references it. It may be picked up by ts-jest or an editor |
| `jest/` | dir (`__mocks__`, `mocks`) | 2026-09-27 | No config references `jest/` mocks | Unsure: possibly legacy mocks. Verify before removing |
| `test/` | dir (`jest.setup.js`, `mocks`) | 2026-09-27 | No config references it (the root `jest.setup.js` is used instead) | Unsure: looks like a duplicate setup |
| `firebase/` | dir (`firestore.rules`) | 2026-09-27 | Only `dump-sprint-files.sh`. `firebase.json` and `rules-tests` use the root `firestore.rules` | Archive: a stale copy that differs from the deployed root rules |
| `backend/` | dir (`functions/`) | 2026-09-27 | Excluded in jest and knip. `ARCHITECTURE.md` says its status is unchecked | Unsure: a second functions tree, not referenced by `firebase.json` |
| `server/` | dir (Express `server.js`, payments, support) | 2026-09-27 | Mentioned in `ARCHITECTURE.md`. Not in `firebase.json` | Unsure: may be deployed separately. Needs an owner decision |
| `_archive/` | dir (290 files) | 2026-09-27 | Excluded in `.gitignore`, tsconfig, jest and knip | Keep: already the designated archive |
| `.claude/` | dir (`settings.json`) | 2026-09-27 | Claude Code settings. The lock file is ignored | Keep: tool config |

## Summary

- Keep (45): all core items above plus `_archive/` and `.claude/`.
- Archive (6): `manual_receive_fix.patch`, `orderdetail_fix.patch`, `rules.fastReceives.patch.txt`, `dump-sprint-files.sh`, `tests-skipped/`, `firebase/`.
- Safe to delete (6): `App.js.legacy`, `fix_manual_receive.js`, `_backup_20251028/`, `backups/`, `structure.txt`, `assign`.
- Unsure (8): `sample_products.csv`, `test-data/`, `jest.expo.config.js`, `tsconfig.jest.json`, `jest/`, `test/`, `backend/`, `server/`.

Notes: `backups/` is in `.gitignore` but tracked, so ignoring it has no effect until it is untracked. The 2026-09-27 dates are uniform and may not reflect real last use.
