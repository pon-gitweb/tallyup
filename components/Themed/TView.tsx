import React from "react";
import { View, ViewProps } from "react-native";
import { useTheme } from "../../theme/ThemeProvider";
export default function TView({ surface, style, ...rest }: ViewProps & { surface?: boolean }) {
  const { colors } = useTheme();
  return <View style={[{ backgroundColor: surface ? colors.surface : colors.background }, style]} {...rest} />;
}
