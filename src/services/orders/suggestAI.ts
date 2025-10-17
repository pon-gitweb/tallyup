// @ts-nocheck
import { AI_SUGGEST_URL } from '../../config/ai';

function withTimeout(ms:number){
  const c = new AbortController();
  const t = setTimeout(()=>c.abort(), ms);
  return { signal:c.signal, done:()=>clearTimeout(t) };
}

/**
 * Calls the AI suggester server.
 * Expects the server to be Firestore-aware; we pass minimal context.
 * Returns normalized { buckets, unassigned } (server already normalized).
 */
export async function fetchAISuggestions(venueId:string, opts:any = {}){
  const body = {
    venueId,
    historyDays: opts.historyDays ?? 28,
    roundToPack: true,
    defaultParIfMissing: 6,
    // room for future prompt params
  };
  const { signal, done } = withTimeout(25_000);
  try{
    const res = await fetch(AI_SUGGEST_URL, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new Error(`AI server ${res.status}`);
    const json = await res.json();
    // Expect { buckets, unassigned } or legacy map. Let screen normalize defensively again.
    return json;
  } finally { done(); }
}
