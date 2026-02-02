import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";

if (!admin.apps.length) admin.initializeApp();

export const uploadShelfScanPhotoCallable = onCall(
  { region: "us-central1" },
  async (request) => {
    try {
      console.log("uploadShelfScanPhotoCallable INVOKED");

      const { data, auth } = request;

      const uid = auth?.uid;
      if (!uid) {
        throw new HttpsError("unauthenticated", "Sign in required.");
      }

      const venueId = String(data?.venueId || "").trim();
      const scanId = String(data?.scanId || "").trim();
      const contentType = String(data?.contentType || "image/jpeg");

      console.log("UPLOAD PAYLOAD KEYS:", Object.keys(data || {}));
      console.log("base64 type/len:", typeof data?.base64, data?.base64?.length);

      if (!venueId) throw new HttpsError("invalid-argument", "Missing venueId.");
      if (!scanId) throw new HttpsError("invalid-argument", "Missing scanId.");

      let b64 = data?.base64;
      if (typeof b64 !== "string" || b64.length === 0) {
        throw new HttpsError("invalid-argument", "Missing/invalid base64");
      }

      // Strip data URL prefix if present
      b64 = b64.replace(/^data:.*;base64,/, "");

      const buf = Buffer.from(b64, "base64");
      console.log("DECODED BYTES:", buf.length);

      if (!buf.length) {
        throw new HttpsError("invalid-argument", "Decoded image empty.");
      }
      if (buf.length > 10 * 1024 * 1024) {
        throw new HttpsError("invalid-argument", "Image too large (max 10MB).");
      }

      const path = `uploads/${venueId}/shelf-scan/${uid}/${scanId}.jpg`;
      const bucket = admin.storage().bucket();

      console.log("ABOUT TO SAVE:", path);

      await bucket.file(path).save(buf, {
        resumable: false,
        metadata: { contentType },
      });

      console.log("UPLOAD SAVED:", path, "bytes=", buf.length);

      const result = {
        ok: true,
        path,
        fullPath: path,
        bytes: buf.length,
        contentType,
      };

      console.log("UPLOAD DONE RETURNING:", result);

      return result;
    } catch (e: any) {
      console.error("UPLOAD FAILED:", e?.message || e, e?.stack || "");
      throw e instanceof HttpsError
        ? e
        : new HttpsError("internal", e?.message || "Upload failed");
    }
  }
);
