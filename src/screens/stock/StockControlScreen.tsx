import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { useNavigation } from '@react-navigation/native';

export default function StockControlScreen() {
  const nav = useNavigation<any>();

  const Item = ({ title, onPress }: { title: string; onPress: () => void }) => (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <Text style={styles.rowText}>{title}</Text>
      <Text style={styles.chev}>›</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={styles.wrap}>
        <Text style={styles.title}>Stock Control</Text>

        <Item title="Manage Suppliers" onPress={() => nav.navigate('Suppliers')} />
        <Item title="Manage Products"  onPress={() => nav.navigate('Products')} />
        <Item title="Suggested Orders" onPress={() => nav.navigate('SuggestedOrder')} />
        <Item title="Orders"           onPress={() => nav.navigate('Orders')} />
        <Item
          title="Reset Stock Take"
          onPress={() => {
            // For now, route to Settings where reset currently lives / will live.
            // When a dedicated reset screen exists, change this to nav.navigate('ResetStockTake').
            nav.navigate('Settings');
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, backgroundColor: 'white' },
  title: { fontSize: 22, fontWeight: '800', marginBottom: 12 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 10, backgroundColor: '#F9FAFB'
  },
  rowText: { fontSize: 16, fontWeight: '700' },
  chev: { fontSize: 22, color: '#94A3B8', marginLeft: 8 },
});
