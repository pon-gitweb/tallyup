import React from 'react';
import { View, ViewProps } from 'react-native';
import { ENABLE_V2_THEME } from '../../flags/v2Brand';
import TView from './TView';
type Props = ViewProps & { surface?: boolean; padded?: boolean; radius?: 'sm'|'md'|'lg'|'xl' };
export default function MaybeTView(props: Props) {
  if (!ENABLE_V2_THEME) return <View {...props} />;
  return <TView {...props} />;
}
