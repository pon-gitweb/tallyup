import React from 'react';
import { SafeAreaView, ScrollView } from 'react-native';
import LocalThemeGate from '../../theme/LocalThemeGate';
import { tokens } from '../../theme/tokens';
import TText from '../../components/themed/TText';
import TView from '../../components/themed/TView';

export default function TermsScreen() {
  return (
    <LocalThemeGate>
      <SafeAreaView style={{ flex:1, backgroundColor: tokens.colors.bg }}>
        <ScrollView contentContainerStyle={{ padding: tokens.spacing.lg }}>
          <TView surface padded>
            <TText size="xl" weight="bold" style={{ marginBottom: tokens.spacing.md }}>Terms of Use</TText>
            <TText muted>
              These terms are placeholder scaffolding for V2. Replace with your real legal copy.
              Use of TallyUp is subject to your venue’s agreements and applicable law.
            </TText>
          </TView>
        </ScrollView>
      </SafeAreaView>
    </LocalThemeGate>
  );
}
