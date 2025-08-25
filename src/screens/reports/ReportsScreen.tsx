import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';

export default function ReportsScreen() {
  const nav = useNavigation<any>();

  function comingSoon(title: string) {
    Alert.alert(title, 'Coming soon. This is a stub in the MVP.');
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Reports</Text>

      <TouchableOpacity style={styles.row} onPress={() => nav.navigate('LastCycleSummary')}>
        <Text style={styles.rowText}>Last Cycle Summary</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.row} onPress={() => comingSoon('Variance Report')}>
        <Text style={styles.rowText}>Variance Report</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.row} onPress={() => comingSoon('Top Movers')}>
        <Text style={styles.rowText}>Top Movers</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.row} onPress={() => comingSoon('Slow Movers')}>
        <Text style={styles.rowText}>Slow Movers</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.row} onPress={() => comingSoon('Waste & Loss')}>
        <Text style={styles.rowText}>Waste &amp; Loss</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.row} onPress={() => comingSoon('Supplier Performance')}>
        <Text style={styles.rowText}>Supplier Performance</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '800' },
  row: { backgroundColor: '#EFEFF4', padding: 14, borderRadius: 12 },
  rowText: { fontWeight: '700' },
});
