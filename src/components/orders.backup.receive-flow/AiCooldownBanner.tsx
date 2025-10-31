import React from 'react';
import { View, Text } from 'react-native';

export function AiCooldownBanner({ seconds }: { seconds?: number }) {
  if (!seconds || seconds <= 0) return null;
  return (
    <View style={{ padding: 8, borderRadius: 8, backgroundColor: 'rgba(255,165,0,0.12)', marginBottom: 8 }}>
      <Text style={{ fontSize: 13 }}>
        AI is cooling down. Try again in ~{seconds}s.
      </Text>
    </View>
  );
}
