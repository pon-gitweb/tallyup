/**
 * Variance explainer client: Expo-safe fetch to local/remote server.
 * Returns: { summary, factors?: string[], missing?: string[], confidence?: number }
 */
type ExplainInput = Record<string, any>;
type ExplainOut = { summary: string; factors?: string[]; missing?: string[]; confidence?: number };

const base =
  (typeof process !== 'undefined' && (process as any).env?.EXPO_PUBLIC_AI_URL) ||
  'http://localhost:3001';
const URL_EXPLAIN = `${String(base).replace(/\/+$/,'')}/api/variance-explain`;

export async function explainVariance(input: ExplainInput): Promise<ExplainOut> {
  const resp = await fetch(URL_EXPLAIN, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input ?? {}),
  }).catch((e) => { throw new Error(`Network error: ${String(e?.message || e)}`); });

  if (!resp.ok) {
    const msg = await resp.text().catch(() => '');
    throw new Error(msg || `Server error (${resp.status})`);
  }

  const json = await resp.json().catch(() => ({}));
  return {
    summary: String(json?.summary || 'No explanation available.'),
    factors: Array.isArray(json?.factors) ? json.factors : undefined,
    missing: Array.isArray(json?.missing) ? json.missing : undefined,
    confidence: Number.isFinite(json?.confidence) ? Number(json.confidence) : undefined,
  };
}
