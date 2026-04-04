# Hosti-Stock — Architecture Guide

For any developer picking this up: read this first. 10 minutes here saves hours of confusion.

## What this is
Hosti-Stock is a hospitality inventory and stocktake app for bars, cafes, restaurants and casual dining venues in NZ and Australia. It replaces spreadsheets with a fast, AI-powered system that works offline.

## Tech Stack
- Framework: Expo SDK 53, React Native 0.79.6, React 19
- Backend: Firebase 12 (Firestore, Auth, Storage, Functions)
- AI: Anthropic Claude via Firebase Functions (functions/src/api.ts)
- Build: EAS Build (Android AAB for Play Store)
- Package ID: com.anonymous.tallyup (permanent, cannot change)
- Play Store: StackMosaic developer account

## The Real Screens (used by navigation)
- src/screens/DashboardScreen.tsx
- src/screens/stock/StockTakeAreaInventoryScreen.tsx
- src/screens/orders/OrderEditorScreen.tsx
- src/screens/settings/SettingsScreen.tsx
- src/screens/auth/LoginScreen.tsx
- DEAD FILES are in src/_archive/ — do not import from there

## Navigation
Single source of truth: src/navigation/stacks/MainStack.tsx
All routes are registered here. If a screen is not here, it is not reachable.

## Feature Flags (src/config/features.ts)
- SUPPLIER_PORTAL: false — flip to true to unlock supplier login and portal
- XERO_INTEGRATION: false — flip to true when Xero app is certified
- BILLING_ACTIVE: false — flip to true when Stripe backend is ready

## Firestore Structure
venues/{venueId}
  suppliers/{supplierId}
  products/{productId}
  departments/{deptId}/areas/{areaId}/items/{itemId}
  orders/{orderId}/lines/{lineId}
  aiUsage/{YYYY-MM}
  settings/theme
  settings/reportPreferences
supplierAccounts/{supplierId}/catalogue, orders, specials
errorLogs/{logId}

## AI Architecture
All Claude calls go through Firebase Functions (/api).
Never call Anthropic directly from the client.
Endpoints: variance-explain, suggest-orders, budget-suggest, photo-count, extract-inventory
Usage is tracked per venue per month in aiUsage collection.

## Offline Mode
Firestore offline persistence enabled in src/services/firebase.ts
Users must authenticate once online. After that all reads/writes work offline.
AI features require internet (Claude API calls).

## EAS Build Notes
- versionCode managed by EAS remote — use: eas build:version:set
- Do NOT edit android/app/build.gradle versionCode manually
- Build profile: play-aab for Play Store
- The android.versionCode warning in app.json is safe to ignore

## What is Stubbed or Behind Feature Flags
- src/services/shelfScan/ — shelf scanning (future)
- src/screens/supplier/ — supplier portal (SUPPLIER_PORTAL flag)
- src/services/integrations/xero/ — Xero (XERO_INTEGRATION flag)
- Stripe billing — architecture ready, backend not built

## Common Gotchas
1. Dead files are in src/_archive/ — do not import from there
2. Use useColours() hook for theme colours, not hardcoded hex values
3. Firebase Functions deploy: cd functions && firebase deploy --only functions:api
4. BLE permissions must be in app.json for Bluetooth to work
5. Two services/suppliers files exist — use services/suppliers/index.ts
6. The app works offline after first login — do not add online-only guards
