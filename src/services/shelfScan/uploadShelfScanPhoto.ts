// @ts-nocheck
import { getFunctions, httpsCallable } from "firebase/functions";
import * as FileSystem from "expo-file-system";

export async function uploadShelfScanPhoto({
  venueId,
  uid,
  scanId,
  fileUri,
}: {
  venueId: string;
  uid: string;
  scanId: string;
  fileUri: string;
}) {
  if (!fileUri) throw new Error("uploadShelfScanPhoto: missing fileUri");

  // Expo-safe: read file as base64 (NO Blob usage)
  const b64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  if (!b64 || b64.length < 32) {
    throw new Error("uploadShelfScanPhoto: base64 read failed/empty");
  }

  const functions = getFunctions(undefined, "us-central1");
  const fn = httpsCallable(functions, "uploadShelfScanPhotoCallable");

  // NOTE: callable derives uid from auth; we still pass uid for path consistency on client if needed elsewhere,
  // but server ignores it (good).
  const res: any = await fn({
    venueId,
    scanId,
    b64,
    contentType: "image/jpeg",
  });

  return res?.data || res;
}
