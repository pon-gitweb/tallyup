// @ts-nocheck
import { getAuth } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { AI_BASE_URL } from '../../config/ai';
import { handleAiLimitError } from '../../utils/aiLimitError';
import type { BriefingData } from './briefing';

export type AiInsight = {
  headline: string;
  observation: string;
  action: string | null;
};

function buildPayload(venueId: string, data: BriefingData): object {
  return {
    venueId,
    currentCycle: {
      totalItemsCounted: data.totalItemsCounted,
      totalAreasCompleted: data.totalAreasCompleted,
      totalAreas: data.totalAreas,
      shortfallDollars: data.shortfallDollars,
      excessDollars: data.excessDollars,
      hasPreviousCycleComparison: data.hasPrevCycleData,
    },
    topVarianceLines: data.topShortages.slice(0, 5).map((s) => ({
      name: s.name,
      department: s.deptName,
      varianceUnits: s.varianceUnits,
      dollarVariance: s.dollarVariance,
    })),
    repeatOffenders: data.trendItems.slice(0, 5).map((t) => ({
      name: t.name,
      department: t.deptName,
    })),
    topExcesses: data.topExcesses.slice(0, 3).map((s) => ({
      name: s.name,
      department: s.deptName,
      varianceUnits: s.varianceUnits,
      dollarVariance: s.dollarVariance,
    })),
  };
}

const ONE_HOUR = 60 * 60 * 1000;

export async function fetchAiInsights(
  venueId: string,
  briefingData: BriefingData,
): Promise<AiInsight[]> {
  if (!venueId || !briefingData.hasCountData) return [];

  // Check Firestore cache before making a fresh API call
  try {
    const cacheRef = doc(db, 'venues', venueId, 'reports', 'aiInsights');
    const cached = await getDoc(cacheRef);
    if (cached.exists()) {
      const cacheData = cached.data();
      const cacheAge = Date.now() - (cacheData.generatedAt?.toMillis() ?? 0);
      if (cacheAge < ONE_HOUR && Array.isArray(cacheData.insights) && cacheData.insights.length > 0) {
        return cacheData.insights as AiInsight[];
      }
    }
  } catch {}

  let token: string | undefined;
  try {
    const user = getAuth().currentUser;
    token = user ? await user.getIdToken() : undefined;
  } catch {}

  if (!token) return [];

  const cacheKey = new Date().toISOString().split('T')[0];

  const resp = await fetch(`${AI_BASE_URL}/api/ai-insights`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      venueId,
      data: buildPayload(venueId, briefingData),
      cacheKey,
    }),
  });

  if (resp.status === 429) {
    const json = await resp.json().catch(() => ({}));
    handleAiLimitError(json);
    return [];
  }
  if (!resp.ok) throw new Error(`AI insights HTTP ${resp.status}`);

  const json = await resp.json().catch(() => ({}));
  return Array.isArray(json?.insights) ? json.insights : [];
}
