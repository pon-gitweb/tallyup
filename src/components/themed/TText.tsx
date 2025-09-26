import React from 'react';
import { Text, TextProps } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

type Props = TextProps & {
  muted?: boolean;
  weight?: 'regular' | 'medium' | 'bold';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
};

export default function TText({ muted, weight = 'regular', size = 'md', style, ...rest }: Props) {
  const { tokens } = useTheme();

  const fontWeight =
    weight === 'bold' ? '700' : weight === 'medium' ? '600' : '400';

  return (
    <Text
      {...rest}
      style={[
        {
          color: muted ? tokens.colors.textMuted : tokens.colors.text,
          fontFamily: tokens.typography.family.regular,
          fontSize: tokens.typography.size[size],
          fontWeight,
        },
        style,
      ]}
    />
  );
}
