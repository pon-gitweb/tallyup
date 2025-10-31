// @ts-nocheck
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function GenericCsvProcessorScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>CSV Processor Screen</Text>
      <Text style={styles.subtitle}>Stub implementation - Phase 1</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#666' }
});
