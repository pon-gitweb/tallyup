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

  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  if (!base64 || base64.length < 32) {
    throw new Error("uploadShelfScanPhoto: base64 read failed/empty");
  }

  const functions = getFunctions(undefined, "us-central1");
  const fn = httpsCallable(functions, "uploadShelfScanPhotoCallable");

  const raw: any = await fn({
    venueId,
    scanId,
    base64,
    contentType: "image/jpeg",
  });

  // Callable responses are usually shaped as { data: ... }
  const payload = raw?.data ?? raw;

  console.log("[uploadShelfScanPhoto] callable raw:", raw);
  console.log("[uploadShelfScanPhoto] callable payload:", payload);

  const fullPath = payload?.fullPath || payload?.path;
  if (!fullPath) {
    throw new Error("uploadShelfScanPhoto: Upload returned no fullPath");
  }

  return { ...payload, fullPath };
}
