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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ReadOnlyInfoBanner', () => {
  it('renders no TouchableOpacity and no link text', () => {
    const { queryAllByRole, getByText } = render(<ReadOnlyInfoBanner />);

    // No touchable element of any kind
    const buttons = queryAllByRole('button');
    expect(buttons).toHaveLength(0);

    // Correct informational copy is shown
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
