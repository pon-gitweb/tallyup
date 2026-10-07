import React from 'react';
import { render } from '@testing-library/react-native';
import { TrialCountBanner } from '../TrialCountBanner';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 0, left: 0, right: 0 }),
}));

const mockVenue = {
  enforceReadOnly: true,
  ready: true,
  billingState: { accessMode: 'full', plan: 'none', addons: {}, trial: {} },
  trialState: { status: 'active', stocktakesUsed: 1, stocktakesAtStart: 0, startedAt: null },
};

jest.mock('../../../context/VenueProvider', () => ({
  useVenue: () => mockVenue,
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TrialCountBanner', () => {
  afterEach(() => {
    mockVenue.enforceReadOnly = true;
    mockVenue.ready = true;
    mockVenue.billingState = { accessMode: 'full', plan: 'none', addons: {}, trial: {} };
    mockVenue.trialState = { status: 'active', stocktakesUsed: 1, stocktakesAtStart: 0, startedAt: null };
  });

  it('renders remaining stocktake count when trial is active', () => {
    const { getByText } = render(<TrialCountBanner />);
    getByText('Free trial: 2 of 3 stocktakes left.');
  });

  it('uses singular "stocktake" when only 1 left', () => {
    mockVenue.trialState = { ...mockVenue.trialState, stocktakesUsed: 2 };
    const { getByText } = render(<TrialCountBanner />);
    getByText('Free trial: 1 of 3 stocktake left.');
  });

  it('renders nothing when enforceReadOnly is false', () => {
    mockVenue.enforceReadOnly = false;
    const { toJSON } = render(<TrialCountBanner />);
    expect(toJSON()).toBeNull();
  });

  it('renders nothing when ready is false', () => {
    mockVenue.ready = false;
    const { toJSON } = render(<TrialCountBanner />);
    expect(toJSON()).toBeNull();
  });

  it('renders nothing when accessMode is readOnly (read-only banner takes over)', () => {
    mockVenue.billingState = { ...mockVenue.billingState, accessMode: 'readOnly' };
    const { toJSON } = render(<TrialCountBanner />);
    expect(toJSON()).toBeNull();
  });

  it('renders nothing when trial status is not active', () => {
    mockVenue.trialState = { ...mockVenue.trialState, status: 'expired' };
    const { toJSON } = render(<TrialCountBanner />);
    expect(toJSON()).toBeNull();
  });

  it('renders nothing when all 3 stocktakes used', () => {
    mockVenue.trialState = { ...mockVenue.trialState, stocktakesUsed: 3 };
    const { toJSON } = render(<TrialCountBanner />);
    expect(toJSON()).toBeNull();
  });

  it('renders nothing when trialState is null', () => {
    mockVenue.trialState = null;
    const { toJSON } = render(<TrialCountBanner />);
    expect(toJSON()).toBeNull();
  });
});
