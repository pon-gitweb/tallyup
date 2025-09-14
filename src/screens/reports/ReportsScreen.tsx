import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';

export default function ReportsScreen() {
  const nav = useNavigation<any>();
  const soon = (title: string) => Alert.alert(title, 'Coming soon');

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Reports</Text>

      {/* Uniform pill grid (placeholders only) */}
      <View style={styles.pillGrid}>
        <TouchableOpacity style={styles.pillTile} onPress={() => soon('Ask "Izzy" Reports')}>
          <Text style={styles.pillTitle}>Ask "Izzy" Reports</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.pillTile} onPress={() => soon('Invoices')}>
          <Text style={styles.pillTitle}>Invoices</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.pillTile} onPress={() => soon('Wastage')}>
          <Text style={styles.pillTitle}>Wastage</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.pillTile} onPress={() => soon('Stock Value')}>
          <Text style={styles.pillTitle}>Stock Value</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.pillTile} onPress={() => soon('Exports')}>
          <Text style={styles.pillTitle}>Exports</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.pillTile} onPress={() => soon('Budgets (Summary)')}>
          <Text style={styles.pillTitle}>Budgets</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.grid}>
        <TouchableOpacity style={styles.btn} onPress={() => nav.navigate('VarianceSnapshot')}>
          <Text style={styles.btnText}>Variance Snapshot</Text>
          <Text style={styles.blurb}>Shortages / Excess vs par with value impact.</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.btn} onPress={() => nav.navigate('LastCycleSummary')}>
          <Text style={styles.btnText}>Last Cycle Summary</Text>
          <Text style={styles.blurb}>High-level recap of the latest stock take.</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12, backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: '800' },

  // 2-column grid of uniform pills
  pillGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 8,
  },
  pillTile: {
    width: '48%',
    minHeight: 44,
    backgroundColor: '#EFEFF4',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  pillTitle: {
    color: '#111',
    fontWeight: '800',
    textAlign: 'center',
  },

  // Existing big cards
  grid: { gap: 10, marginTop: 6 },
  btn: { backgroundColor: '#0A84FF', padding: 14, borderRadius: 12 },
  btnText: { color: 'white', fontWeight: '800' },
  blurb: { color: 'white', opacity: 0.9, marginTop: 4 },
});


