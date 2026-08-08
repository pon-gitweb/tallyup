/**
 * seedReviewerAccount.ts
 *
 * One-off local admin utility to set up an App Store / Play Store reviewer
 * demo account. NEVER deploy this as a Cloud Function or HTTP endpoint.
 *
 * ── Prerequisites ─────────────────────────────────────────────────────────────
 *
 *   1. Set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON key with
 *      Firestore Admin + Firebase Auth Admin access for tallyup-f1463.
 *      (Download from Firebase Console → Project Settings → Service accounts)
 *
 *   2. Set REVIEWER_PASSWORD — the password for the reviewer account.
 *      Never hardcoded here. Script aborts immediately if not set.
 *
 *   3. Optionally set REVIEWER_EMAIL (default: appreview@hosti.co.nz).
 *
 * ── Compile & run ─────────────────────────────────────────────────────────────
 *
 *   cd functions
 *   npx tsc --project scripts/tsconfig.json
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
 *   REVIEWER_EMAIL=appreview@hosti.co.nz \
 *   REVIEWER_PASSWORD=<secret> \
 *   node scripts/dist/seedReviewerAccount.js
 *
 * ── Safety ────────────────────────────────────────────────────────────────────
 *
 *   - Idempotent: re-running creates nothing if the venue already exists.
 *   - Touches only the reviewer demo venue (identified by isReviewerDemo: true).
 *   - REVIEWER_PASSWORD is never echoed or logged.
 */

import * as admin from "firebase-admin";

// ── Config ─────────────────────────────────────────────────────────────────────

const PROJECT_ID     = "tallyup-f1463";
const REVIEWER_EMAIL = process.env.REVIEWER_EMAIL || "appreview@hosti.co.nz";
const REVIEWER_PASSWORD = process.env.REVIEWER_PASSWORD;

if (!REVIEWER_PASSWORD) {
  console.error("❌  REVIEWER_PASSWORD env var is required. Aborting.");
  process.exit(1);
}

// ── Admin SDK init ─────────────────────────────────────────────────────────────
// applicationDefault() reads GOOGLE_APPLICATION_CREDENTIALS (service account
// key JSON file) or falls back to gcloud ADC if set up.

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: PROJECT_ID,
});

const db   = admin.firestore();
const auth = admin.auth();

// serverTimestamp() for "created now" fields
const now = admin.firestore.FieldValue.serverTimestamp();

// Concrete Timestamp for historical data (last stocktake: 7 days ago)
const SEVEN_DAYS_AGO = admin.firestore.Timestamp.fromDate(
  new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
);

// ── Module IDs ─────────────────────────────────────────────────────────────────
// Source of truth: src/services/billing/modules.ts
// All 4 modules granted — matches PricingScreen's full bundle.

const ALL_MODULES: string[] = [
  "supplier_optimisation",
  "ops_intelligence",
  "performance_incentives",
  "multi_venue",
];

// ── Seed data: Suppliers ───────────────────────────────────────────────────────
// Shape mirrors src/services/suppliers.ts createSupplier() — every field that
// addDoc writes, reproduced exactly (plus createdAt/updatedAt from serverTimestamp).

interface SupplierSeed {
  /** Used as the Firestore doc ID — deterministic, making setDoc idempotent. */
  id: string;
  name: string;
  email: string;
  orderingMethod: "email" | "portal" | "phone";
  defaultLeadDays: number;
}

const SUPPLIERS: SupplierSeed[] = [
  {
    id: "southern-spirits-wine",
    name: "Southern Spirits & Wine",
    email: "orders@southernspirits.co.nz",
    orderingMethod: "email",
    defaultLeadDays: 2,
  },
  {
    id: "db-breweries",
    name: "DB Breweries",
    email: "orders@db.co.nz",
    orderingMethod: "email",
    defaultLeadDays: 1,
  },
];

// ── Seed data: Products ────────────────────────────────────────────────────────
// Shape mirrors src/types/Product.ts and src/services/products.ts createProduct().
// The admin SDK can set any field; we include the core set that the UI reads.

interface ProductSeed {
  /** Used as the Firestore doc ID — deterministic. */
  id: string;
  name: string;
  category: string;   // confirmed categories in use: 'Spirits', 'Beer', 'Wine'
  brand: string;
  size: string;
  unit: string;       // 'bottle', '24pk', etc. — matches Product.unit
  costPrice: number;
  par: number;        // desired shelf level (Product.par)
  packSize: number;   // units per case (Product.packSize)
  supplierKey: string;// maps to SUPPLIERS[].id
}

