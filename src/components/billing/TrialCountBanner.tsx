import React from 'react';
import { View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVenue } from '../../context/VenueProvider';

export function TrialCountBanner() {
  const { trialState, billingState, enforceReadOnly, ready } = useVenue();
  const insets = useSafeAreaInsets();

  if (!enforceReadOnly || !ready) return null;
  if (!trialState || trialState.status !== 'active') return null;
  if (billingState.accessMode === 'readOnly') return null;
  const left = Math.max(0, 3 - (trialState.stocktakesUsed ?? 0));
  if (left <= 0) return null;

  return (
    <View
      style={{
        paddingTop: insets.top + 6,
        paddingBottom: 8,
        paddingHorizontal: 16,
        backgroundColor: '#EFF6FF',
        borderBottomWidth: 1,
        borderBottomColor: '#BFDBFE',
      }}
    >
      <Text style={{ fontSize: 12, color: '#1E40AF' }}>
        {`Free trial: ${left} of 3 stocktake${left === 1 ? '' : 's'} left.`}
      </Text>
    </View>
  );
}
