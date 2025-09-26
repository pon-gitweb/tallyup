import React from 'react';
import { SafeAreaView, ScrollView, Image } from 'react-native';
import { ThemeProvider } from '../theme/ThemeProvider';
import { tokens } from '../theme/tokens';
import TView from '../components/themed/TView';
import TText from '../components/themed/TText';
import TButton from '../components/themed/TButton';
import LegalFooter from '../components/LegalFooter';

const appIcon = require('../../assets/brand/app-icon.png');

export default function AboutScreen() {
  // Local provider for this standalone screen preview (still not wired)
  return (
    <ThemeProvider value={{ tokens }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: tokens.colors.bg }}>
        <ScrollView contentContainerStyle={{ padding: tokens.spacing.lg }}>
          <TView surface padded>
            <Image source={appIcon} style={{ width: 96, height: 96, alignSelf: 'center', marginBottom: tokens.spacing.md }} />
            <TText size="xl" weight="bold" style={{ textAlign: 'center', marginBottom: tokens.spacing.sm }}>
              TallyUp
            </TText>
            <TText muted style={{ textAlign: 'center', marginBottom: tokens.spacing.lg }}>
              Version 2 scaffolding — brand, theme, and legal components.
              This screen is not registered in navigation yet.
            </TText>
            <TButton title="Terms of Use (stub)" onPress={() => { /* later: openLink */ }} style={{ marginBottom: tokens.spacing.sm }} />
            <TButton title="Privacy Policy (stub)" variant="secondary" onPress={() => { /* later: openLink */ }} />
          </TView>

          <LegalFooter />
        </ScrollView>
      </SafeAreaView>
    </ThemeProvider>
  );
}
