import { checkCountsChangedSince } from '../../../services/reports/recalcGuard';

jest.mock('../../../services/firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  getDocs: jest.fn(),
}));

import * as ff from 'firebase/firestore';

const mockDb = {};
const venueId = 'venue1';
const deptId = 'dept1';

function makeItemsSnap(lastCountAtMs: number | null) {
  const lca = lastCountAtMs != null
    ? { toMillis: () => lastCountAtMs }
    : null;
  return { docs: [{ data: () => ({ lastCountAt: lca }) }] };
}

describe('checkCountsChangedSince', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns false when item was counted before completedAt', async () => {
    const completedAtMs = 1000000;
    (ff.getDocs as jest.Mock)
      .mockResolvedValueOnce({ docs: [{ id: 'area1' }] })
      .mockResolvedValueOnce(makeItemsSnap(completedAtMs - 1));
    const result = await checkCountsChangedSince(mockDb, venueId, deptId, completedAtMs);
    expect(result).toBe(false);
  });

  it('returns true when an item was counted after completedAt', async () => {
    const completedAtMs = 1000000;
    (ff.getDocs as jest.Mock)
      .mockResolvedValueOnce({ docs: [{ id: 'area1' }] })
      .mockResolvedValueOnce(makeItemsSnap(completedAtMs + 1));
    const result = await checkCountsChangedSince(mockDb, venueId, deptId, completedAtMs);
    expect(result).toBe(true);
  });

  it('returns false when no areas exist', async () => {
    (ff.getDocs as jest.Mock).mockResolvedValueOnce({ docs: [] });
    const result = await checkCountsChangedSince(mockDb, venueId, deptId, 1000000);
    expect(result).toBe(false);
  });

  it('returns false when getDocs throws', async () => {
    (ff.getDocs as jest.Mock).mockRejectedValueOnce(new Error('network'));
    const result = await checkCountsChangedSince(mockDb, venueId, deptId, 1000000);
    expect(result).toBe(false);
  });
});
