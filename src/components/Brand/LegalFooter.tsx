import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { LEGAL_FOOTER_COMPACT } from "../../theme/legal";

type Props = { align?: "left" | "center" | "right"; muted?: boolean; testID?: string };

export default function LegalFooter({ align = "center", muted = true, testID }: Props) {
  return (
    <View style={[S.container, align === "left" ? S.left : align === "right" ? S.right : S.center]}>
      <Text testID={testID ?? "legal-footer"} style={[S.text, muted && S.muted]}>
        {LEGAL_FOOTER_COMPACT}
      </Text>
    </View>
  );
}

const S = StyleSheet.create({
  container: { paddingVertical: 8, paddingHorizontal: 12 },
  text: { fontSize: 11, lineHeight: 14 },
  muted: { opacity: 0.6 },
  left: { alignItems: "flex-start" },
  center: { alignItems: "center" },
  right: { alignItems: "flex-end" },
});
