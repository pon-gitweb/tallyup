// Jest-only RN shim to avoid ReferenceError in Node
;(global as any).__DEV__ = false

import { runAISuggest } from '../suggestAI';

describe('runAISuggest', () => {
  const venueId = 'v_demo';

  beforeEach(() => {
    // Simple global fetch mock that fails -> ensures math fallback path is safe
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('offline'));
  });

  it('returns baseline shape on network error', async () => {
    const res = await runAISuggest(venueId, { historyDays: 7, k: 2, max: 100 });
    expect(res).toHaveProperty('buckets');
    expect(res).toHaveProperty(['unassigned', 'lines']);
  });
});
