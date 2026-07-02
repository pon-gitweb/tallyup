// @ts-nocheck
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useColours } from '../../context/ThemeContext';
import SalesReportUploadPanel from './SalesReportUploadPanel';

export default function SalesImportScreen() {
  const nav = useNavigation<any>();
  const c = useColours();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
        borderBottomWidth: 1, borderBottomColor: c.border,
      }}>
        <TouchableOpacity onPress={() => nav.goBack()} style={{ marginRight: 12, padding: 4 }}>
          <Text style={{ fontSize: 18, color: c.deepBlue, fontWeight: '600' }}>‹</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 18, fontWeight: '800', color: c.navy }}>Sales Import</Text>
      </View>
      <SalesReportUploadPanel onClose={() => nav.goBack()} />
    </SafeAreaView>
  );
}
