import { Platform, ToastAndroid } from 'react-native';
export function savedToast(message: string = 'Saved') {
  if (Platform.OS === 'android') {
    try { ToastAndroid.show(message, ToastAndroid.SHORT); } catch {}
  } else {
    console.log(`[Toast] ${message}`);
  }
}
