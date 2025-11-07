// @ts-nocheck
import { getApp } from 'firebase/app';
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { NormalizedSalesReport } from './types';
import { matchSalesToProducts } from './matchSalesToProducts';

export async function storeSalesReport(args: {
  venueId: string;
  report: NormalizedSalesReport; // expected normalized shape from server parsers
  source: 'csv'|'pdf';
}) {
  try{
    const db = getFirestore(getApp());
    // 1) Store raw report
    const ref = await addDoc(collection(db, 'venues', args.venueId, 'salesReports'), {
      source: args.source,
      report: args.report || null,
      createdAt: serverTimestamp(),
    });

    // 2) Attempt matching (non-throwing — errors are logged)
    try {
      await matchSalesToProducts({
        venueId: args.venueId,
        reportId: ref.id,
        report: args.report,
      });
    } catch (e:any) {
      if (__DEV__) console.log('[storeSalesReport] matchSalesToProducts failed', e?.message || e);
      // leave raw report stored; unknowns can be handled later
    }

    return { ok:true, id: ref.id };
  }catch(e:any){
    if (__DEV__) console.log('[storeSalesReport] error', e?.message||e);
    return { ok:false, error: String(e?.message||e) };
  }
}
