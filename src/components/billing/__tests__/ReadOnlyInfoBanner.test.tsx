import React from 'react';
import { render } from '@testing-library/react-native';
import { ReadOnlyInfoBanner } from '../ReadOnlyInfoBanner';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// Default: enforcement is ON, readOnly, non-festival — banner visible.
const mockVenue = {
  enforceReadOnly: true,
  ready: true,
  billingState: { accessMode: 'readOnly', plan: 'none', addons: {}, trial: {} },
  venueType: 'venue',
};

jest.mock('../../../context/VenueProvider', () => ({
  useVenue: () => mockVenue,
}));

// Control canShowPurchasePaths per test
let mockCanShowPurchasePaths = true;
jest.mock('../../../utils/platformPolicy', () => ({
  get canShowPurchasePaths() { return mockCanShowPurchasePaths; },
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ReadOnlyInfoBanner', () => {
  beforeEach(() => { mockCanShowPurchasePaths = false; });

  it('shows mobile-safe copy (no purchase path) when canShowPurchasePaths=false', () => {
    const { queryAllByRole, getByText } = render(<ReadOnlyInfoBanner />);

    const buttons = queryAllByRole('button');
    expect(buttons).toHaveLength(0);

    getByText("Your venue's access has ended. Contact your venue owner.");
  });

  it('shows full trial-ended copy when canShowPurchasePaths=true (web)', () => {
    mockCanShowPurchasePaths = true;
    const { getByText } = render(<ReadOnlyInfoBanner />);
    getByText(
      'Your free trial has ended. This venue is read-only: you can still view everything.',
    );
  });

  it('renders nothing when enforce=false', () => {
    mockVenue.enforceReadOnly = false;
    const { toJSON } = render(<ReadOnlyInfoBanner />);
    expect(toJSON()).toBeNull();
    mockVenue.enforceReadOnly = true;
  });

  it('renders nothing when ready=false', () => {
    mockVenue.ready = false;
    const { toJSON } = render(<ReadOnlyInfoBanner />);
    expect(toJSON()).toBeNull();
    mockVenue.ready = true;
  });

  it('renders nothing when accessMode=full', () => {
    mockVenue.billingState = { ...mockVenue.billingState, accessMode: 'full' };
    const { toJSON } = render(<ReadOnlyInfoBanner />);
    expect(toJSON()).toBeNull();
    mockVenue.billingState = { ...mockVenue.billingState, accessMode: 'readOnly' };
  });

  it('renders nothing for festival venue', () => {
    mockVenue.venueType = 'festival';
    const { toJSON } = render(<ReadOnlyInfoBanner />);
    expect(toJSON()).toBeNull();
    mockVenue.venueType = 'venue';
  });
});
