// @ts-nocheck
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useColours } from '../../context/ThemeContext';
import { withErrorBoundary } from '../../components/ErrorCatcher';

function AdvancedSettingsScreen() {
  const nav = useNavigation<any>();
  const C = useColours();
  const btn = (label: string, route: string, colour?: string) => (
    <TouchableOpacity
      style={[{ backgroundColor: colour || C.primary, padding: 14, borderRadius: 12, alignItems: 'center', marginBottom: 10 }]}
      onPress={() => nav.navigate(route as never)}>
      <Text style={{ color: '#fff', fontWeight: '800' }}>{label}</Text>
    </TouchableOpacity>
  );
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.background }} contentContainerStyle={{ padding: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: '900', color: C.text, marginBottom: 16 }}>Advanced Settings</Text>
      <Text style={{ fontSize: 12, fontWeight: '800', color: '#94A3B8', marginBottom: 8, letterSpacing: 1 }}>INTEGRATIONS</Text>
      {btn('Xero Integration', 'Xero', '#13B5EA')}
      {btn('⚖️ Bluetooth Scale', 'ScaleSettings', '#065F46')}
      <Text style={{ fontSize: 12, fontWeight: '800', color: '#94A3B8', marginBottom: 8, marginTop: 8, letterSpacing: 1 }}>DATA & AI</Text>
      {btn('AI Usage', 'AiUsage', '#6D28D9')}
      {btn('Report Preferences', 'ReportPreferences', '#0369A1')}
      <Text style={{ fontSize: 12, fontWeight: '800', color: '#94A3B8', marginBottom: 8, marginTop: 8, letterSpacing: 1 }}>TOOLS</Text>
      {btn('Budget Approvals', 'BudgetApprovalInbox', '#B45309')}
    </ScrollView>
  );
}
export default withErrorBoundary(AdvancedSettingsScreen, 'AdvancedSettings');
