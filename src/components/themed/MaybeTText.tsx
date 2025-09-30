// @ts-nocheck
import React from 'react';
import { Text, TextProps } from 'react-native';
import { ENABLE_V2_THEME } from '../../flags/v2Brand';
import TText from './TText';

type Props = TextProps & {
  muted?: boolean;
  weight?: 'regular' | 'medium' | 'bold';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
};

export default function MaybeTText({ children, style, ...rest }: Props) {
  if (!ENABLE_V2_THEME) {
    // Fallback: plain RN Text with passed styles/props
    return <Text {...rest} style={style}>{children}</Text>;
  }
  // Themed text when V2 is enabled
  return <TText {...rest} style={style}>{children}</TText>;
}
