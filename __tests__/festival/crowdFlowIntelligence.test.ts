import { buildCrowdFlowIntelligence } from '../../src/services/festival/crowdFlowIntelligence';

// Helper to create a fake Firestore timestamp
const ts = (ms: number) => ({ toMillis: () => ms });

// Helper to build a session
const session = (barId: string, barName: string, completedAtMs: number, counts: any[]) => ({
  barId, barName, completedAt: ts(completedAtMs), counts,
});

const t = (h: number, m = 0) => new Date(2026, 6, 7, h, m).getTime();

describe('buildCrowdFlowIntelligence', () => {
  it('returns empty result with fewer than 3 sessions', () => {
    const result = buildCrowdFlowIntelligence([]);
    expect(result.hourSnapshots).toHaveLength(0);
    expect(result.flowEvents).toHaveLength(0);
    expect(result.peakHour).toBeNull();
  });

  it('returns empty result with sessions from only one bar', () => {
    const sessions = [
      session('bar1', 'Main Bar', t(18), [{ productId: 'p1', actualCount: 100 }]),
      session('bar1', 'Main Bar', t(19), [{ productId: 'p1', actualCount: 80 }]),
      session('bar1', 'Main Bar', t(20), [{ productId: 'p1', actualCount: 60 }]),
    ];
    const result = buildCrowdFlowIntelligence(sessions);
    // Needs 2+ bars for cross-bar flow analysis
    expect(result.flowEvents).toHaveLength(0);
  });

  it('detects a flow event when velocity leadership switches between bars', () => {
    const sessions = [
      // Hour 18: Main Bar busy (100→60 = 40 consumed), Garden Bar quiet (50→45 = 5)
      session('bar1', 'Main Bar',   t(18), [{ productId: 'p1', actualCount: 100 }]),
      session('bar2', 'Garden Bar', t(18), [{ productId: 'p1', actualCount: 50 }]),
      session('bar1', 'Main Bar',   t(19), [{ productId: 'p1', actualCount: 60 }]),
      session('bar2', 'Garden Bar', t(19), [{ productId: 'p1', actualCount: 45 }]),
      // Hour 20: Garden Bar busy (45→10 = 35 consumed), Main Bar quiet (60→55 = 5)
      session('bar1', 'Main Bar',   t(20), [{ productId: 'p1', actualCount: 55 }]),
      session('bar2', 'Garden Bar', t(20), [{ productId: 'p1', actualCount: 10 }]),
    ];
    const result = buildCrowdFlowIntelligence(sessions);
    expect(result.flowEvents.length).toBeGreaterThan(0);
    const flow = result.flowEvents[0];
    expect(flow.fromBar).toBe('Main Bar');
    expect(flow.toBar).toBe('Garden Bar');
  });

  it('identifies opening bar correctly', () => {
    const sessions = [
      session('bar1', 'Main Bar',   t(14), [{ productId: 'p1', actualCount: 100 }]),
      session('bar2', 'Garden Bar', t(14), [{ productId: 'p1', actualCount: 30 }]),
      session('bar1', 'Main Bar',   t(15), [{ productId: 'p1', actualCount: 70 }]),
      session('bar2', 'Garden Bar', t(15), [{ productId: 'p1', actualCount: 28 }]),
      session('bar1', 'Main Bar',   t(16), [{ productId: 'p1', actualCount: 40 }]),
      session('bar2', 'Garden Bar', t(16), [{ productId: 'p1', actualCount: 25 }]),
    ];
    const result = buildCrowdFlowIntelligence(sessions);
    expect(result.openingPattern).toContain('Main Bar');
  });

  it('generates staffing insights when a bar peaks then drops', () => {
    const sessions = [
      session('bar1', 'Main Bar',   t(20), [{ productId: 'p1', actualCount: 100 }]),
      session('bar2', 'Garden Bar', t(20), [{ productId: 'p1', actualCount: 50 }]),
      session('bar1', 'Main Bar',   t(21), [{ productId: 'p1', actualCount: 40 }]),
      session('bar2', 'Garden Bar', t(21), [{ productId: 'p1', actualCount: 48 }]),
      session('bar1', 'Main Bar',   t(22), [{ productId: 'p1', actualCount: 35 }]),
      session('bar2', 'Garden Bar', t(22), [{ productId: 'p1', actualCount: 46 }]),
    ];
    const result = buildCrowdFlowIntelligence(sessions);
    expect(result.staffingInsights.length).toBeGreaterThan(0);
  });

  it('handles sessions with missing counts gracefully', () => {
    const sessions = [
      session('bar1', 'Main Bar',   t(18), []),
      session('bar2', 'Garden Bar', t(18), []),
      session('bar1', 'Main Bar',   t(19), []),
      session('bar2', 'Garden Bar', t(19), []),
    ];
    expect(() => buildCrowdFlowIntelligence(sessions)).not.toThrow();
  });

  it('handles sessions without toMillis gracefully', () => {
    const badSessions = [
      { barId: 'bar1', barName: 'Main Bar', completedAt: null, counts: [] },
      { barId: 'bar2', barName: 'Garden Bar', completedAt: undefined, counts: [] },
    ];
    expect(() => buildCrowdFlowIntelligence(badSessions as any)).not.toThrow();
    const result = buildCrowdFlowIntelligence(badSessions as any);
    expect(result.hourSnapshots).toHaveLength(0);
  });
});
