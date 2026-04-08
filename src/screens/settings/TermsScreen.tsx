// @ts-nocheck
import React from 'react';
import { ScrollView, Text, View, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useColours } from '../../context/ThemeContext';
import { withErrorBoundary } from '../../components/ErrorCatcher';

function TermsScreen() {
  const colours = useColours();
  const nav = useNavigation<any>();

  const Section = ({ title, children }: any) => (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontWeight: '900', color: colours.text, fontSize: 15, marginBottom: 6 }}>{title}</Text>
      <Text style={{ color: colours.textSecondary, fontSize: 13, lineHeight: 20 }}>{children}</Text>
    </View>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colours.background }} contentContainerStyle={{ padding: 16, gap: 4 }}>

      <View style={{ backgroundColor: colours.primary, borderRadius: 16, padding: 20, marginBottom: 16 }}>
        <Text style={{ fontSize: 22, fontWeight: '900', color: '#fff' }}>Terms of Service</Text>
        <Text style={{ color: 'rgba(255,255,255,0.7)', marginTop: 4, fontSize: 12 }}>
          Last updated: April 2026
        </Text>
      </View>

      <Section title="1. Acceptance">
        By using Hosti-Stock you agree to these terms. If you do not agree, please do not use the app. These terms apply to all users including venue operators and supplier accounts.
      </Section>

      <Section title="2. Service Description">
        Hosti-Stock provides inventory management, stocktake, and ordering tools for hospitality venues. AI-powered features are provided as guidance only and should not be relied upon as the sole basis for purchasing or business decisions.
      </Section>

      <Section title="3. Your Data">
        You own your data. We store it securely in Google Firebase (us-central1). We do not sell your data to third parties. You can request deletion of your data at any time by contacting hello@hosti.co.nz.
      </Section>

      <Section title="4. AI Features">
        AI-generated suggestions, variance explanations and order recommendations are based on the data you provide. Accuracy improves over time with more stocktake data. Hosti-Stock is not liable for purchasing decisions made based on AI suggestions.
      </Section>

      <Section title="5. Acceptable Use">
        You agree not to use Hosti-Stock to store false information, attempt to access other venues data, reverse engineer the app, or use the service for any unlawful purpose.
      </Section>

      <Section title="6. Beta Period">
        During the beta period the service is provided free of charge. We reserve the right to introduce pricing with reasonable notice. Current beta users will receive at least 30 days notice before any charges apply.
      </Section>

      <Section title="7. Supplier Portal">
        Suppliers using the portal agree that pricing and catalogue data shared through the app will be visible to connected venues. Commercially sensitive contract terms are stored privately and not shared between venues.
      </Section>

      <Section title="8. Limitation of Liability">
        Hosti-Stock is provided as-is. We are not liable for any loss of data, incorrect stock counts, or business losses arising from use of the app. Maximum liability is limited to fees paid in the preceding 3 months.
      </Section>

      <Section title="9. Privacy">
        Our privacy policy is available at https://www.hosti.co.nz/privacy-policy and forms part of these terms.
      </Section>

      <Section title="10. Governing Law">
        These terms are governed by the laws of New Zealand. Any disputes will be resolved under New Zealand jurisdiction.
      </Section>

      <Section title="11. Contact">
        For any questions about these terms contact us at hello@hosti.co.nz or visit https://www.hosti.co.nz
      </Section>

      <View style={{ height: 30 }} />
    </ScrollView>
  );
}

export default withErrorBoundary(TermsScreen, 'Terms');
