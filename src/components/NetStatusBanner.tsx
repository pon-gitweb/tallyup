import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

export default function NetStatusBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sub = NetInfo.addEventListener(state => {
      const isOnline = Boolean(state.isConnected) && Boolean(state.isInternetReachable ?? true);
      setOffline(!isOnline);
    });
    return () => sub && sub();
  }, []);

  if (!offline) return null;
  return (
    <View style={S.bar}>
      <Text style={S.text}>You’re offline. Changes will retry when you’re back online.</Text>
    </View>
  );
}

const S = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: Platform.select({ ios: 50, android: 0 }),
    left: 0,
    right: 0,
    backgroundColor: '#111827',
    paddingVertical: 8,
    paddingHorizontal: 12,
    zIndex: 9999,
  },
  text: { color: '#fff', textAlign: 'center' },
});
