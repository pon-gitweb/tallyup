import React from "react";
import { Image, StyleSheet, ScrollView, View } from "react-native";
import TView from "../../components/Themed/TView";
import TText from "../../components/Themed/TText";
import LegalFooter from "../../components/Brand/LegalFooter";
import { useTheme } from "../../theme/ThemeProvider";
import { PRODUCT_NAME, COMPANY_OWNER, COMPANY_TRADING, COPYRIGHT_LINE, TRADEMARK_LINE, LEGAL_CONTACT } from "../../theme/legal";

export default function AboutScreen() {
  const { colors, spacing } = useTheme();
  return (
    <TView surface style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: spacing.xl }}>
        <View style={{ alignItems: "center", marginBottom: spacing.xl }}>
          <Image source={require("../../assets/brand/logo.png")} style={S.logo} resizeMode="contain" />
          <TText style={{ marginTop: spacing.md, fontSize: 20, fontWeight: "600", color: colors.text }}>{PRODUCT_NAME}</TText>
        </View>
        <TText><TText style={{ fontWeight: "600" }}>Owner:</TText> {COMPANY_OWNER}</TText>
        <TText><TText style={{ fontWeight: "600" }}>Trading Entity:</TText> {COMPANY_TRADING}</TText>
        <TText style={{ marginTop: spacing.md }}>{COPYRIGHT_LINE}</TText>
        <TText>{TRADEMARK_LINE}</TText>
        <TText style={{ marginTop: spacing.md }}>Contact: {LEGAL_CONTACT}</TText>
      </ScrollView>
      <LegalFooter />
    </TView>
  );
}
const S = StyleSheet.create({ logo: { width: 180, height: 180 } });
