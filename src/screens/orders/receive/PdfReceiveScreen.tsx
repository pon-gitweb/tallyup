// @ts-nocheck
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function PdfReceiveScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>PDF Receive Screen</Text>
      <Text style={styles.subtitle}>Stub implementation - Future</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#666' }
});
