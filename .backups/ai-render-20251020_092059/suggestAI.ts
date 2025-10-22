import { getAuth } from "firebase/auth";
import { AI_SUGGEST_ORDERS_URL } from "../../config/ai";

type SuggestOptions = {
  historyDays?: number;
  k?: number;
  max?: number;
};

type SuggestResponse = {
  ok: boolean;
  strategy?: string;
  buckets?: Record<string, { supplierName: string; lines: any[] }>;
  unassigned?: { lines: any[] };
  error?: string;
};

/**
 * Calls the local AI server to get suggested orders.
 * Returns a normalized object that your screen can consume directly.
 */
export async function runAISuggest(
  venueId: string,
  options: SuggestOptions = {}
): Promise<SuggestResponse> {
  const uid = getAuth()?.currentUser?.uid || "dev";
  const body = { uid, venueId, options };

  // Defensive: bail early if URL somehow missing
  if (!AI_SUGGEST_ORDERS_URL) {
    const g = (globalThis as any);
    const fromGlobal = g?.AI_SUGGEST_ORDERS_URL;
    if (!fromGlobal) {
      throw new Error("AI_SUGGEST_ORDERS_URL is not defined");
    }
  }

  const resp = await fetch(AI_SUGGEST_ORDERS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await resp.json().catch(() => null)) as SuggestResponse | null;

  if (!resp.ok || !data) {
    const msg = data?.error || `AI suggest failed (${resp.status})`;
    return { ok: false, error: msg, buckets: {}, unassigned: { lines: [] } };
  }

  // Normalize structure
  const buckets = data.buckets ?? {};
  const unassigned = data.unassigned ?? { lines: [] };

  if (typeof __DEV__ !== "undefined" && __DEV__) {
    // eslint-disable-next-line no-console
    console.log("[AI] suggest-orders →", {
      url: AI_SUGGEST_ORDERS_URL,
      status: resp.status,
      bucketKeys: Object.keys(buckets),
      unassignedCount: Array.isArray(unassigned?.lines) ? unassigned.lines.length : 0,
    });
  }

  return { ok: true, strategy: data.strategy, buckets, unassigned };
}
