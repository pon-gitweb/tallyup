// @ts-nocheck
import React from 'react';
import { Text, View } from 'react-native';

/**
 * NoPriceBadge — shown when a product has no cost price set
 * Surfaces the gap so users know what to fix
 */
export default function NoPriceBadge() {
  return (
    <View style={{
      backgroundColor: '#FEF3C7',
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: '#FDE68A',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
    }}>
      <Text style={{ fontSize: 10 }}>⚠️</Text>
      <Text style={{ fontSize: 10, fontWeight: '700', color: '#92400E' }}>No price</Text>
    </View>
  );
}
