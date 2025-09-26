import React from 'react';
import { View, Image, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

// NOTE: asset path from your repo instructions
const logo = require('../../assets/brand/logo.png');

export default function LegalFooter() {
  const { tokens } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: 8, paddingVertical: tokens.spacing.lg }}>
      <Image source={logo} style={{ width: 80, height: 80, resizeMode: 'contain' }} />
      <Text style={{ color: tokens.colors.textMuted, fontSize: 12, textAlign: 'center' }}>
        © {new Date().getFullYear()} Hosti Ltd — TallyUp
        {'\n'}
        By using this app you agree to the Terms of Use and Privacy Policy.
      </Text>
    </View>
  );
}
