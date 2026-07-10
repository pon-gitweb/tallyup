// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, ActivityIndicator } from 'react-native';
import { useColours } from '../context/ThemeContext';

interface SmartLoaderProps {
  messages: string[];          // rotating messages relevant to what's happening
  intervalMs?: number;         // how long each message shows (default 1200ms)
  showSpinner?: boolean;       // show spinner alongside text (default true)
  size?: 'small' | 'large';
  style?: any;
}

export function SmartLoader({
  messages,
  intervalMs = 1200,
  showSpinner = true,
  size = 'small',
  style,
}: SmartLoaderProps) {
  const c = useColours();
  const [index, setIndex] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (messages.length <= 1) return;
    const interval = setInterval(() => {
      // Fade out
      Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        setIndex(i => (i + 1) % messages.length);
        // Fade in
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      });
    }, intervalMs);
    return () => clearInterval(interval);
  }, [messages.length, intervalMs]);

  return (
    <View style={[{ alignItems: 'center', justifyContent: 'center', gap: 12 }, style]}>
      {showSpinner && <ActivityIndicator color={c.primary || '#1b4f72'} size={size} />}
      <Animated.Text style={{
        opacity: fadeAnim,
        fontSize: 13,
        color: c.textSecondary || '#6b7280',
        textAlign: 'center',
        fontWeight: '500',
      }}>
        {messages[index]}
      </Animated.Text>
    </View>
  );
}

// Pre-defined message sets for common operations
export const LOADER_MESSAGES = {
  invoicePhoto: [
    'Reading your invoice...',
    'Finding your products...',
    'Matching to your catalogue...',
    'Almost there...',
  ],
  invoiceCsv: [
    'Reading your file...',
    'Finding your products...',
    'Checking prices...',
    'Almost there...',
  ],
  shelfPhoto: [
    'Taking a look at your shelf...',
    'Counting what I can see...',
    'Checking my work...',
  ],
  suggestedOrders: [
    'Checking your velocity...',
    'Looking at what you\'ve ordered before...',
    'Building your order...',
  ],
  hostiHealth: [
    'Pulling your stocktake data...',
    'Calculating your KPIs...',
    'Putting your score together...',
  ],
  suitee: [
    'Looking at your venue data...',
    'Thinking this through...',
    'Almost ready...',
  ],
  festivalSession: [
    'Saving your counts...',
    'Locking in the session...',
    'Almost done...',
  ],
  generic: [
    'Working on it...',
    'Almost there...',
  ],
};
