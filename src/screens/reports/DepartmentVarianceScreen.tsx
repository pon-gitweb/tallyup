// @ts-nocheck
import React from 'react';
import { SafeAreaView, View, Text, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

/**
 * Minimal, Expo-safe placeholder so MainStack can import/route.
 * We'll wire real data later. This keeps APK stability.
 */
export default function DepartmentVarianceScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const { departmentId, departmentName } = route.params ?? {};

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>
      <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
        <Text style={{ fontSize: 18, fontWeight: '800' }}>
          Department Variance{departmentName ? ` — ${departmentName}` : ''}
        </Text>
        {departmentId ? (
          <Text style={{ color: '#6B7280', marginTop: 4 }}>Dept ID: {departmentId}</Text>
        ) : null}
      </View>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <Text style={{ fontSize: 16, fontWeight: '700', marginBottom: 6 }}>
          Coming soon
        </Text>
        <Text style={{ color: '#6B7280', textAlign: 'center' }}>
          This screen will summarize variance across all areas in the department,
          with export options. For now, this placeholder unblocks navigation.
        </Text>

        <TouchableOpacity
          onPress={() => nav.goBack()}
          style={{ marginTop: 16, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, backgroundColor: '#E5E7EB' }}
        >
          <Text style={{ fontWeight: '700' }}>Back</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
