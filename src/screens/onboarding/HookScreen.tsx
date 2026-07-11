// @ts-nocheck
import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Animated, StatusBar, Dimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useColours } from '../../context/ThemeContext';

const { height } = Dimensions.get('window');

export default function HookScreen() {
  const nav = useNavigation<any>();
  const c = useColours();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const btnAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Headline fades and slides up
    Animated.sequence([
      Animated.delay(300),
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
      ]),
      Animated.delay(400),
      // Button fades in after headline settles
      Animated.timing(btnAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: c.navy, paddingHorizontal: 32 }}>
      <StatusBar barStyle="light-content" />

      {/* Spacer */}
      <View style={{ flex: 1 }} />

      {/* Headline */}
      <Animated.View style={{
        opacity: fadeAnim,
        transform: [{ translateY: slideAnim }],
        marginBottom: 48,
      }}>
        <Text style={{
          fontSize: 13, fontWeight: '600', color: 'rgba(245,243,238,0.5)',
          textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 20,
        }}>
          HOSTI · VENUE INTELLIGENCE
        </Text>
        <Text style={{
          fontSize: 36, fontWeight: '800', color: '#f5f3ee',
          lineHeight: 44, marginBottom: 20,
        }}>
          Most venues take{'\n'}3 hours to stocktake.
        </Text>
        <Text style={{
          fontSize: 36, fontWeight: '800',
          color: c.stellarAmber || '#c47b2b',
          lineHeight: 44, marginBottom: 32,
        }}>
          Hosti users do it{'\n'}in under an hour.
        </Text>
        <Text style={{
          fontSize: 16, color: 'rgba(245,243,238,0.65)',
          lineHeight: 24,
        }}>
          Two minutes and you'll see exactly how.
        </Text>
      </Animated.View>

      {/* CTA */}
      <Animated.View style={{ opacity: btnAnim, marginBottom: 48 }}>
        <TouchableOpacity
          onPress={() => nav.navigate('DemoCount')}
          style={{
            backgroundColor: '#f5f3ee',
            borderRadius: 999, height: 56,
            alignItems: 'center', justifyContent: 'center',
            marginBottom: 16,
          }}
          activeOpacity={0.85}
        >
          <Text style={{ color: c.navy, fontWeight: '800', fontSize: 17 }}>
            Show me →
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => nav.navigate('OnboardingRoad')}
          style={{ alignItems: 'center', paddingVertical: 12 }}
        >
          <Text style={{ color: 'rgba(245,243,238,0.75)', fontSize: 14, fontWeight: '600' }}>
            Skip to setup
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}
