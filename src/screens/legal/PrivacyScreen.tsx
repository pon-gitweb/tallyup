import React from 'react';
import { SafeAreaView, ScrollView } from 'react-native';
import LocalThemeGate from '../../theme/LocalThemeGate';
import { tokens } from '../../theme/tokens';
import TText from '../../components/themed/TText';
import TView from '../../components/themed/TView';

export default function PrivacyScreen() {
  return (
    <LocalThemeGate>
      <SafeAreaView style={{ flex:1, backgroundColor: tokens.colors.bg }}>
        <ScrollView contentContainerStyle={{ padding: tokens.spacing.lg }}>
          <TView surface padded>
            <TText size="xl" weight="bold" style={{ marginBottom: tokens.spacing.md }}>Privacy Policy</TText>
            <TText muted>
              This is placeholder scaffolding for V2. Summarize data collection, retention, and access policies here.
            </TText>
          </TView>
        </ScrollView>
      </SafeAreaView>
    </LocalThemeGate>
  );
}