const PRODUCTS: ProductSeed[] = [
  // ── Spirits (4) ──────────────────────────────────────────────────────────
  {
    id: "jack-daniels-700ml",
    name: "Jack Daniel's Old No.7 700ml",
    category: "Spirits",
    brand: "Jack Daniel's",
    size: "700ml",
    unit: "bottle",
    costPrice: 38.00,
    par: 4,
    packSize: 12,
    supplierKey: "southern-spirits-wine",
  },
  {
    id: "absolut-vodka-700ml",
    name: "Absolut Vodka 700ml",
    category: "Spirits",
    brand: "Absolut",
    size: "700ml",
    unit: "bottle",
    costPrice: 34.00,
    par: 6,
    packSize: 12,
    supplierKey: "southern-spirits-wine",
  },
  {
    id: "tanqueray-gin-700ml",
    name: "Tanqueray London Dry Gin 700ml",
    category: "Spirits",
    brand: "Tanqueray",
    size: "700ml",
    unit: "bottle",
    costPrice: 36.00,
    par: 4,
    packSize: 12,
    supplierKey: "southern-spirits-wine",
  },
  {
    id: "bacardi-rum-700ml",
    name: "Bacardi Superior Rum 700ml",
    category: "Spirits",
    brand: "Bacardi",
    size: "700ml",
    unit: "bottle",
    costPrice: 30.00,
    par: 4,
    packSize: 12,
    supplierKey: "southern-spirits-wine",
  },
  // ── Beer (4) ─────────────────────────────────────────────────────────────
  {
    id: "heineken-330ml-24pk",
    name: "Heineken Lager 330ml 24pk",
    category: "Beer",
    brand: "Heineken",
    size: "330ml",
    unit: "24pk",
    costPrice: 48.00,
    par: 3,
    packSize: 1,   // 1 case = 1 × 24pk (the unit IS the pack)
    supplierKey: "db-breweries",
  },
  {
    id: "steinlager-pure-330ml-24pk",
    name: "Steinlager Pure 330ml 24pk",
    category: "Beer",
    brand: "Steinlager",
    size: "330ml",
    unit: "24pk",
    costPrice: 46.00,
    par: 3,
    packSize: 1,
    supplierKey: "db-breweries",
  },
  {
    id: "corona-355ml-24pk",
    name: "Corona Extra 355ml 24pk",
    category: "Beer",
    brand: "Corona",
    size: "355ml",
    unit: "24pk",
    costPrice: 52.00,
    par: 2,
    packSize: 1,
    supplierKey: "db-breweries",
  },
  {
    id: "tui-eipa-330ml-24pk",
    name: "Tui East India Pale Ale 330ml 24pk",
    category: "Beer",
    brand: "Tui",
    size: "330ml",
    unit: "24pk",
    costPrice: 42.00,
    par: 3,
    packSize: 1,
    supplierKey: "db-breweries",
  },
  // ── Wine (4) ─────────────────────────────────────────────────────────────
  {
    id: "kim-crawford-sav-blanc-750ml",
    name: "Kim Crawford Sauvignon Blanc 750ml",
    category: "Wine",
    brand: "Kim Crawford",
    size: "750ml",
    unit: "bottle",
    costPrice: 15.00,
    par: 6,
    packSize: 12,
    supplierKey: "southern-spirits-wine",
  },
  {
    id: "stoneleigh-pinot-noir-750ml",
    name: "Stoneleigh Pinot Noir 750ml",
    category: "Wine",
    brand: "Stoneleigh",
    size: "750ml",
    unit: "bottle",
    costPrice: 18.00,
    par: 4,
    packSize: 12,
    supplierKey: "southern-spirits-wine",
  },
  {
    id: "villa-maria-rose-750ml",
    name: "Villa Maria Rosé 750ml",
    category: "Wine",
    brand: "Villa Maria",
    size: "750ml",
    unit: "bottle",
    costPrice: 16.00,
    par: 4,
    packSize: 12,
    supplierKey: "southern-spirits-wine",
  },
  {
    id: "oyster-bay-chardonnay-750ml",
    name: "Oyster Bay Chardonnay 750ml",
    category: "Wine",
    brand: "Oyster Bay",
    size: "750ml",
    unit: "bottle",
    costPrice: 14.00,
    par: 6,
    packSize: 12,
    supplierKey: "southern-spirits-wine",
  },
];

