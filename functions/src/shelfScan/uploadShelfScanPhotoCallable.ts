// @ts-nocheck
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";

if (!admin.apps.length) {
  admin.initializeApp();
}

export const uploadShelfScanPhotoCallable = onCall(
  { region: "us-central1" },
  async (request) => {
    try {
      const uid = request.auth?.uid;
      if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

      const data = request.data || {};
      const venueId = String(data?.venueId || "").trim();
      const scanId = String(data?.scanId || "").trim();
      let b64 = String(data?.b64 || "").trim();
      const contentType = String(data?.contentType || "image/jpeg").trim() || "image/jpeg";

      if (!venueId) throw new HttpsError("invalid-argument", "Missing venueId.");
      if (!scanId) throw new HttpsError("invalid-argument", "Missing scanId.");
      if (!b64) throw new HttpsError("invalid-argument", "Missing b64 payload.");

      // Strip data URL prefix if client sends it
      const m = b64.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.*)$/);
      if (m) b64 = m[2] || "";

      const buf = Buffer.from(b64, "base64");
      if (!buf?.length) throw new HttpsError("invalid-argument", "b64 decoded to empty buffer.");
      if (buf.length > 10 * 1024 * 1024) throw new HttpsError("invalid-argument", "Image too large (max 10MB).");

      const path = `uploads/${venueId}/shelf-scan/${uid}/${scanId}.jpg`;

      const bucket = admin.storage().bucket();
      const file = bucket.file(path);

      await file.save(buf, {
        resumable: false,
        metadata: { contentType, cacheControl: "private, max-age=3600" },
      });

      return { ok: true, fullPath: path, size: buf.length, contentType };
    } catch (e: any) {
      if (e instanceof HttpsError) throw e;
      const msg = e?.message || String(e);
      throw new HttpsError("internal", `uploadShelfScanPhotoCallable failed: ${msg}`, { raw: msg });
    }
  }
);
