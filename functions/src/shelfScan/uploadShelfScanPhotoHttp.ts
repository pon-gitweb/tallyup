import * as admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";
import Busboy from "busboy";

type Json = Record<string, any>;

function json(res:any, code:number, body:Json) {
  res.status(code).set("content-type", "application/json").send(JSON.stringify(body));
}

async function isVenueMember(venueId: string, uid: string, decoded: any) {
  // Fast path: custom claim venues map
  if (decoded?.venues?.[venueId] === true) return true;

  // Fallback: membership doc exists
  const snap = await admin
    .firestore()
    .doc(`venues/${venueId}/members/${uid}`)
    .get();

  return snap.exists;
}

// POST multipart/form-data:
// fields: venueId, scanId
// file:   file (image)
export const uploadShelfScanPhotoHttp = onRequest(
  { region: "us-central1", cors: true },
  async (req, res) => {
    try {
      if (req.method !== "POST") return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });

      const authHeader = req.headers.authorization || "";
      const m = authHeader.match(/^Bearer (.+)$/i);
      if (!m) return json(res, 401, { ok: false, error: "MISSING_AUTH" });

      const idToken = m[1];
      const decoded = await admin.auth().verifyIdToken(idToken);
      const uid = decoded?.uid;
      if (!uid) return json(res, 401, { ok: false, error: "BAD_TOKEN" });

      const bb = Busboy({ headers: req.headers });

      let venueId = "";
      let scanId = "";
      let fileBuffer: Buffer | null = null;
      let fileMime = "image/jpeg";

      bb.on("field", (name, val: any) => {
        if (name === "venueId") venueId = String(val || "");
        if (name === "scanId") scanId = String(val || "");
      });

      bb.on("file", (_name, file, info: any) => {
        fileMime = info?.mimeType || fileMime;
        const chunks: Buffer[] = [];
        file.on("data", (d: Buffer) => chunks.push(d));
        file.on("end", () => {
          fileBuffer = Buffer.concat(chunks);
        });
      });

      bb.on("error", (e:any) => {
        throw e;
      });

      bb.on("finish", async () => {
        try {
          if (!venueId) return json(res, 400, { ok: false, error: "MISSING_VENUE" });
          if (!scanId) return json(res, 400, { ok: false, error: "MISSING_SCANID" });
          if (!fileBuffer || fileBuffer.length === 0) return json(res, 400, { ok: false, error: "MISSING_FILE" });

          const ok = await isVenueMember(venueId, uid, decoded);
          if (!ok) return json(res, 403, { ok: false, error: "NOT_VENUE_MEMBER" });

          // Write to Storage via Admin
          const bucket = admin.storage().bucket();
          const fullPath = `uploads/${venueId}/shelf-scan/${uid}/${scanId}.jpg`;
          const f = bucket.file(fullPath);

          await f.save(fileBuffer, {
            resumable: false,
            contentType: fileMime || "image/jpeg",
            metadata: {
              cacheControl: "public,max-age=3600",
            },
          });

          // Signed URL for debugging / optional UI preview
          const [downloadUrl] = await f.getSignedUrl({
            action: "read",
            expires: Date.now() + 1000 * 60 * 60, // 1 hour
          });

          return json(res, 200, { ok: true, fullPath, downloadUrl });
        } catch (e:any) {
          return json(res, 500, { ok: false, error: e?.message ?? String(e) });
        }
      });

      req.pipe(bb as any);
    } catch (e:any) {
      return json(res, 500, { ok: false, error: e?.message ?? String(e) });
    }
  }
);