// ── Department / Area layout ────────────────────────────────────────────────────
// Dept IDs and area names match CreateVenueScreen.tsx's seedDept() convention:
//   deptId  = department name itself (e.g. "Bar")
//   areaId  = area name itself  (e.g. "Front Bar") — Firestore accepts spaces in IDs
// Maps to: dept -> area -> [productId, ...]

const AREA_LAYOUT: Record<string, Record<string, string[]>> = {
  Bar: {
    "Front Bar": [
      "jack-daniels-700ml",
      "absolut-vodka-700ml",
      "tanqueray-gin-700ml",
      "bacardi-rum-700ml",
      "heineken-330ml-24pk",
      "steinlager-pure-330ml-24pk",
    ],
    "Back Bar": [
      "corona-355ml-24pk",
      "tui-eipa-330ml-24pk",
      "kim-crawford-sav-blanc-750ml",
      "stoneleigh-pinot-noir-750ml",
    ],
    Cellar: [
      "villa-maria-rose-750ml",
      "oyster-bay-chardonnay-750ml",
      "heineken-330ml-24pk",
      "corona-355ml-24pk",
    ],
  },
  Kitchen: {
    // Included so Kitchen surface is not empty, but no items seeded —
    // reviewer can add products there manually to exercise that flow.
    Prep: [],
    "Dry Store": [],
  },
};

// ── Main ────────────────────────────────────────────────────────────────────────

