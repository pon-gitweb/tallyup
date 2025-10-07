import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, Alert, ViewStyle, TextStyle } from 'react-native';
import { getAuth } from 'firebase/auth';
import { useVenueId } from '../context/VenueProvider';
import { useIdentityLabels, useVenueInfo } from '../hooks/useIdentityLabels';

const dlog = (...a:any[]) => { if (__DEV__) console.log('[IdentityBadge]', ...a); };

type Props = {
  style?: ViewStyle;
  textStyle?: TextStyle;
  compactMaxWidth?: number; // default ~140
};

export default function IdentityBadge({ style, textStyle, compactMaxWidth = 140 }: Props) {
  const auth = getAuth();
  const user = auth.currentUser;
  const venueId = useVenueId() || null;
  const { name } = useVenueInfo(venueId ?? undefined);

  const dataUser = useMemo(() => ({
    displayName: user?.displayName ?? null,
    email: user?.email ?? null,
    uid: user?.uid ?? null,
  }), [user?.displayName, user?.email, user?.uid]);

  const dataVenue = useMemo(() => ({
    name: name ?? null,
    venueId: venueId ?? null,
  }), [name, venueId]);

  const { badge, friendly } = useIdentityLabels(dataUser, dataVenue);

  const onPress = () => {
    dlog('press');
    Alert.alert('Signed in', friendly);
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      style={[{
        maxWidth: compactMaxWidth,
        backgroundColor: '#1F2937',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        alignSelf: 'flex-start',
      }, style]}
      accessibilityLabel="Current user and venue"
      accessibilityHint="Press to see full identity"
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{
          width: 6, height: 6, borderRadius: 3, backgroundColor: '#34D399', marginRight: 6,
        }} />
        <Text
          numberOfLines={1}
          style={[{ color: 'white', fontWeight: '700', fontSize: 12 }, textStyle]}
        >
          {badge}
        </Text>
      </View>
    </TouchableOpacity>
  );
}
