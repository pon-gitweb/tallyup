import React from "react";
import { Text, TextProps } from "react-native";
import { useTheme } from "../../theme/ThemeProvider";
export default function TText({ muted, style, ...rest }: TextProps & { muted?: boolean }) {
  const { colors, typography } = useTheme();
  return <Text style={[{ color: muted ? colors.mutedText : colors.text, fontSize: typography.sizes.md }, style]} {...rest} />;
}
