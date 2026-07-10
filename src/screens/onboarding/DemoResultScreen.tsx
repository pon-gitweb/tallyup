// @ts-nocheck
import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Animated } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useColours } from '../../context/ThemeContext';

export default function DemoResultScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const c = useColours();
  const { elapsedSeconds = 120 } = route.params || {};

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  // Scale up at 450 items
  const solo450 = Math.round((elapsedSeconds / 10) * 450 / 60);
  const team2 = Math.round(solo450 * 0.55);
  const team3 = Math.round(solo450 * 0.38);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, friction: 6, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: c.navy, paddingHorizontal: 28 }}>
      <View style={{ flex: 1 }} />

      <Animated.View style={{
        opacity: fadeAnim,
        transform: [{ scale: scaleAnim }],
        marginBottom: 48,
      }}>
        <Text style={{
          fontSize: 13, fontWeight: '600', color: 'rgba(245,243,238,0.5)',
          textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 20,
        }}>
          DEMO COMPLETE
        </Text>

        <Text style={{ fontSize: 48, fontWeight: '800', color: c.stellarAmber || '#c47b2b', marginBottom: 8 }}>
          ⚡
        </Text>

        <Text style={{ fontSize: 28, fontWeight: '800', color: '#f5f3ee', marginBottom: 8, lineHeight: 36 }}>
          10 items in {elapsedSeconds} seconds.
        </Text>

        <Text style={{ fontSize: 17, color: 'rgba(245,243,238,0.65)', lineHeight: 26, marginBottom: 32 }}>
          At that pace, a 450-item venue:
        </Text>

        {/* Time estimates */}
        {[
          { label: 'Solo', time: `~${solo450} min`, note: 'vs 3+ hours manually' },
          { label: '2 people', time: `~${team2} min`, note: '' },
          { label: '3 people', time: `~${team3} min`, note: '' },
        ].map((row, i) => (
          <View key={i} style={{
            flexDirection: 'row', alignItems: 'center',
            paddingVertical: 12,
            borderTopWidth: i > 0 ? 1 : 0,
            borderTopColor: 'rgba(245,243,238,0.1)',
          }}>
            <Text style={{ fontSize: 15, color: 'rgba(245,243,238,0.6)', flex: 1 }}>{row.label}</Text>
            <Text style={{ fontSize: 20, fontWeight: '800', color: '#f5f3ee', marginRight: 8 }}>{row.time}</Text>
            {row.note ? <Text style={{ fontSize: 12, color: 'rgba(245,243,238,0.4)' }}>{row.note}</Text> : null}
          </View>
        ))}
      </Animated.View>

      {/* CTA */}
      <Animated.View style={{ opacity: fadeAnim, marginBottom: 48 }}>
        <TouchableOpacity
          onPress={() => nav.navigate('OnboardingRoad')}
          style={{
            backgroundColor: '#f5f3ee', borderRadius: 999, height: 56,
            alignItems: 'center', justifyContent: 'center', marginBottom: 16,
          }}
        >
          <Text style={{ color: c.navy, fontWeight: '800', fontSize: 17 }}>
            Set up my venue →
          </Text>
        </TouchableOpacity>
        <Text style={{ textAlign: 'center', fontSize: 13, color: 'rgba(245,243,238,0.35)' }}>
          These are your numbers. This is your pace.
        </Text>
      </Animated.View>
    </View>
  );
}
