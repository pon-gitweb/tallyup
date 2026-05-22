// @ts-nocheck
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColours } from '../../context/ThemeContext';

export default function FestivalDashboardScreen() {
  const colours = useColours();

  return (
    <View style={[styles.container, { backgroundColor: colours.background }]}>
      <Text style={styles.emoji}>🎪</Text>
      <Text style={[styles.title, { color: colours.text ?? colours.navy }]}>
        Festival mode
      </Text>
      <Text style={[styles.subtitle, { color: colours.textSecondary }]}>
        Setting up your event experience.{'\n'}Coming soon.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
});
