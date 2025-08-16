import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';

// Optional require: app still bundles if the dep isn't installed yet
let NetInfo: any = null;
try {
  NetInfo = require('@react-native-community/netinfo').default;
} catch {
  NetInfo = null;
}

export default function NetStatusBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!NetInfo) return; // silently no-op if module missing
    const sub = NetInfo.addEventListener((state: any) => {
      const isOnline = Boolean(state?.isConnected) && Boolean(state?.isInternetReachable ?? true);
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
