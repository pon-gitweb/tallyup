// @ts-nocheck
import { AI_SUGGEST_URL } from '../config/ai';

const BASE = AI_SUGGEST_URL.replace(/\/+$/,''); // e.g. http://10.0.2.2:3001

async function jsonFetch(path:string, opts:any = {}){
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method || 'POST',
    headers: { 'Content-Type':'application/json', ...(opts.headers||{}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(()=> ({}));
  if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
  return data;
}

// Minimal payload: you can extend later with your “data diet” aggregate
export async function explainVariance({ venueId, departmentId, items, sinceDays = 14 }:{
  venueId: string,
  departmentId?: string|null,
  items?: any[]|null,         // optional trimmed list you already have
  sinceDays?: number
}){
  const body:any = { venueId, departmentId: departmentId||null, sinceDays };
  if (Array.isArray(items)) body.items = items;
  const res = await jsonFetch('/api/variance-explain', { body });
  // Expect { explanation: string, bullets?: string[] } from server
  return {
    explanation: String(res?.explanation || 'No explanation available.'),
    bullets: Array.isArray(res?.bullets) ? res.bullets : [],
  };
}
