import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';

export default function ReportsScreen() {
  const nav = useNavigation<any>();

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Reports</Text>
      <View style={styles.grid}>
        <TouchableOpacity style={styles.btn} onPress={() => nav.navigate('VarianceSnapshot')}>
          <Text style={styles.btnText}>Variance Snapshot</Text>
          <Text style={styles.blurb}>Shortages / Excess vs par with value impact.</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.btn} onPress={() => nav.navigate('LastCycleSummary')}>
          <Text style={styles.btnText}>Last Cycle Summary</Text>
          <Text style={styles.blurb}>High‑level recap of the latest stock take.</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '800' },
  grid: { gap: 10 },
  btn: { backgroundColor: '#0A84FF', padding: 14, borderRadius: 12 },
  btnText: { color: 'white', fontWeight: '800' },
  blurb: { color: 'white', opacity: 0.9, marginTop: 4 },
});
