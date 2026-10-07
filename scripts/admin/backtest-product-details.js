#!/usr/bin/env node
/**
 * backtest-product-details.js — read-only.
 * Prints name, unit, packSize, caseSize, caseCost, costPrice, costPriceSource
 * for the pack-name products found in the backtest (partial venue IDs: 1OJnh3Mt, O9pChydj).
 * No writes.
 */
'use strict';

const admin = require('firebase-admin');

const NAMES_TO_FIND = [
  'Corona Extra 355ml 24pk',
  'Heineken Lager 330ml 24pk',
  'Steinlager Pure 330ml 24pk',
  'Tui East India Pale Ale 330ml 24pk',
  'Everyday Luxury 3 Ply Long Roll Toilet Tissue 12 Pack Paseo 12 rolls',
  'Fever-Tree Ginger Beer 6x4pk Can (24x250ml)',
  'Wipes Roll Heavy Duty Blue 30x50cm 90pc',
  'Modelo Especial 4 x 6 Pack 4.5% Bottle',
  'Kirin Hyoketsu Lm 4% 10x330mL Can NZ',
  'Corona Cero 12x330ml BT CP',
];

async function main() {
  const project = process.argv.includes('--project')
    ? process.argv[process.argv.indexOf('--project') + 1]
    : 'tallyup-f1463';

  admin.initializeApp({ projectId: project });
  const db = admin.firestore();

  const venuesSnap = await db.collection('venues').limit(200).get();
  const PREFIXES = ['1OJnh3Mt', 'O9pChydj', 'hbwN662z'];

  console.log(`\nProduct details for pack-name products:\n`);
  console.log(
    ['name', 'unit', 'packSize', 'caseSize', 'caseCost', 'costPrice', 'costPriceSource']
      .join(' | ')
  );
  console.log('-'.repeat(120));

  for (const venueDoc of venuesSnap.docs) {
    if (!PREFIXES.some(p => venueDoc.id.startsWith(p))) continue;

    const productsSnap = await db.collection(`venues/${venueDoc.id}/products`).get();
    for (const p of productsSnap.docs) {
      const d = p.data();
      const name = (d.name || '').trim();
      if (!NAMES_TO_FIND.includes(name)) continue;

      const cols = [
        name.slice(0, 45).padEnd(45),
        String(d.unit ?? '-').padEnd(10),
        String(d.packSize ?? '-').padEnd(8),
        String(d.caseSize ?? '-').padEnd(8),
        String(d.caseCost ?? '-').padEnd(10),
        String(d.costPrice ?? '-').padEnd(10),
        String(d.costPriceSource ?? '-'),
      ];
      console.log(cols.join(' | '));
    }
  }

  console.log('\nDone. No writes made.\n');
}

main().catch(e => { console.error(e.message); process.exit(1); });
