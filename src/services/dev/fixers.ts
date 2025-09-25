import { getApp } from 'firebase/app';
import {
  getFirestore, collection, getDocs, writeBatch, doc
} from 'firebase/firestore';

type BackfillOpts = {
  defaultPar?: number;    // fallback when packSize is missing (default 6)
  usePackSize?: boolean;  // prefer packSize when available (default true)
  dryRun?: boolean;       // don't write, just log (default false)
  limit?: number;         // cap processed docs (default: all)
};

export async function backfillProductPar(venueId: string, opts: BackfillOpts = {}) {
  const db = getFirestore(getApp());
  const defaultPar = Number(opts.defaultPar ?? 6);
  const usePackSize = opts.usePackSize !== false;
  const dryRun = !!opts.dryRun;
  const hardLimit = opts.limit && opts.limit > 0 ? opts.limit : Infinity;

  const snap = await getDocs(collection(db, 'venues', venueId, 'products'));

  let batch = writeBatch(db);
  let updated = 0;
  let scanned = 0;
  const BATCH_MAX = 400;

  for (const d of snap.docs) {
    scanned++;
    if (scanned > hardLimit) break;

    const p = d.data() as any;
    const parCandidates = [
      Number.isFinite(p?.par) ? Number(p.par) : NaN,
      Number.isFinite(p?.parLevel) ? Number(p.parLevel) : NaN,
    ];
    const hasPar = parCandidates.some(v => Number.isFinite(v) && v > 0);

    if (!hasPar) {
      const packSize = Number.isFinite(p?.packSize) ? Math.max(1, Number(p.packSize)) : NaN;
      const newPar = usePackSize && Number.isFinite(packSize) ? packSize : defaultPar;
      if (!dryRun) {
        batch.update(doc(db, 'venues', venueId, 'products', d.id), {
          par: newPar,
          parLevel: newPar,
        });
      }
      updated++;
      if (updated % BATCH_MAX === 0 && !dryRun) {
        await batch.commit();
        batch = writeBatch(db);
      }
    }
  }

  if (updated % BATCH_MAX !== 0 && !dryRun) {
    await batch.commit();
  }
  console.log('[DevFixers] backfillProductPar done', { scanned, updated, defaultPar, usePackSize, dryRun });
}
