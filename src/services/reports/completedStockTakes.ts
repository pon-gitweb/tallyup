// @ts-nocheck

import { getVenueSession } from '../completion';

export type CompletedStockTakeRow = {
  id: string;
  status: string | null;
  completedAt: any | null;
};

/**
 * For now, we only have a single venue session.
 * We treat it as a "completed stock take" if:
 *   status === 'completed' AND completedAt exists.
 *
 * The UI can describe this as "latest completed stock take (beta)"
 * and we can expand to real history later without breaking callers.
 */
export async function listCompletedStockTakes(
  venueId: string,
): Promise<CompletedStockTakeRow[]> {
  if (!venueId) return [];

  const session = await getVenueSession(venueId);
  if (!session) return [];

  const status = session.status || null;
  const completedAt = session.completedAt || null;

  if (status !== 'completed' || !completedAt) {
    // Session exists but isn't a fully completed stock take under the new flow.
    return [];
  }

  return [
    {
      id: 'current',
      status,
      completedAt,
    },
  ];
}
