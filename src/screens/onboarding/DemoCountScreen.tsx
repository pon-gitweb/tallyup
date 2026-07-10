// @ts-nocheck
import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  Animated, Vibration, Platform, Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useColours } from '../../context/ThemeContext';

// The Anchor Bar — fictional NZ bar, consistent across all demos
const DEMO_PRODUCTS = [
  { id: '1', name: 'Heineken 330ml', category: 'Beer', mode: 'manual', tip: null },
  { id: '2', name: 'Steinlager Pure 330ml', category: 'Beer', mode: 'manual', tip: null },
  { id: '3', name: 'Corona 330ml', category: 'Beer', mode: 'manual', tip: 'Tap the count field and type the number — simple as that.' },
  { id: '4', name: 'Absolut Vodka 1L', category: 'Spirits', mode: 'voice', tip: 'Try voice — tap the mic and say the number out loud.' },
  { id: '5', name: 'Hendricks Gin 700ml', category: 'Spirits', mode: 'voice', tip: null },
  { id: '6', name: 'Kahlua 1L', category: 'Spirits', mode: 'voice', tip: 'Voice saves about 2 seconds per item. On 450 products that\'s 15 minutes back.' },
  { id: '7', name: 'House Chardonnay 750ml', category: 'Wine', mode: 'scan', tip: 'Barcode scan — point at any barcode and it fills itself in.' },
  { id: '8', name: 'Cloudy Bay Sav Blanc 750ml', category: 'Wine', mode: 'scan', tip: null },
  { id: '9', name: 'Espresso Martini Mix 1L', category: 'Cocktail', mode: 'photo', tip: 'AI shelf photo — photograph a shelf and we count for you.' },
  { id: '10', name: 'Still Water 500ml', category: 'Non-alcoholic', mode: 'photo', tip: null },
];

const MODE_LABELS: Record<string, string> = {
  manual: '⌨️ Manual',
  voice: '🎤 Voice',
  scan: '📷 Barcode',
  photo: '🤖 AI Photo',
};

