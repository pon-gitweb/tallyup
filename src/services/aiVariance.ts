import { getAuth } from 'firebase/auth';
import { getAIContext } from './aiContext';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
/**
 * Variance explainer client: Expo-safe fetch to local/remote server.
 * Returns: { summary, factors?: string[], missing?: string[], confidence?: number }
 */
type ExplainInput = Record<string, any>;
type ExplainOut = { summary: string; factors?: string[]; missing?: string[]; confidence?: number };

const base =
  (typeof process !== 'undefined' && (process as any).env?.EXPO_PUBLIC_AI_URL) ||
  'https://us-central1-tallyup-f1463.cloudfunctions.net/api';
const URL_EXPLAIN = `${String(base).replace(/\/+$/,'')}/api/variance-explain`;

export async function explainVariance(input: ExplainInput): Promise<ExplainOut> {
  // Enrich with venue AI context if venueId is present
  let enrichedInput = input ?? {};
  try {
    const vid = (input as any)?.venueId || (input as any)?.context?.venueId;
    if (vid) {
      const aiCtx = await getAIContext(vid);
      if (aiCtx) enrichedInput = { ...enrichedInput, aiContext: aiCtx };
    }
  } catch { /* non-fatal */ }
  const token = await getAuth().currentUser?.getIdToken();
  const resp = await fetchWithTimeout(URL_EXPLAIN, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Authorization': 'Bearer ' + (token ?? '') },
    body: JSON.stringify(enrichedInput),
  }, 30000).catch((e) => { throw new Error(e?.message || 'Network error'); });

  if (!resp.ok) {
    const raw = await resp.text().catch(() => '');
    let errMsg: string;
    try {
      const parsed = JSON.parse(raw);
      // Backend's own try/catch returns { ok: false, error: "..." } — use that message.
      errMsg = typeof parsed?.error === 'string' && parsed.error
        ? parsed.error
        : `Server error (${resp.status})`;
    } catch {
      // Body isn't JSON — likely an infrastructure-level HTML error page (e.g. Cloud Function
      // timeout before the handler ran). Never expose raw content to the user.
      errMsg = `Could not generate an explanation right now — please try again in a moment. (${resp.status})`;
    }
    throw new Error(errMsg);
  }

  const json = await resp.json().catch(() => ({}));
  return {
    summary: String(json?.summary || 'No explanation available.'),
    factors: Array.isArray(json?.factors) ? json.factors : undefined,
    missing: Array.isArray(json?.missing) ? json.missing : undefined,
    confidence: Number.isFinite(json?.confidence) ? Number(json.confidence) : undefined,
  };
}
