import { Platform, ToastAndroid, Alert } from 'react-native';
export function showToast(msg: string) {
  if (Platform.OS === 'android') { try { ToastAndroid.show(msg, ToastAndroid.SHORT); } catch {} }
  else { try { Alert.alert('Notice', msg); } catch {} }
}
