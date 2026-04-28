// @ts-nocheck
import { getAuth } from 'firebase/auth';
import { AI_BASE_URL } from '../../config/ai';
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

export async function fetchAiInsights(
  venueId: string,
  briefingData: BriefingData,
): Promise<AiInsight[]> {
  if (!venueId || !briefingData.hasCountData) return [];

  let token: string | undefined;
  try {
    const user = getAuth().currentUser;
    token = user ? await user.getIdToken() : undefined;
  } catch {}

  if (!token) return [];

  const resp = await fetch(`${AI_BASE_URL}/api/ai-insights`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      venueId,
      data: buildPayload(venueId, briefingData),
    }),
  });

  if (!resp.ok) throw new Error(`AI insights HTTP ${resp.status}`);

  const json = await resp.json().catch(() => ({}));
  return Array.isArray(json?.insights) ? json.insights : [];
}
