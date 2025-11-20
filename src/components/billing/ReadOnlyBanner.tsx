import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

type Props = {
  onPress?: () => void;
  trialsLeftLabel?: string; // e.g., "Trial mode: 2 uses left"
};

export function ReadOnlyBanner({ onPress, trialsLeftLabel }: Props) {
  return (
    <View
      style={{
        backgroundColor: '#FFF4E5',
        borderColor: '#FFC78A',
        borderWidth: 1,
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderRadius: 12,
        marginHorizontal: 12,
        marginTop: 10,
        marginBottom: 6,
      }}
    >
      <Text style={{ fontWeight: '800', marginBottom: 4 }}>
        {trialsLeftLabel ? trialsLeftLabel : 'Your subscription is paused.'}
      </Text>
      <Text style={{ opacity: 0.85, marginBottom: 10 }}>
        You can still view and export your data. Update your payment details to regain full access.
      </Text>
      {onPress ? (
        <TouchableOpacity
          onPress={onPress}
          style={{
            paddingVertical: 8,
            paddingHorizontal: 12,
            backgroundColor: '#0B132B',
            borderRadius: 10,
            alignSelf: 'flex-start',
          }}
        >
          <Text style={{ color: 'white', fontWeight: '700' }}>Re-Subscribe</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
