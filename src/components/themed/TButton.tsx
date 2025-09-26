import React from 'react';
import { TouchableOpacity, Text, ViewStyle } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

type Variant = 'primary' | 'secondary' | 'danger';

type Props = {
  title: string;
  onPress?: () => void;
  disabled?: boolean;
  variant?: Variant;
  style?: ViewStyle | ViewStyle[];
};

export default function TButton({ title, onPress, disabled, variant='primary', style }: Props) {
  const { tokens } = useTheme();
  const palette = {
    primary: {
      bg: tokens.colors.accent,
      fg: tokens.colors.accentTextOn,
      border: tokens.colors.accent,
    },
    secondary: {
      bg: tokens.colors.surface,
      fg: tokens.colors.accent,
      border: tokens.colors.border,
    },
    danger: {
      bg: tokens.colors.danger,
      fg: tokens.colors.dangerTextOn,
      border: tokens.colors.danger,
    },
  }[variant];

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[
        {
          backgroundColor: disabled ? '#B0BEC5' : palette.bg,
          borderColor: palette.border,
          borderWidth: 1,
          borderRadius: 10,
          paddingVertical: 12,
          paddingHorizontal: 16,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.7 : 1,
        },
        style,
      ]}
    >
      <Text style={{ color: palette.fg, fontWeight: '700' }}>{title}</Text>
    </TouchableOpacity>
  );
}