async function main() {
  const created: string[] = [];
  const skipped: string[] = [];

  // ── A. Auth user ────────────────────────────────────────────────────────────
  // getUserByEmail throws auth/user-not-found if missing. Any other error re-throws.

  let uid: string;
  try {
    const existing = await auth.getUserByEmail(REVIEWER_EMAIL);
    uid = existing.uid;
    skipped.push(`Auth user (${REVIEWER_EMAIL}, uid=${uid})`);
  } catch (err: any) {
    if (err?.code !== "auth/user-not-found") throw err;
    const newUser = await auth.createUser({
      email: REVIEWER_EMAIL,
      password: REVIEWER_PASSWORD,
      emailVerified: true,          // skip email-verification gate in HomeRouterScreen
      displayName: "App Reviewer",
    });
    uid = newUser.uid;
    created.push(`Auth user (${REVIEWER_EMAIL}, uid=${uid})`);
  }

  // ── B. Venue ────────────────────────────────────────────────────────────────
  // Identify the reviewer venue by isReviewerDemo: true.
  // Venue shape from:
  //   - firestore.rules allow create block (required: name, ownerUid, venueType, createdAt, updatedAt)
  //   - CreateVenueScreen.tsx setDoc call (also: country, updatedAt)
  //   - createVenueOwnedByUser.ts (also: ownerEmail, openSignup)
  // Admin SDK bypasses rules so additional fields (isReviewerDemo, subscriptionOverride) are safe.

  let venueId: string;
  const existingVenueSnap = await db.collection("venues")
    .where("isReviewerDemo", "==", true)
    .limit(1)
    .get();

  if (!existingVenueSnap.empty) {
    venueId = existingVenueSnap.docs[0].id;
    skipped.push(`Venue (${venueId}) — already exists`);
  } else {
    const vref = db.collection("venues").doc();
    venueId = vref.id;
    await vref.set({
      // Required by firestore.rules allow create
      name: "Demo Bar — App Reviewer",
      ownerUid: uid,
      venueType: "venue",
      createdAt: now,
      updatedAt: now,
      // Additional fields from CreateVenueScreen.tsx
      country: "NZ",
      ownerEmail: REVIEWER_EMAIL,
      openSignup: false,
      // Reviewer-specific markers
      isReviewerDemo: true,
      // Override grants full core_plus + all 4 modules.
      // Written via Admin SDK only — never via a client-writable rule.
      // See firestore.rules SECURITY comment for subscriptionOverride.
      subscriptionOverride: {
        plan: "core_plus",
        modules: ALL_MODULES,
      },
    });
    created.push(`Venue "${venueId}"`);
  }

  // ── C. users/{uid} doc ───────────────────────────────────────────────────────
  // Shape from CreateVenueScreen.tsx (setDoc + updateDoc, fields combined):
  //   venueId, activeVenueId, venueIds, email, createdAt, touchedAt
  // merge: true so re-runs don't clobber existing data.

  await db.collection("users").doc(uid).set(
    {
      venueId,
      activeVenueId: venueId,
      venueIds: admin.firestore.FieldValue.arrayUnion(venueId),
      email: REVIEWER_EMAIL,
      createdAt: now,
      touchedAt: now,
    },
    { merge: true },
  );

  // ── D. members/{uid} doc ─────────────────────────────────────────────────────
  // Shape from:
  //   CreateVenueScreen.tsx: { role: 'owner', createdAt }
  //   createVenueOwnedByUser.ts: { uid, role: 'owner', email, joinedAt }
  // merge: true keeps idempotent.

  await db.doc(`venues/${venueId}/members/${uid}`).set(
    {
      uid,
      role: "owner",
      email: REVIEWER_EMAIL,
      createdAt: now,
      joinedAt: now,
    },
    { merge: true },
  );

  // ── E. Suppliers ─────────────────────────────────────────────────────────────
  // Shape mirrors src/services/suppliers.ts createSupplier() addDoc call exactly.
  // Fixed doc IDs make this idempotent via setDoc (no need to check-then-create).

  const supplierNameMap: Record<string, string> = {};

  for (const s of SUPPLIERS) {
    const sref = db.doc(`venues/${venueId}/suppliers/${s.id}`);
    const snap = await sref.get();
    if (!snap.exists) {
      await sref.set({
        name: s.name,
        email: s.email,
        phone: null,
        accountNumber: null,
        orderingMethod: s.orderingMethod,
        portalUrl: null,
        defaultLeadDays: s.defaultLeadDays,
        orderCutoffLocalTime: null,
        mergeWindowHours: null,
        createdAt: now,
        updatedAt: now,
      });
      created.push(`Supplier: ${s.name}`);
    } else {
      skipped.push(`Supplier: ${s.name}`);
    }
    supplierNameMap[s.id] = s.name;
  }

  // ── F. Products ───────────────────────────────────────────────────────────────
  // Shape from:
  //   src/types/Product.ts (field definitions)
  //   src/services/products.ts createProduct() (which spreads data + adds timestamps)
  // Fixed doc IDs → idempotent.

  for (const p of PRODUCTS) {
    const supplierName = supplierNameMap[p.supplierKey];
    const pref = db.doc(`venues/${venueId}/products/${p.id}`);
    const snap = await pref.get();
    if (!snap.exists) {
      await pref.set({
        name: p.name,
        category: p.category,
        brand: p.brand,
        size: p.size,
        unit: p.unit,
        costPrice: p.costPrice,
        par: p.par,
        packSize: p.packSize,
        supplierId: p.supplierKey,
        supplierName,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      created.push(`Product: ${p.name}`);
    } else {
      skipped.push(`Product: ${p.name}`);
    }
  }

  // ── G. Departments, Areas, Items ──────────────────────────────────────────────
  // Department shape from CreateVenueScreen.tsx seedDept():
  //   { name, createdAt, updatedAt } — merge: true
  // Area shape from CreateVenueScreen.tsx:
  //   { name, startedAt: null, completedAt: null, createdAt, updatedAt }
  // Area item shape from firestore.rules isInductedCreate() and area items observed
  // in StockTakeAreaInventoryScreen.tsx / seedDefaults.ts:
  //   name, unit, supplierName, supplierId, productId, productName,
  //   category, brand, size, inductionStatus, inductionSource,
  //   countingUnit, caseSize, costPrice, parLevel,
  //   lastCount, lastCountAt, lastCountBy, lastCountByName,
  //   barcode, barcodeNumber, createdAt, updatedAt
  // lastCount is set to par level (healthy-looking stock) dated 7 days ago,
  // so reports/history screens have real counts to display without starting a new
  // stocktake first. Areas are left open (completedAt: null) so the reviewer can
  // perform a fresh stocktake immediately.

  let departmentsCreated = 0;
  let areasCreated = 0;
  let itemsSeeded = 0;

  for (const [deptId, areas] of Object.entries(AREA_LAYOUT)) {
    const dref = db.doc(`venues/${venueId}/departments/${deptId}`);
    const dsnap = await dref.get();
    if (!dsnap.exists) {
      await dref.set({ name: deptId, createdAt: now, updatedAt: now });
      departmentsCreated++;
    }

    for (const [areaName, productIds] of Object.entries(areas)) {
      // Area ID = area name as-is (matches CreateVenueScreen.tsx convention)
      const aref = db.doc(`venues/${venueId}/departments/${deptId}/areas/${areaName}`);
      const asnap = await aref.get();
      if (!asnap.exists) {
        await aref.set({
          name: areaName,
          startedAt: null,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
        });
        areasCreated++;
      }

      for (const productId of productIds) {
        const product = PRODUCTS.find((p) => p.id === productId)!;
        const supplierName = supplierNameMap[product.supplierKey];
        const iref = db.doc(
          `venues/${venueId}/departments/${deptId}/areas/${areaName}/items/${productId}`,
        );
        // merge: true so re-runs update rather than fail
        await iref.set(
          {
            name: product.name,
            unit: product.unit,
            supplierName,
            supplierId: product.supplierKey,
            productId,
            productName: product.name,
            category: product.category,
            brand: product.brand,
            size: product.size,
            inductionStatus: "complete",
            inductionSource: "bulk-assign",
            countingUnit: null,
            // caseSize: how many individual bottles per case (null for units that ARE a pack)
            caseSize: product.packSize > 1 ? product.packSize : null,
            costPrice: product.costPrice,
            parLevel: product.par,
            // lastCount at par = healthy-looking stock from 7 days ago
            lastCount: product.par,
            lastCountAt: SEVEN_DAYS_AGO,
            lastCountBy: uid,
            lastCountByName: "App Reviewer",
            barcode: null,
            barcodeNumber: null,
            createdAt: now,
            updatedAt: now,
          },
          { merge: true },
        );
        itemsSeeded++;
      }
    }
  }

  if (departmentsCreated > 0) {
    created.push(
      `Departments: ${Object.keys(AREA_LAYOUT).join(", ")} (${departmentsCreated} new)`,
    );
  }
  if (areasCreated > 0) {
    const allAreaNames = Object.values(AREA_LAYOUT).flatMap((a) => Object.keys(a));
    created.push(`Areas: ${allAreaNames.join(", ")} (${areasCreated} new)`);
  }
  if (itemsSeeded > 0) {
    created.push(`Area items seeded/refreshed: ${itemsSeeded}`);
  }

  // ── H. StockTake record ───────────────────────────────────────────────────────
  // Shape from StockTakeAreaInventoryScreen.tsx addDoc call (line 2318):
  //   completedAt, completedBy, source, totalItems, durationMinutes, stockValue, venueId
  // Using a deterministic doc ID ("seed-initial") makes this idempotent.

  const stocktakeRef = db.doc(`venues/${venueId}/stockTakes/seed-initial`);
  const stocktakeSnap = await stocktakeRef.get();
  if (!stocktakeSnap.exists) {
    const totalItems = PRODUCTS.length;
    // stockValue = sum(costPrice × par) across all products — matches how the screen
    // computes it: lastCount × costPrice per item
    const stockValue = PRODUCTS.reduce(
      (sum, p) => sum + p.costPrice * p.par,
      0,
    );
    await stocktakeRef.set({
      completedAt: SEVEN_DAYS_AGO,
      completedBy: uid,
      source: "venue-wide-cycle",
      totalItems,
      durationMinutes: 45,
      stockValue: Math.round(stockValue * 100) / 100,
      venueId,
      note: "Seeded by seedReviewerAccount script",
    });
    created.push(
      `StockTake record (${totalItems} items, $${Math.round(stockValue)} stock value, 7 days ago)`,
    );
  } else {
    skipped.push("StockTake record (seed-initial) — already exists");
  }

  // ── Summary ───────────────────────────────────────────────────────────────────

  console.log("\n✅  Reviewer demo account seeded successfully\n");
  console.log(`   Venue ID : ${venueId}`);
  console.log(`   Email    : ${REVIEWER_EMAIL}`);
  console.log(`   UID      : ${uid}`);

  if (created.length) {
    console.log(`\n📋  Created:`);
    created.forEach((s) => console.log(`   + ${s}`));
  }
  if (skipped.length) {
    console.log(`\n♻️   Already existed (skipped):`);
    skipped.forEach((s) => console.log(`   = ${s}`));
  }

  console.log("\n📱  App Store / Play Console review notes:");
  console.log(`   Email    : ${REVIEWER_EMAIL}`);
  console.log(
    `   Password : [the value you passed as REVIEWER_PASSWORD — not echoed here]`,
  );
  console.log(
    `\n⚠️   subscriptionOverride is set via Admin SDK bypass (core_plus + all 4 modules).`,
  );
  console.log(
    `    Never add a client-writable Firestore rule for this field.\n`,
  );
}

main().catch((err) => {
  console.error("❌  Seed failed:", err?.message || err);
  process.exit(1);
});
