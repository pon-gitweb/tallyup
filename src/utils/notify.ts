// Cross-platform toast/alert with no extra deps.
import { Platform, ToastAndroid, Alert } from 'react-native';

export function notify(message: string) {
  if (Platform.OS === 'android') {
    try { ToastAndroid.show(message, ToastAndroid.SHORT); } catch {}
  } else {
    try { Alert.alert('Notice', message); } catch { console.log('[Toast]', message); }
  }
}
