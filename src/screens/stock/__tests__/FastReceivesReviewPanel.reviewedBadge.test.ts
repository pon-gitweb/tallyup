/**
 * Unit tests for the "Reviewed — not yet accepted" badge logic added to
 * FastReceivesReviewPanel (Handoff 3).
 *
 * Strategy: the badge visibility is pure data logic — two boolean conditions
 * ANDed together.  Test them as a plain TypeScript helper mirroring production
 * code; no React / Firebase imports needed.  Follows the style of other test
 * files in this project.
 */

// ── Types (mirroring FastReceivesReviewPanel's internal FastRec) ──────────────

type FastRec = {
  id: string;
  status?: 'pending' | 'attached' | 'reconciled';
  inductionDecisions?: {
    acceptedProposalIds?: string[];
    skippedProposalIds?: string[];
    resolvedAt?: any;
  };
};

// ── Helpers mirroring the two conditions in the production render ─────────────

/** True when the item is still in the pending state (not yet accepted). */
function isPending(item: FastRec): boolean {
  return !item.status || item.status === 'pending';
}

/** True when the reviewed badge should be shown. */
function showReviewedBadge(item: FastRec): boolean {
  return isPending(item) && !!item.inductionDecisions;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FastReceivesReviewPanel — reviewed badge visibility (Handoff 3)', () => {
  describe('isPending', () => {
    it('treats missing status as pending', () => {
      expect(isPending({ id: 'x' })).toBe(true);
    });
    it('treats explicit "pending" as pending', () => {
      expect(isPending({ id: 'x', status: 'pending' })).toBe(true);
    });
    it('treats "attached" as not pending', () => {
      expect(isPending({ id: 'x', status: 'attached' })).toBe(false);
    });
    it('treats "reconciled" as not pending', () => {
      expect(isPending({ id: 'x', status: 'reconciled' })).toBe(false);
    });
  });

  describe('showReviewedBadge', () => {
    it('shows badge for a pending item with inductionDecisions set', () => {
      const item: FastRec = {
        id: 'fr1',
        status: 'pending',
        inductionDecisions: {
          acceptedProposalIds: ['p1'],
          skippedProposalIds: [],
        },
      };
      expect(showReviewedBadge(item)).toBe(true);
    });

    it('shows badge when status is absent and inductionDecisions is set', () => {
      const item: FastRec = {
        id: 'fr2',
        inductionDecisions: { acceptedProposalIds: [], skippedProposalIds: ['p2'] },
      };
      expect(showReviewedBadge(item)).toBe(true);
    });

    it('does NOT show badge for a pending item with no inductionDecisions', () => {
      const item: FastRec = { id: 'fr3', status: 'pending' };
      expect(showReviewedBadge(item)).toBe(false);
    });

    it('does NOT show badge for a pending item with undefined inductionDecisions', () => {
      const item: FastRec = { id: 'fr4', status: 'pending', inductionDecisions: undefined };
      expect(showReviewedBadge(item)).toBe(false);
    });

    it('does NOT show badge for an attached item even if inductionDecisions is set', () => {
      // Attached items have completed the full accept flow — no badge needed,
      // and the list would still show "Status: attached" for them unchanged.
      const item: FastRec = {
        id: 'fr5',
        status: 'attached',
        inductionDecisions: { acceptedProposalIds: ['p1'], skippedProposalIds: [] },
      };
      expect(showReviewedBadge(item)).toBe(false);
    });

    it('does NOT show badge for a reconciled item even if inductionDecisions is set', () => {
      const item: FastRec = {
        id: 'fr6',
        status: 'reconciled',
        inductionDecisions: { acceptedProposalIds: ['p1'], skippedProposalIds: [] },
      };
      expect(showReviewedBadge(item)).toBe(false);
    });

    it('badge works with a minimal inductionDecisions object (only resolvedAt)', () => {
      const item: FastRec = {
        id: 'fr7',
        inductionDecisions: { resolvedAt: 'some-timestamp' },
      };
      expect(showReviewedBadge(item)).toBe(true);
    });
  });
});
