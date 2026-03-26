import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import express = require("express");
import cors = require("cors");

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "20mb" }));

// ── Verify Firebase ID token from Authorization header ──────────────────────
async function verifyToken(req: express.Request): Promise<string | null> {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const token = auth.split("Bearer ")[1];
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

// ── POST /upload-file ────────────────────────────────────────────────────────
// Body: { destPath: string, dataUrl: string, cacheControl?: string }
// Returns: { ok: true, fullPath: string, downloadURL: string }
app.post("/upload-file", async (req, res) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const { destPath, dataUrl, cacheControl } = req.body || {};

    if (!destPath || typeof destPath !== "string") {
      res.status(400).json({ ok: false, error: "Missing destPath" });
      return;
    }
    if (!dataUrl || typeof dataUrl !== "string") {
      res.status(400).json({ ok: false, error: "Missing dataUrl" });
      return;
    }

    // Parse data URL — format: data:{contentType};base64,{data}
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) {
      res.status(400).json({ ok: false, error: "Invalid dataUrl format" });
      return;
    }
    const contentType = match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, "base64");

    // Upload to Firebase Storage
    const bucket = admin.storage().bucket();
    const file = bucket.file(destPath);

    await file.save(buffer, {
      metadata: {
        contentType,
        cacheControl: cacheControl || "private, max-age=0",
      },
    });

    // Get a signed download URL (valid 7 days)
    const [downloadURL] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });

    console.log("[api/upload-file] OK", { uid, destPath, contentType, bytes: buffer.length });
    res.json({ ok: true, fullPath: destPath, downloadURL });

  } catch (e: any) {
    console.error("[api/upload-file] ERROR", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "Upload failed" });
  }
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

export const api = functions
  .region("us-central1")
  .runWith({ memory: "512MB", timeoutSeconds: 120 })
  .https.onRequest(app);
