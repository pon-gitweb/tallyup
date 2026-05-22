// @ts-nocheck
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function FestivalReportsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>🎪</Text>
      <Text style={styles.title}>Festival mode</Text>
      <Text style={styles.body}>
        We're building something great for festival and event operators.
      </Text>
      <Text style={styles.body}>
        This feature is coming soon — we'll let you know when it's live.
      </Text>
      <Text style={styles.contact}>
        Questions? Email us at{'\n'}office@hosti.co.nz
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f3ee',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 36,
  },
  emoji: {
    fontSize: 52,
    marginBottom: 20,
    color: '#1b4f72',
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0B132B',
    textAlign: 'center',
    marginBottom: 16,
    letterSpacing: -0.3,
  },
  body: {
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 12,
  },
  contact: {
    marginTop: 20,
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 22,
  },
});
