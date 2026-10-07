import React from 'react';
import { View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVenue } from '../../context/VenueProvider';

/**
 * Informational read-only banner — no button, no link, no price, no call to action.
 * Mounts once in the app shell; renders nothing when enforcement is off or
 * the venue has full access (trial active, festival, active subscriber, etc.).
 */
export function ReadOnlyInfoBanner() {
  const { enforceReadOnly, ready, billingState, venueType } = useVenue();
  const insets = useSafeAreaInsets();

  const visible =
    enforceReadOnly &&
    ready &&
    billingState.accessMode === 'readOnly' &&
    venueType !== 'festival';

  if (!visible) return null;

  return (
    <View
      style={{
        paddingTop: insets.top + 8,
        paddingBottom: 10,
        paddingHorizontal: 16,
        backgroundColor: '#FFF4E5',
        borderBottomWidth: 1,
        borderBottomColor: '#FFC78A',
      }}
    >
      <Text style={{ fontSize: 13, color: '#7A4F1C' }}>
        {'Your free trial has ended. This venue is read-only: you can still view everything.'}
      </Text>
    </View>
  );
}
