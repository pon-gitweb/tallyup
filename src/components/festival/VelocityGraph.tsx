// @ts-nocheck
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { DepletionCurve, DepletionPoint } from '../../services/festival/depletionCurve';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  curve: DepletionCurve;
  width: number;
  height: number;
  showProjection?: boolean;
}

// ─── Line segment renderer ────────────────────────────────────────────────────

interface Segment {
  x1: number; y1: number; x2: number; y2: number;
  color: string; dashed: boolean;
}

function LineSegment({ seg, lineWidth = 2 }: { seg: Segment; lineWidth?: number }) {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.5) return null;
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  const cx = (seg.x1 + seg.x2) / 2;
  const cy = (seg.y1 + seg.y2) / 2;

  return (
    <View
      style={{
        position: 'absolute',
        left: cx - len / 2,
        top: cy - lineWidth / 2,
        width: len,
        height: lineWidth,
        backgroundColor: seg.dashed ? 'transparent' : seg.color,
        borderStyle: seg.dashed ? 'dashed' : 'solid',
        borderBottomWidth: seg.dashed ? lineWidth : 0,
        borderBottomColor: seg.dashed ? seg.color : 'transparent',
        transform: [{ rotate: `${angle}deg` }],
        opacity: 0.9,
      }}
    />
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function VelocityGraph({ curve, width, height, showProjection = true }: Props) {
  const PADDING = { top: 12, right: 12, bottom: 28, left: 36 };
  const chartW = width - PADDING.left - PADDING.right;
  const chartH = height - PADDING.top - PADDING.bottom;

  const { segments, selloutDot, timeLabels, stockLabels, targetLine } = useMemo(() => {
    const points = curve.points;
    if (points.length < 2) return { segments: [], selloutDot: null, timeLabels: [], stockLabels: [], targetLine: null };

    const times = points.map(p => p.time.getTime());
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const stocks = points.map(p => p.stock);
    const maxS = Math.max(...stocks, 1);

    function tx(t: number) {
      return chartW * ((t - minT) / (maxT - minT || 1));
    }
    function ty(s: number) {
      return chartH * (1 - s / maxS);
    }

    // Separate actual vs projected groups
    const segs: Segment[] = [];

    // Actual points (solid navy)
    const actualPts = points.filter(p => p.isActual);
    for (let i = 0; i < actualPts.length - 1; i++) {
      segs.push({
        x1: tx(actualPts[i].time.getTime()),
        y1: ty(actualPts[i].stock),
        x2: tx(actualPts[i + 1].time.getTime()),
        y2: ty(actualPts[i + 1].stock),
        color: '#1b4f72',
        dashed: false,
      });
    }

    // Projected points (dashed teal)
    if (showProjection) {
      const projPts = points.filter(p => !p.isActual);
      // Connect from last actual to first projected
      if (actualPts.length > 0 && projPts.length > 0) {
        const lastActual = actualPts[actualPts.length - 1];
        segs.push({
          x1: tx(lastActual.time.getTime()),
          y1: ty(lastActual.stock),
          x2: tx(projPts[0].time.getTime()),
          y2: ty(projPts[0].stock),
          color: '#0d9488',
          dashed: true,
        });
      }
      for (let i = 0; i < projPts.length - 1; i++) {
        segs.push({
          x1: tx(projPts[i].time.getTime()),
          y1: ty(projPts[i].stock),
          x2: tx(projPts[i + 1].time.getTime()),
          y2: ty(projPts[i + 1].stock),
          color: '#0d9488',
          dashed: true,
        });
      }
    }

    // Sellout dot (red)
    let selloutDot: { x: number; y: number } | null = null;
    if (curve.selloutTime) {
      const sot = curve.selloutTime.getTime();
      if (sot >= minT && sot <= maxT) {
        selloutDot = { x: tx(sot), y: ty(0) };
      }
    }

    // Target remaining dashed line (yellow at y = targetRemaining if 0 it's the x axis)
    const targetLine: { y: number } | null = { y: ty(0) };

    // Time labels (2-3 ticks)
    const timeLabels: { x: number; label: string }[] = [];
    const timeTicks = [minT, (minT + maxT) / 2, maxT];
    for (const t of timeTicks) {
      const d = new Date(t);
      const label = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
      timeLabels.push({ x: tx(t), label });
    }

    // Stock labels (2-3 ticks on y-axis)
    const stockLabels: { y: number; label: string }[] = [];
    const ticks = [0, Math.round(maxS / 2), maxS];
    for (const s of ticks) {
      stockLabels.push({ y: ty(s), label: s.toFixed(0) });
    }

    return { segments: segs, selloutDot, timeLabels, stockLabels, targetLine };
  }, [curve, chartW, chartH, showProjection]);

  if (curve.points.length < 2) {
    return (
      <View style={[G.empty, { width, height }]}>
        <Text style={G.emptyText}>Not enough data to chart</Text>
      </View>
    );
  }

  return (
    <View style={{ width, height }}>
      {/* Y-axis labels */}
      {stockLabels.map((sl, i) => (
        <Text
          key={i}
          style={[G.axisLabel, {
            position: 'absolute',
            left: 0,
            top: PADDING.top + sl.y - 7,
            width: PADDING.left - 4,
            textAlign: 'right',
          }]}
        >
          {sl.label}
        </Text>
      ))}

      {/* Chart area */}
      <View
        style={{
          position: 'absolute',
          left: PADDING.left,
          top: PADDING.top,
          width: chartW,
          height: chartH,
          overflow: 'hidden',
        }}
      >
        {/* Gridlines */}
        {stockLabels.map((sl, i) => (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: 0, right: 0,
              top: sl.y,
              height: 1,
              backgroundColor: '#e5e7eb',
            }}
          />
        ))}

        {/* Target line (baseline) */}
        {targetLine && (
          <View
            style={{
              position: 'absolute',
              left: 0, right: 0,
              top: targetLine.y,
              height: 1,
              borderBottomWidth: 1,
              borderBottomColor: '#fbbf24',
              borderStyle: 'dashed',
            }}
          />
        )}

        {/* Line segments */}
        {segments.map((seg, i) => (
          <LineSegment key={i} seg={seg} lineWidth={2} />
        ))}

        {/* Sellout dot */}
        {selloutDot && (
          <View
            style={{
              position: 'absolute',
              left: selloutDot.x - 5,
              top: selloutDot.y - 5,
              width: 10, height: 10,
              borderRadius: 5,
              backgroundColor: '#dc2626',
            }}
          />
        )}
      </View>

      {/* X-axis labels */}
      {timeLabels.map((tl, i) => (
        <Text
          key={i}
          style={[G.axisLabel, {
            position: 'absolute',
            left: PADDING.left + tl.x - 20,
            top: PADDING.top + chartH + 6,
            width: 40,
            textAlign: 'center',
          }]}
        >
          {tl.label}
        </Text>
      ))}

      {/* Legend */}
      <View style={[G.legend, { bottom: 0, right: 0 }]}>
        <View style={G.legendItem}>
          <View style={[G.legendLine, { backgroundColor: '#1b4f72' }]} />
          <Text style={G.legendText}>Actual</Text>
        </View>
        {showProjection && (
          <View style={G.legendItem}>
            <View style={[G.legendLine, { backgroundColor: '#0d9488', borderStyle: 'dashed' }]} />
            <Text style={G.legendText}>Projected</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const G = StyleSheet.create({
  empty:     { alignItems: 'center', justifyContent: 'center', backgroundColor: '#f9fafb', borderRadius: 10 },
  emptyText: { fontSize: 13, color: '#9ca3af' },
  axisLabel: { fontSize: 9, color: '#9ca3af', fontWeight: '600' },
  legend:    { position: 'absolute', flexDirection: 'row', gap: 10, paddingRight: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendLine: { width: 16, height: 2 },
  legendText: { fontSize: 9, color: '#6b7280' },
});
