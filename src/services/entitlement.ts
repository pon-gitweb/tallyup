// @ts-nocheck
import { AI_SUGGEST_URL } from '../config/ai';

function baseFromSuggest(url:string){
  const ix = url.indexOf('/api/');
  return ix>0 ? url.slice(0, ix) : url.replace(/\/$/, '');
}
const BASE = baseFromSuggest(AI_SUGGEST_URL);
const ENTITLE_URL = `${BASE}/api/entitlement`;
const PROMO_URL = `${BASE}/api/validate-promo`;

function withTimeout(ms:number){
  const c = new AbortController();
  const t = setTimeout(()=>c.abort(), ms);
  return { signal:c.signal, done:()=>clearTimeout(t) };
}

export async function getEntitlement(){
  const { signal, done } = withTimeout(10_000);
  try{
    const r = await fetch(ENTITLE_URL, { signal });
    if (!r.ok) return { entitled:false };
    const j = await r.json();
    // expected: { entitled: boolean, plan?: string }
    return { entitled: !!j?.entitled, plan: j?.plan || null };
  } catch {
    return { entitled:false };
  } finally { done(); }
}

export async function validatePromo(code:string){
  const { signal, done } = withTimeout(12_000);
  try{
    const r = await fetch(PROMO_URL, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ code }),
      signal,
    });
    if (!r.ok) {
      const msg = (await r.text()) || `HTTP ${r.status}`;
      throw new Error(msg);
    }
    const j = await r.json();
    // expected: { ok:true, entitled?:boolean, plan?:string }
    return { ok: !!j?.ok, entitled: !!j?.entitled, plan: j?.plan || null };
  } finally { done(); }
}
