import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export default function LegalFooter() {
  const { tokens } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: 8, paddingVertical: tokens.spacing.lg }}>
      {/* Placeholder brand text (image removed to avoid bundling failure when asset is missing) */}
      <Text style={{ fontSize: 16, fontWeight: '800', color: tokens.colors.text }}>TALLYUP</Text>
      <Text style={{ color: tokens.colors.textMuted, fontSize: 12, textAlign: 'center' }}>
        © {new Date().getFullYear()} Hosti Ltd — TallyUp
        {'\n'}
        By using this app you agree to the Terms of Use and Privacy Policy.
      </Text>
    </View>
  );
}
