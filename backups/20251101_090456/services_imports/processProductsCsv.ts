// @ts-nocheck
import { CSV_PROCESS_URL } from './urls';

export async function callProcessProductsCsv(venueId:string, path:string, force:boolean=false){
  if (!CSV_PROCESS_URL) throw new Error('Missing EXPO_PUBLIC_PROCESS_PRODUCTS_CSV_URL');
  const r = await fetch(CSV_PROCESS_URL, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({ venueId, path, force })
  });
  const j = await r.json().catch(()=>null);
  if (!r.ok || !j || j.ok===false) {
    const msg = (j && j.error) ? j.error : `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return j; // { ok:true, counts:{created,updated,skipped}, headers, rows }
}