export default function DemoCountScreen() {
  const nav = useNavigation<any>();
  const c = useColours();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [startTime] = useState(Date.now());
  const [listening, setListening] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const micScale = useRef(new Animated.Value(1)).current;

  const currentProduct = DEMO_PRODUCTS[currentIndex];
  const isLast = currentIndex === DEMO_PRODUCTS.length - 1;
  const progress = (currentIndex / DEMO_PRODUCTS.length);

  function haptic() {
    if (Platform.OS === 'android') Vibration.vibrate(30);
    // iOS haptic via expo-haptics if available
    try {
      const Haptics = require('expo-haptics');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}
  }

  function slideToNext() {
    Animated.sequence([
      Animated.timing(slideAnim, { toValue: -30, duration: 150, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 30, duration: 0, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();
  }

  function confirmCount() {
    const val = counts[currentProduct.id];
    if (!val || val.trim() === '') return;
    haptic();
    slideToNext();
    if (isLast) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      nav.navigate('DemoResult', { elapsedSeconds: elapsed });
    } else {
      setCurrentIndex(i => i + 1);
    }
  }

  function simulateVoice() {
    setListening(true);
    // Animate mic pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(micScale, { toValue: 1.3, duration: 400, useNativeDriver: true }),
        Animated.timing(micScale, { toValue: 1, duration: 400, useNativeDriver: true }),
      ])
    ).start();
    // Simulate voice recognition after 1.5 seconds
    setTimeout(() => {
      setListening(false);
      micScale.stopAnimation();
      micScale.setValue(1);
      const fakeCount = String(Math.floor(Math.random() * 8) + 2);
      setCounts(prev => ({ ...prev, [currentProduct.id]: fakeCount }));
    }, 1500);
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.oat }}>

      {/* Header */}
      <View style={{
        backgroundColor: c.navy, paddingTop: 56, paddingBottom: 16,
        paddingHorizontal: 20,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Text style={{ fontSize: 13, color: 'rgba(245,243,238,0.6)', fontWeight: '600' }}>
            THE ANCHOR BAR · DEMO
          </Text>
          <TouchableOpacity onPress={() => nav.navigate('OnboardingRoad')}>
            <Text style={{ fontSize: 13, color: 'rgba(245,243,238,0.5)' }}>Skip</Text>
          </TouchableOpacity>
        </View>

        {/* Progress bar */}
        <View style={{ height: 4, backgroundColor: 'rgba(245,243,238,0.15)', borderRadius: 2, overflow: 'hidden' }}>
          <Animated.View style={{
            height: 4,
            width: `${progress * 100}%`,
            backgroundColor: c.stellarAmber || '#c47b2b',
            borderRadius: 2,
          }} />
        </View>
        <Text style={{ fontSize: 12, color: 'rgba(245,243,238,0.5)', marginTop: 6 }}>
          {currentIndex} of {DEMO_PRODUCTS.length} items
        </Text>
      </View>

      {/* Product card */}
      <Animated.View style={{
        transform: [{ translateX: slideAnim }],
        flex: 1, padding: 20,
      }}>

        {/* Mode badge */}
        <View style={{
          alignSelf: 'flex-start',
          backgroundColor: c.navy,
          borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
          marginBottom: 12,
        }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: '#f5f3ee' }}>
            {MODE_LABELS[currentProduct.mode]}
          </Text>
        </View>

        {/* Product name */}
        <Text style={{ fontSize: 24, fontWeight: '800', color: c.navy, marginBottom: 4 }}>
          {currentProduct.name}
        </Text>
        <Text style={{ fontSize: 14, color: c.textSecondary, marginBottom: 24 }}>
          {currentProduct.category}
        </Text>

        {/* Izzy tip */}
        {currentProduct.tip && (
          <View style={{
            backgroundColor: '#fff9eb',
            borderRadius: 12, padding: 12,
            borderLeftWidth: 3, borderLeftColor: c.stellarAmber || '#c47b2b',
            marginBottom: 20,
          }}>
            <Text style={{ fontSize: 13, color: '#92400e', lineHeight: 18 }}>
              ✦ {currentProduct.tip}
            </Text>
          </View>
        )}

        {/* Count input */}
        <View style={{
          backgroundColor: '#fff', borderRadius: 14,
          padding: 16, marginBottom: 16,
          borderWidth: 1.5, borderColor: c.border,
        }}>
          <Text style={{ fontSize: 12, fontWeight: '600', color: c.textSecondary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 }}>
            Count
          </Text>
          <TextInput
            value={counts[currentProduct.id] || ''}
            onChangeText={v => setCounts(prev => ({ ...prev, [currentProduct.id]: v }))}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={c.border}
            style={{ fontSize: 36, fontWeight: '800', color: c.navy }}
            returnKeyType="done"
            onSubmitEditing={confirmCount}
            autoFocus={currentProduct.mode === 'manual'}
          />
        </View>

        {/* Voice button — shown for voice mode items */}
        {currentProduct.mode === 'voice' && (
          <TouchableOpacity
            onPress={simulateVoice}
            style={{
              backgroundColor: listening ? '#fee2e2' : c.navy,
              borderRadius: 14, padding: 16,
              alignItems: 'center', marginBottom: 16,
              flexDirection: 'row', justifyContent: 'center', gap: 10,
            }}
          >
            <Animated.Text style={{
              fontSize: 24,
              transform: [{ scale: listening ? micScale : 1 }],
            }}>
              🎤
            </Animated.Text>
            <Text style={{ fontSize: 15, fontWeight: '700', color: listening ? '#dc2626' : '#f5f3ee' }}>
              {listening ? 'Listening...' : 'Tap to speak'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Scan simulation — shown for scan mode */}
        {currentProduct.mode === 'scan' && (
          <TouchableOpacity
            onPress={() => {
              setTimeout(() => {
                setCounts(prev => ({ ...prev, [currentProduct.id]: String(Math.floor(Math.random() * 12) + 1) }));
                haptic();
              }, 800);
            }}
            style={{
              backgroundColor: c.navy, borderRadius: 14, padding: 16,
              alignItems: 'center', marginBottom: 16,
              flexDirection: 'row', justifyContent: 'center', gap: 10,
            }}
          >
            <Text style={{ fontSize: 24 }}>📷</Text>
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#f5f3ee' }}>
              Simulate barcode scan
            </Text>
          </TouchableOpacity>
        )}

        {/* Photo simulation */}
        {currentProduct.mode === 'photo' && (
          <TouchableOpacity
            onPress={() => {
              setTimeout(() => {
                setCounts(prev => ({ ...prev, [currentProduct.id]: String(Math.floor(Math.random() * 20) + 5) }));
                haptic();
              }, 1200);
            }}
            style={{
              backgroundColor: c.navy, borderRadius: 14, padding: 16,
              alignItems: 'center', marginBottom: 16,
              flexDirection: 'row', justifyContent: 'center', gap: 10,
            }}
          >
            <Text style={{ fontSize: 24 }}>🤖</Text>
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#f5f3ee' }}>
              Simulate AI shelf photo
            </Text>
          </TouchableOpacity>
        )}

        {/* Confirm button */}
        <TouchableOpacity
          onPress={confirmCount}
          disabled={!counts[currentProduct.id]}
          style={{
            backgroundColor: counts[currentProduct.id] ? c.primary || '#1b4f72' : c.border,
            borderRadius: 999, height: 52,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: '800', color: '#fff' }}>
            {isLast ? 'Finish demo →' : 'Confirm →'}
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}
