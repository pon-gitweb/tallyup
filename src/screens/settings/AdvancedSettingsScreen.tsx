// @ts-nocheck
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useColours } from '../../context/ThemeContext';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import { Sentry } from '../../services/crashReporting';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';

function AdvancedSettingsScreen() {
  const nav = useNavigation<any>();
  const themeColours = useColours();
  const { showSuccess } = useToast();
  const { confirm, modal } = useConfirmModal();
  const btn = (label: string, route: string, colour?: string) => (
    <TouchableOpacity
      style={[{ backgroundColor: colour || themeColours.primary, padding: 14, borderRadius: 12, alignItems: 'center', marginBottom: 10 }]}
      onPress={() => nav.navigate(route as never)}>
      <Text style={{ color: themeColours.primaryText, fontWeight: '800' }}>{label}</Text>
    </TouchableOpacity>
  );
  return (
    <ScrollView style={{ flex: 1, backgroundColor: themeColours.background }} contentContainerStyle={{ padding: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: '900', color: themeColours.text, marginBottom: 16 }}>Advanced Settings</Text>
      <Text style={{ fontSize: 12, fontWeight: '800', color: '#94A3B8', marginBottom: 8, letterSpacing: 1 }}>INTEGRATIONS</Text>
      {btn('Xero Integration', 'Xero', '#13B5EA')}
      {btn('⚖️ Bluetooth Scale', 'ScaleSettings', '#065F46')}
      <Text style={{ fontSize: 12, fontWeight: '800', color: '#94A3B8', marginBottom: 8, marginTop: 8, letterSpacing: 1 }}>DATA & AI</Text>
      {btn('AI Usage', 'AiUsage', '#6D28D9')}
      {btn('Report Preferences', 'ReportPreferences', '#0369A1')}
      <Text style={{ fontSize: 12, fontWeight: '800', color: '#94A3B8', marginBottom: 8, marginTop: 8, letterSpacing: 1 }}>TOOLS</Text>
      {btn('Budget Approvals', 'BudgetApprovalInbox', '#B45309')}
      {__DEV__ && (
        <>
          <Text style={{ fontSize: 12, fontWeight: '800', color: '#94A3B8', marginBottom: 8, marginTop: 8, letterSpacing: 1 }}>DEV — SENTRY TEST</Text>
          <TouchableOpacity
            style={{ backgroundColor: themeColours.error, padding: 14, borderRadius: 12, alignItems: 'center', marginBottom: 10 }}
            onPress={() => {
              confirm({
                title: 'Send test error to Sentry?',
                message: 'This captures a test exception in the development environment.',
                confirmLabel: 'Send',
                onConfirm: () => {
                  Sentry.captureException(new Error('TallyUp dev test — Sentry is working'));
                  showSuccess('Sent. Check your Sentry dashboard under the development environment.');
                },
              });
            }}
          >
            <Text style={{ color: themeColours.primaryText, fontWeight: '800' }}>Test Sentry capture</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ backgroundColor: '#7F1D1D', padding: 14, borderRadius: 12, alignItems: 'center', marginBottom: 10 }}
            onPress={() => {
              throw new Error('TallyUp dev test — forced crash via error boundary');
            }}
          >
            <Text style={{ color: themeColours.primaryText, fontWeight: '800' }}>Force crash (error boundary test)</Text>
          </TouchableOpacity>
        </>
      )}
      {modal}
    </ScrollView>
  );
}
export default withErrorBoundary(AdvancedSettingsScreen, 'AdvancedSettings');
