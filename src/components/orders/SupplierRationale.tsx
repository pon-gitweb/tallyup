import React from 'react';
import { View, Text } from 'react-native';

export function SupplierRationale({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <View style={{ marginTop: 4 }}>
      <Text style={{ fontSize: 12, opacity: 0.7 }} numberOfLines={3}>
        {text}
      </Text>
    </View>
  );
}
