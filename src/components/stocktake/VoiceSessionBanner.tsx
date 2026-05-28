// ═══════════════════════════════════════════════════════════════════
// VoiceSessionBanner
//
// Persistent banner shown below the area screen header during an
// active voice counting session.
//
// Colours:
//   amber      — listening (waiting for product name or count)
//   teal       — product matched, ready for count
//   green      — count saved (brief flash, then back to amber)
//   terracotta — product not found
//   hidden     — voice mode off (renders nothing)
//
// The banner is the user's primary feedback during voice mode.
// It must always show exactly what state the system is in.
// ═══════════════════════════════════════════════════════════════════

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColours } from '../../context/ThemeContext';
import { VoiceSessionState } from '../../services/stocktake/voiceCountingSession';

interface VoiceSessionBannerProps {
  state: VoiceSessionState;
}

export function VoiceSessionBanner({ state }: VoiceSessionBannerProps) {
  const themeColours = useColours();

  if (!state.isActive && state.phase === 'idle') return null;

  const bgColour: string = {
    amber: themeColours.stellarAmber,
    teal: themeColours.deepBlue,
    green: themeColours.positiveStrong,
    terracotta: themeColours.terracotta,
    hidden: 'transparent',
  }[state.bannerColour] ?? themeColours.stellarAmber;

  const isListening = state.phase === 'product' || state.phase === 'count';

  return (
    <View style={[styles.banner, { backgroundColor: bgColour }]}>
      {/* White dot indicates the mic is actively recording */}
      {isListening && <View style={styles.liveDot} />}
      <Text style={styles.bannerText} numberOfLines={3}>
        {state.bannerMessage}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ffffff',
    opacity: 0.9,
    flexShrink: 0,
  },
  bannerText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
});
