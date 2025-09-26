import React from 'react';
import { View, ViewProps } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

type Props = ViewProps & {
  surface?: boolean; // if true, apply surface bg + border
  padded?: boolean;  // if true, apply default padding
  radius?: 'sm' | 'md' | 'lg' | 'xl';
};

export default function TView({ surface, padded, radius='lg', style, ...rest }: Props) {
  const { tokens } = useTheme();
  return (
    <View
      {...rest}
      style={[
        surface && {
          backgroundColor: tokens.colors.surface,
          borderColor: tokens.colors.border,
          borderWidth: 1,
          borderRadius: tokens.radius[radius],
        },
        padded && { padding: tokens.spacing.lg },
        style,
      ]}
    />
  );
}
