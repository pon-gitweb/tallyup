// @ts-nocheck
import React, { useEffect, useRef } from 'react';
import { Animated, Text, ViewStyle } from 'react-native';
import { useNetworkState } from '../hooks/useNetworkState';
import { usePendingWrites } from '../hooks/usePendingWrites';

type Props = { style?: ViewStyle };

export default function OfflineBanner({ style }: Props) {
  const { isOnline, wasOffline, clearWasOffline } = useNetworkState();
  const { hasPending, synced } = usePendingWrites();
  const y = useRef(new Animated.Value(-36)).current;

  const showOffline = !isOnline;
  const showSyncing = isOnline && wasOffline && hasPending;
  const showSynced = isOnline && wasOffline && synced && !hasPending;
  const visible = showOffline || showSyncing || showSynced;

  useEffect(() => {
    Animated.timing(y, {
      toValue: visible ? 0 : -36,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [visible, y]);

  // Auto-dismiss "synced" after 3 seconds
  useEffect(() => {
    if (showSynced) {
      const t = setTimeout(() => clearWasOffline(), 3000);
      return () => clearTimeout(t);
    }
  }, [showSynced]);

  const bgColor = showOffline ? '#c47b2b' : '#1b4f72';
  const message = showOffline
    ? '📵 No connection — counts saved locally, will sync when back online'
    : showSyncing
    ? '🔄 Back online — syncing your counts…'
    : '✓ All counts synced';

  return (
    <Animated.View
      pointerEvents="none"
      style={[{
        position: 'absolute',
        top: 0, left: 0, right: 0,
        transform: [{ translateY: y }],
        backgroundColor: bgColor,
        paddingVertical: 8,
        paddingHorizontal: 12,
        alignItems: 'center',
        justifyContent: 'center',
        height: 36,
        zIndex: 9999,
      }, style]}
    >
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12, textAlign: 'center' }}>
        {message}
      </Text>
    </Animated.View>
  );
}
