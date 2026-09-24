// @ts-nocheck
// Festival dashboard hero — "Next Steps" carousel.
// Soft guidance: suggests an order, never locks or forces a step.
// Content comes from config/festivalNextSteps.ts.
import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, useWindowDimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useColours } from '../../../context/ThemeContext';
import {
  FESTIVAL_NEXT_STEPS, FestivalNextStep, NextStepContext,
} from '../../../config/festivalNextSteps';

const H_PADDING = 20;   // must match FestivalDashboardScreen ScrollView padding
const GAP = 12;
const PEEK = 28;        // how much of the next card shows — the swipe affordance

// Collect every route name reachable by nav.navigate from here (tab + parent stacks).
function collectRouteNames(nav: any): Set<string> {
  const names = new Set<string>();
  let current = nav;
  let guard = 0;
  while (current && guard < 6) {
    try {
      const state = current.getState?.();
      state?.routeNames?.forEach((n: string) => names.add(n));
    } catch {}
    current = current.getParent?.();
    guard += 1;
  }
  return names;
}

export default function FestivalNextSteps({ ctx }: { ctx: NextStepContext }) {
  const nav = useNavigation<any>();
  const c = useColours();
  const S = makeStyles(c);
  const { width: windowWidth } = useWindowDimensions();
  const [index, setIndex] = useState(0);

  const steps = useMemo(() => {
    const routeNames = collectRouteNames(nav);
    const visible = FESTIVAL_NEXT_STEPS.filter((s: FestivalNextStep) => {
      if (!ctx.role || !s.roles.includes(ctx.role)) return false;
      if (routeNames.size > 0 && !routeNames.has(s.route)) {
        if (__DEV__) console.warn(`[FestivalNextSteps] "${s.key}" → unregistered route "${s.route}", hidden`);
        return false;
      }
      try { return s.isVisible ? !!s.isVisible(ctx) : true; } catch { return false; }
    }).map(s => {
      let done = false;
      try { done = s.isDone ? !!s.isDone(ctx) : false; } catch {}
      return { ...s, done };
    });
    // Stable: not-done steps first in config order, done steps after.
    return [...visible.filter(s => !s.done), ...visible.filter(s => s.done)];
  }, [nav, ctx.role, ctx.setupDone, ctx.setupTotal, ctx.setupComplete,
      ctx.hasOrders, ctx.productCount, ctx.event]);

  if (steps.length === 0) return null;

  const viewportWidth = windowWidth - H_PADDING * 2;
  const single = steps.length === 1;
  const cardWidth = single ? viewportWidth : viewportWidth - PEEK;
  const interval = cardWidth + GAP;
  const contentWidth = steps.length * cardWidth + (steps.length - 1) * GAP;
  const maxOffset = Math.max(0, contentWidth - viewportWidth);
  // Explicit offsets so the final card snaps flush right instead of bouncing back.
  const offsets = steps.map((_, i) => Math.min(i * interval, maxOffset));
  const safeIndex = Math.min(index, steps.length - 1);
  const firstOpenKey = steps.find(s => !s.done)?.key;

  const onScroll = (e: any) => {
    const x = e.nativeEvent.contentOffset.x;
    let nearest = 0;
    offsets.forEach((o, i) => { if (Math.abs(o - x) < Math.abs(offsets[nearest] - x)) nearest = i; });
    if (nearest !== index) setIndex(nearest);
  };

  const renderCard = (s: any) => {
    const body = typeof s.body === 'function' ? s.body(ctx) : s.body;
    const suggested = s.key === firstOpenKey;
    return (
      <View key={s.key} style={[S.card, { width: cardWidth }, s.done && S.cardDone]}>
        <View style={S.cardTop}>
          <Text style={S.phase} numberOfLines={1}>{s.phase}</Text>
          {suggested && <View style={S.chip}><Text style={S.chipText}>Suggested</Text></View>}
          {s.done && <View style={[S.chip, S.chipDone]}><Text style={S.chipDoneText}>Done ✓</Text></View>}
        </View>
        <Text style={S.title}>{s.title}</Text>
        <Text style={S.body} numberOfLines={3}>{body}</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          style={S.btn}
          accessibilityRole="button"
          accessibilityLabel={`${s.cta}. ${s.title}`}
          onPress={() => nav.navigate(s.route, s.params)}
        >
          <Text style={S.btnText}>{s.done ? 'Open →' : `${s.cta} →`}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={S.heading}>NEXT STEPS</Text>
      {single ? renderCard(steps[0]) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            snapToOffsets={offsets}
            disableIntervalMomentum
            onScroll={onScroll}
            scrollEventThrottle={32}
            contentContainerStyle={{ gap: GAP }}
          >
            {steps.map(renderCard)}
          </ScrollView>
          <View style={S.dots} accessibilityLabel={`Step ${safeIndex + 1} of ${steps.length}`}>
            {steps.map((s, i) => (
              <View key={s.key} style={[S.dot, i === safeIndex && S.dotActive]} />
            ))}
          </View>
        </>
      )}
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    heading: {
      fontSize: 11, fontWeight: '800', color: c.slateMid,
      letterSpacing: 1, marginTop: 8, marginBottom: 10,
    },
    card: {
      backgroundColor: c.missionSlate, borderRadius: 16, padding: 20, minHeight: 190,
    },
    cardDone: { opacity: 0.72 },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
    phase: {
      flexShrink: 1, fontSize: 11, fontWeight: '500', color: 'rgba(245,243,238,0.6)',
      textTransform: 'uppercase', letterSpacing: 0.88,
    },
    chip: { backgroundColor: c.stellarAmber, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8 },
    chipText: { fontSize: 10, fontWeight: '800', color: c.oat, letterSpacing: 0.3 },
    chipDone: { backgroundColor: 'rgba(245,243,238,0.15)' },
    chipDoneText: { fontSize: 10, fontWeight: '800', color: c.oat },
    title: { fontSize: 18, fontWeight: '600', color: c.oat, marginBottom: 6 },
    body: { fontSize: 13, color: 'rgba(245,243,238,0.65)', lineHeight: 19.5, marginBottom: 16 },
    btn: {
      height: 44, borderRadius: 999, backgroundColor: c.oat,
      alignItems: 'center', justifyContent: 'center',
    },
    btnText: { color: c.missionSlate, fontWeight: '700', fontSize: 15 },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.border },
    dotActive: { width: 18, backgroundColor: c.deepBlue },
  });
}
