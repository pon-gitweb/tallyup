import React, { useEffect, useRef } from 'react';
import { Animated, Text, ViewStyle } from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';

type Props = { style?: ViewStyle };

export default function OfflineBanner({ style }: Props) {
  const net = useNetInfo();
  const offline = net.isConnected === false || net.isInternetReachable === false;
  const y = useRef(new Animated.Value(-30)).current; // slide from top

  useEffect(() => {
    Animated.timing(y, {
      toValue: offline ? 0 : -30,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [offline, y]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[{
        position: 'absolute',
        top: 0, left: 0, right: 0,
        transform: [{ translateY: y }],
        backgroundColor: '#111827',
        borderBottomWidth: 1, borderColor: '#374151',
        paddingVertical: 6, paddingHorizontal: 12,
        alignItems: 'center', justifyContent: 'center',
        zIndex: 9999,
      }, style]}
    >
      <Text style={{ color: '#FCD34D', fontWeight: '700', fontSize: 12 }}>
        Working offline — syncing when back
      </Text>
    </Animated.View>
  );
}
