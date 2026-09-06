#!/usr/bin/env node
/**
 * 3a-v: Audit orphaned supplier references from past hard-deletes.
 *
 * For every supplierId referenced in invoiceHistory and priceChangeFlags
 * across all venues, checks whether a corresponding document still exists
 * in that venue's suppliers collection.
 *
 * Output: count of orphaned references per venue, grouped and sorted.
 * Action: diagnostic only — no writes, no repairs.
 *
 * Usage: GOOGLE_APPLICATION_CREDENTIALS=<svc-acct.json> node audit-orphaned-supplier-refs.js
 */

const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

async function main() {
  console.log('3a-v: Auditing orphaned supplier references...\n');

  const venuesSnap = await db.collection('venues').get();
  const venues = venuesSnap.docs.map(d => ({ id: d.id, name: (d.data().name || d.id) }));
  console.log(`Found ${venues.length} venues.\n`);

  // Results: venueId → { venueName, orphaned: [{ collection, docId, supplierId }] }
  const results = [];

  for (const venue of venues) {
    const { id: venueId, name: venueName } = venue;
    const orphaned = [];

    // 1. Load all known supplier IDs for this venue
    const suppliersSnap = await db
      .collection('venues').doc(venueId).collection('suppliers')
      .get();
    const knownSupplierIds = new Set(suppliersSnap.docs.map(d => d.id));

    // 2. Check invoiceHistory (nested: products/<productId>/suppliers/<suppId>/invoiceHistory)
    //    We scan via the products collection
    const productsSnap = await db
      .collection('venues').doc(venueId).collection('products')
      .get();

    for (const productDoc of productsSnap.docs) {
      const productSuppSnap = await db
        .collection('venues').doc(venueId)
        .collection('products').doc(productDoc.id)
        .collection('suppliers')
        .get();

      for (const suppDoc of productSuppSnap.docs) {
        // The subcollection doc ID is the supplierId
        const suppId = suppDoc.id;
        if (!knownSupplierIds.has(suppId)) {
          // Check invoiceHistory docs exist (skip if no history)
          const invHistSnap = await db
            .collection('venues').doc(venueId)
            .collection('products').doc(productDoc.id)
            .collection('suppliers').doc(suppId)
            .collection('invoiceHistory')
            .limit(1)
            .get();
          if (!invHistSnap.empty) {
            orphaned.push({
              collection: `products/${productDoc.id}/suppliers/${suppId}/invoiceHistory`,
              supplierId: suppId,
              recordCount: '1+',
            });
          }
        }
      }
    }

    // 3. Check priceChangeFlags for dangling supplierIds
    const flagsSnap = await db
      .collection('venues').doc(venueId).collection('priceChangeFlags')
      .get();

    const flagsBySupplier = {};
    for (const flagDoc of flagsSnap.docs) {
      const data = flagDoc.data();
      const suppId = data.supplierId || data.supplier?.id || null;
      if (!suppId) continue;
      if (!knownSupplierIds.has(suppId)) {
        flagsBySupplier[suppId] = (flagsBySupplier[suppId] || 0) + 1;
      }
    }
    for (const [suppId, count] of Object.entries(flagsBySupplier)) {
      orphaned.push({
        collection: 'priceChangeFlags',
        supplierId: suppId,
        recordCount: count,
      });
    }

    if (orphaned.length > 0) {
      results.push({ venueId, venueName, orphaned });
    }
  }

  // Report
  if (results.length === 0) {
    console.log('✓ No orphaned supplier references found across any venue.\n');
  } else {
    let totalOrphaned = 0;
    for (const { venueId, venueName, orphaned } of results) {
      console.log(`Venue: ${venueName} (${venueId})`);
      for (const ref of orphaned) {
        console.log(`  ⚠ supplierId=${ref.supplierId}  in ${ref.collection}  (${ref.recordCount} record(s))`);
        totalOrphaned++;
      }
      console.log();
    }
    console.log(`Total orphaned references: ${totalOrphaned} across ${results.length} venue(s).`);
    console.log('\nDiagnostic only — no data was modified.\n');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
