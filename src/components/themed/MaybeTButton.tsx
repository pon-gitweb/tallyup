import React from 'react';
import { TouchableOpacity, Text, ViewStyle } from 'react-native';
import { ENABLE_V2_THEME } from '../../flags/v2Brand';
import TButton from './TButton';
type Props = { title: string; onPress?: () => void; disabled?: boolean; variant?: 'primary'|'secondary'|'danger'; style?: ViewStyle|ViewStyle[] };
export default function MaybeTButton(props: Props) {
  if (!ENABLE_V2_THEME) {
    const { title, onPress, disabled, style } = props;
    return (
      <TouchableOpacity onPress={onPress} disabled={disabled} style={[{ paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, backgroundColor: '#0A84FF', alignItems:'center' }, style]}>
        <Text style={{ color: 'white', fontWeight: '700' }}>{title}</Text>
      </TouchableOpacity>
    );
  }
  return <TButton {...props} />;
}
