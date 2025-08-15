import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';

type RowProps = { title: string; desc: string; onPress?: () => void };

const Row = ({ title, desc, onPress }: RowProps) => (
  <TouchableOpacity
    onPress={onPress}
    activeOpacity={0.9}
    style={{
      backgroundColor: '#fff',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: '#eaeaea',
      padding: 14,
      marginBottom: 12,
    }}
  >
    <Text style={{ fontWeight: '700', marginBottom: 4 }}>{title}</Text>
    <Text style={{ color: '#666' }}>{desc}</Text>
  </TouchableOpacity>
);

export default function ReportsScreen() {
  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: '#f8f9fa' }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <Text style={{ fontSize: 22, fontWeight: '800', marginBottom: 12 }}>Reports</Text>

        <Row
          title="Latest Counts by Area"
          desc="Read-only list of most recent counts for each item in each area."
          onPress={() => Alert.alert('Latest Counts by Area', 'Stub — will query areas/*/items lastCount.')}
        />

        <Row
          title="Department Summary"
          desc="Totals and completion status across all areas in a department."
          onPress={() => Alert.alert('Department Summary', 'Stub — will aggregate per department.')}
        />

        <Row
          title="Variance vs Expected"
          desc="Highlights items outside a threshold from expected levels."
          onPress={() => Alert.alert('Variance vs Expected', 'Stub — configurable threshold coming soon.')}
        />

        <Row
          title="Period Close Summary"
          desc="End-of-month/quarter/year snapshot for accounts."
          onPress={() => Alert.alert('Period Close Summary', 'Stub — will use sessions/current + counts.')}
        />
      </ScrollView>
    </View>
  );
}
