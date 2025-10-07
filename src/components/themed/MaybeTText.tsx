import React from 'react';
import { Text, TextProps, StyleProp, TextStyle } from 'react-native';

/**
 * MaybeTText (shim)
 * Simple pass-through Text that keeps the same API your screens expect.
 * Replace with the real themed component later.
 */
type Props = TextProps & {
  style?: StyleProp<TextStyle>;
  children?: React.ReactNode;
};

export default function MaybeTText({ style, children, ...rest }: Props) {
  return (
    <Text style={style} {...rest}>
      {children}
    </Text>
  );
}
