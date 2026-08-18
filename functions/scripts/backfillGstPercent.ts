/**
 * backfillGstPercent.ts
 *
 * One-off local admin utility: writes gstPercent on every venue product
 * that is currently null or missing.  Rule: AU venues → 10, all others → 15.
 *
 * NEVER deploy this as a Cloud Function or HTTP endpoint.
 *
 * ── Prerequisites ─────────────────────────────────────────────────────────────
 *
 *   Set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON key with
 *   Firestore Admin access for tallyup-f1463.
 *   (Download from Firebase Console → Project Settings → Service accounts)
 *
 * ── Compile & run ─────────────────────────────────────────────────────────────
 *
 *   cd functions
 *   npx tsc --project scripts/tsconfig.json
 *
 *   # Dry run (default — prints what would be changed, writes nothing):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
 *   node scripts/dist/backfillGstPercent.js
 *
 *   # Real run (actually writes to Firestore):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
 *   node scripts/dist/backfillGstPercent.js --confirm
 *
 * ── Safety ────────────────────────────────────────────────────────────────────
 *
 *   - Only touches products where gstPercent is null or absent.
 *   - Products with an existing gstPercent value (including 0) are never modified.
 *   - Dry-run mode (default) prints everything it would do and exits cleanly.
 *   - Writes are batched in chunks of 450 (well under Firestore's 500-op limit).
 */

import * as admin from "firebase-admin";

// ── Config ─────────────────────────────────────────────────────────────────────

const PROJECT_ID = "tallyup-f1463";
const DRY_RUN = !process.argv.includes("--confirm");

// ── Admin SDK init ─────────────────────────────────────────────────────────────
// applicationDefault() reads GOOGLE_APPLICATION_CREDENTIALS (service account
// key JSON file) or falls back to gcloud ADC if set up.

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: PROJECT_ID,
});

const db = admin.firestore();

// ── Main ────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    DRY_RUN
      ? "\n🔍  DRY RUN — no writes will be made. Pass --confirm to apply.\n"
      : "\n✍️   LIVE RUN — writing to Firestore.\n",
  );

  const venuesSnap = await db.collection("venues").get();
  console.log(`Found ${venuesSnap.size} venue(s).\n`);

  let totalVenuesWithGap = 0;
  let totalProductsToUpdate = 0;
  let totalProductsWritten = 0;

  for (const venueDoc of venuesSnap.docs) {
    const venueId = venueDoc.id;
    const venueData = venueDoc.data();
    const country: string = (venueData.country as string) || "NZ";
    const gstPercent = country === "AU" ? 10 : 15;
    const venueName: string = (venueData.name as string) || venueId;

    // Firestore treats a missing field and an explicit null identically for
    // == null queries, so this catches both "not yet set" and "explicitly null".
    const productsSnap = await db
      .collection(`venues/${venueId}/products`)
      .where("gstPercent", "==", null)
      .get();

    if (productsSnap.empty) continue;

    totalVenuesWithGap++;
    totalProductsToUpdate += productsSnap.size;

    console.log(
      `  Venue: "${venueName}" (${venueId})` +
      `  country=${country}` +
      `  gstPercent→${gstPercent}` +
      `  products to update: ${productsSnap.size}`,
    );

    if (DRY_RUN) {
      for (const pdoc of productsSnap.docs) {
        const pname = (pdoc.data().name as string) || "(no name)";
        console.log(`    [dry] ${pdoc.id}  "${pname}"`);
      }
    } else {
      // Batch writes — Firestore max 500 ops per batch; use 450 for headroom.
      const BATCH_SIZE = 450;
      const docs = productsSnap.docs;
      for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const chunk = docs.slice(i, i + BATCH_SIZE);
        for (const pdoc of chunk) {
          batch.update(pdoc.ref, {
            gstPercent,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        await batch.commit();
        console.log(
          `    ✓ Wrote batch of ${chunk.length} product(s) for "${venueName}"`,
        );
        totalProductsWritten += chunk.length;
      }
    }
  }

  console.log("\n────────────────────────────────────────────────");
  if (DRY_RUN) {
    console.log(`DRY RUN complete.`);
    console.log(`  Venues with products to update : ${totalVenuesWithGap}`);
    console.log(`  Products that would be updated : ${totalProductsToUpdate}`);
    console.log(`\n  Run with --confirm to apply.\n`);
  } else {
    console.log(`LIVE RUN complete.`);
    console.log(`  Venues updated  : ${totalVenuesWithGap}`);
    console.log(`  Products written: ${totalProductsWritten}`);
    console.log("");
  }
}

main().catch((err) => {
  console.error("❌  Backfill failed:", err?.message || err);
  process.exit(1);
});
