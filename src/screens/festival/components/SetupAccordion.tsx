// @ts-nocheck
// Festival event setup — shared accordion header components.
// SectionHeader: the 6 top-level sections.
// ItemRow: nested items (bars, locations, suppliers) — no badge.
// ProgressLine: slim progress indicator replacing the old card.
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColours } from '../../../context/ThemeContext';

export function SectionHeader({ n, title, complete, expanded, onPress, summary, unsaved }) {
  const c = useColours();
  const inner = (
    <View style={{
      flexDirection: 'row', alignItems: 'center',
      minHeight: 48, gap: 10,
    }}>
      {/* Badge — 24px, no solid deepBlue */}
      <View style={{
        width: 24, height: 24, borderRadius: 12,
        backgroundColor: complete ? c.positiveSoft : c.border,
        alignItems: 'center', justifyContent: 'center',
      }}>
        {complete
          ? <Text style={{ fontSize: 11, fontWeight: '800', color: c.success }}>✓</Text>
          : <Text style={{ fontSize: 12, fontWeight: '700', color: c.navy }}>{n}</Text>
        }
      </View>

      {/* Title + collapsed summary */}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: c.navy }} numberOfLines={1}>
          {title}
        </Text>
        {!expanded && (
          unsaved
            ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.amber }} />
                <Text style={{ fontSize: 13, color: c.amber }}>Unsaved changes</Text>
              </View>
            : summary
              ? <Text style={{ fontSize: 13, color: c.slateMid, marginTop: 2 }} numberOfLines={1}>{summary}</Text>
              : null
        )}
      </View>

      {!!onPress && (
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={c.slateMid}
        />
      )}
    </View>
  );

  if (!onPress) return inner;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ expanded: !!expanded }}
    >
      {inner}
    </TouchableOpacity>
  );
}

export function ItemRow({ name, summary, hint, expanded, onPress, onLongPress = undefined }) {
  const c = useColours();
  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ expanded: !!expanded }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: '500', color: c.navy }}>{name}</Text>
          {!expanded && (
            hint
              ? <Text style={{ fontSize: 13, color: c.amber, marginTop: 2 }} numberOfLines={1}>{hint}</Text>
              : summary
                ? <Text style={{ fontSize: 13, color: c.slateMid, marginTop: 2 }} numberOfLines={1}>{summary}</Text>
                : null
          )}
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={c.slateMid}
        />
      </View>
    </TouchableOpacity>
  );
}

export function ProgressLine({ done, total }) {
  const c = useColours();
  const allDone = total > 0 && done === total;
  const pct = total > 0 ? done / total : 0;
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{
        fontSize: 13, fontWeight: '600',
        color: allDone ? c.success : c.navy,
        marginBottom: 6,
      }}>
        {allDone ? 'Setup complete' : `${done} of ${total} sections complete`}
      </Text>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: c.border, overflow: 'hidden' }}>
        <View style={{
          height: 4, borderRadius: 2,
          backgroundColor: allDone ? c.success : c.deepBlue,
          width: `${Math.round(pct * 100)}%`,
        }} />
      </View>
    </View>
  );
}
