// @ts-nocheck
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Image,
  PanResponder,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

const { width: SW, height: SH } = Dimensions.get('window');
const CARD_W = Math.round(SW * 0.65);
// Clamp height — screenshots are 9:19.5 but we show a cropped preview
const CARD_H = Math.round(Math.min(CARD_W * 2.16, SH * 0.40));

const SLIDES = [
  require('../../../screenshots/01_dashboard.png'),
  require('../../../screenshots/02_reports.png'),
  require('../../../screenshots/03_stocktake.png'),
];

const INTERVAL_MS = 3000;
const appIcon = require('../../../assets/icon.png');

export default function LandingScreen() {
  const nav = useNavigation<any>();
  const [slideIndex, setSlideIndex] = useState(0);
  const slideRef = useRef(0);
  const opacity = useRef(new Animated.Value(1)).current;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fadeTo = useCallback(
    (next: number) => {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        slideRef.current = next;
        setSlideIndex(next);
        Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      });
    },
    [opacity],
  );

  const startTimer = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      fadeTo((slideRef.current + 1) % SLIDES.length);
    }, INTERVAL_MS);
  }, [fadeTo]);

  useEffect(() => {
    startTimer();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [startTimer]);

  // Ref-wrapped so PanResponder (created once) always sees the latest version
  const goToSlide = useRef<(n: number) => void>(() => {});
  useEffect(() => {
    goToSlide.current = (n: number) => {
      if (n === slideRef.current) return;
      fadeTo(n);
      startTimer();
    };
  }, [fadeTo, startTimer]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, { dx, dy }) =>
        Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 12,
      onPanResponderRelease: (_, { dx }) => {
        if (dx < -40) goToSlide.current((slideRef.current + 1) % SLIDES.length);
        else if (dx > 40) goToSlide.current((slideRef.current - 1 + SLIDES.length) % SLIDES.length);
      },
    }),
  ).current;

  return (
    <SafeAreaView style={S.safe}>
      {/* Brand */}
      <View style={S.brand}>
        <Image source={appIcon} style={S.icon} resizeMode="contain" />
        <Text style={S.appName}>Hosti</Text>
        <Text style={S.tagline}>Know your stock. Know your numbers.</Text>
      </View>

      {/* Carousel */}
      <View style={S.carouselWrap} {...panResponder.panHandlers}>
        <Animated.View style={[S.card, { opacity }]}>
          <Image source={SLIDES[slideIndex]} style={S.screenshot} resizeMode="cover" />
        </Animated.View>

        {/* Dot indicators */}
        <View style={S.dots}>
          {SLIDES.map((_, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => goToSlide.current(i)}
              style={[S.dot, i === slideIndex && S.dotActive]}
            />
          ))}
        </View>
      </View>

      {/* CTAs */}
      <View style={S.bottom}>
        <TouchableOpacity
          style={S.btnPrimary}
          onPress={() => nav.navigate('Login')}
          activeOpacity={0.85}
        >
          <Text style={S.btnPrimaryText}>Sign In</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={S.btnSecondary}
          onPress={() => nav.navigate('Register')}
          activeOpacity={0.85}
        >
          <Text style={S.btnSecondaryText}>Create Account</Text>
        </TouchableOpacity>

        <Text style={S.copyright}>© 2026 StackMosaic Ltd</Text>
      </View>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#f5f3ee',
  },

  brand: {
    alignItems: 'center',
    paddingTop: 40,
    paddingBottom: 20,
  },
  icon: {
    width: 80,
    height: 80,
    borderRadius: 18,
    marginBottom: 14,
  },
  appName: {
    fontSize: 34,
    fontWeight: '700',
    color: '#0B132B',
    letterSpacing: 0.4,
  },
  tagline: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 6,
    textAlign: 'center',
    paddingHorizontal: 32,
    lineHeight: 22,
  },

  carouselWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#e5e3de',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
    elevation: 5,
  },
  screenshot: {
    width: '100%',
    height: '100%',
  },

  dots: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 18,
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#D1D5DB',
  },
  dotActive: {
    width: 20,
    backgroundColor: '#1b4f72',
  },

  bottom: {
    paddingHorizontal: 24,
    paddingBottom: 12,
  },
  btnPrimary: {
    height: 52,
    borderRadius: 14,
    backgroundColor: '#1b4f72',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  btnSecondary: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#0B132B',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  btnSecondaryText: {
    color: '#0B132B',
    fontSize: 16,
    fontWeight: '700',
  },
  copyright: {
    fontSize: 11,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 16,
  },
});
