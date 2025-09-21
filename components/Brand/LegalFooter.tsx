import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { LEGAL_FOOTER_COMPACT } from "../../theme/legal";
import { useTheme } from "../../theme/ThemeProvider";

export default function LegalFooter() {
  const { colors } = useTheme();
  return (
    <View style={[S.container, { borderTopColor: colors.border }]}>
      <Text style={[S.text, { color: colors.mutedText }]}>{LEGAL_FOOTER_COMPACT}</Text>
    </View>
  );
}
const S = StyleSheet.create({
  container:{ paddingVertical:8, paddingHorizontal:12, borderTopWidth: StyleSheet.hairlineWidth, alignItems:"center"},
  text:{ fontSize:11, lineHeight:14, textAlign:"center" },
});
