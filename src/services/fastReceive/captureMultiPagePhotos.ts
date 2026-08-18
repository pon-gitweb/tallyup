import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

/**
 * Promise-wrapped alert for the multi-page camera flow.
 * Resolves true = capture another page, false = done.
 */
function askAddPage(pageNum: number): Promise<boolean> {
  // Delay before showing the alert — the native camera modal's dismissal animation
  // can silently swallow an Alert.alert fired immediately on return, causing the
  // prompt to never appear and the flow to proceed as if only one page was wanted.
  // 400ms gives the animation time to fully complete before the alert is shown.
  return new Promise(resolve => {
    setTimeout(() => {
      Alert.alert(
        'Add another page?',
        `Page ${pageNum} captured. Scan another page of this invoice?`,
        [
          { text: 'Done — scan now', onPress: () => resolve(false), style: 'cancel' },
          { text: 'Add page', onPress: () => resolve(true) },
        ],
        { cancelable: false },
      );
    }, 400);
  });
}

/**
 * Requests camera permission and captures one or more invoice pages,
 * prompting "Add another page?" after each capture.
 *
 * Returns:
 *   { permissionDenied: false, uris: string[] } — one or more photos captured
 *   { permissionDenied: false, uris: null }     — user canceled on first photo
 *   { permissionDenied: true,  uris: null }     — camera permission not granted
 */
export async function captureMultiPagePhotos(): Promise<{
  permissionDenied: boolean;
  uris: string[] | null;
}> {
  const cam = await ImagePicker.requestCameraPermissionsAsync();
  if (cam.status !== 'granted') return { permissionDenied: true, uris: null };

  const photo = await ImagePicker.launchCameraAsync({
    allowsEditing: false,
    quality: 0.85,
    base64: false,
  });
  if (photo.canceled || !photo.assets?.[0]?.uri) return { permissionDenied: false, uris: null };

  const uris: string[] = [photo.assets[0].uri];
  let addMore = await askAddPage(uris.length);
  while (addMore) {
    const next = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 0.85,
      base64: false,
    });
    if (next.canceled || !next.assets?.[0]?.uri) break;
    uris.push(next.assets[0].uri);
    addMore = await askAddPage(uris.length);
  }

  return { permissionDenied: false, uris };
}
