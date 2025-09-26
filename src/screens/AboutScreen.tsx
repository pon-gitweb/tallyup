import React from 'react';
import { SafeAreaView, ScrollView, Alert } from 'react-native';
import { ThemeProvider } from '../theme/ThemeProvider';
import { tokens } from '../theme/tokens';
import { ENABLE_V2_THEME } from '../flags/v2Brand';
import { useNavigation } from '@react-navigation/native';
import TView from '../components/themed/TView';
import TText from '../components/themed/TText';
import TButton from '../components/themed/TButton';
import LegalFooter from '../components/LegalFooter';

export default function AboutScreen() {
  const nav = useNavigation<any>();
  const go = (name: string) => {
    if (__DEV__ && ENABLE_V2_THEME) nav.navigate(name);
    else Alert.alert('Unavailable', 'Enable ENABLE_V2_THEME in dev to preview.');
  };

  return (
    <ThemeProvider value={{ tokens }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: tokens.colors.bg }}>
        <ScrollView contentContainerStyle={{ padding: tokens.spacing.lg }}>
          <TView surface padded>
            <TText size="xl" weight="bold" style={{ textAlign: 'center', marginBottom: tokens.spacing.sm }}>
              TallyUp
            </TText>
            <TText muted style={{ textAlign: 'center', marginBottom: tokens.spacing.lg }}>
              Brand/theme/legal scaffolding. Dev preview only.
            </TText>
            <TButton title="Terms of Use" onPress={() => go('DevTerms')} style={{ marginBottom: tokens.spacing.sm }} />
            <TButton title="Privacy Policy" variant="secondary" onPress={() => go('DevPrivacy')} />
          </TView>

          <LegalFooter />
        </ScrollView>
      </SafeAreaView>
    </ThemeProvider>
  );
}
