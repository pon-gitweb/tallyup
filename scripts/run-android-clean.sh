#!/usr/bin/env bash
set -euo pipefail

echo "[Run] Cleaning node & Expo caches..."
rm -rf node_modules .expo .turbo dist build tsconfig.tsbuildinfo || true

echo "[Run] Installing deps..."
npm install

echo "[Run] Jest sanity + unit tests..."
npx jest --clearCache
npx jest __tests__/smoke/sanityCheck.spec.ts
npx jest __tests__/unit --passWithNoTests

echo "[Run] Expo prebuild (android)..."
npx expo prebuild --platform android

echo "[Run] Ensure gradlew is executable..."
chmod +x android/gradlew || true

echo "[Run] Launching on device..."
npx expo run:android
