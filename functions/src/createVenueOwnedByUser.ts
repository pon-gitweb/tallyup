import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

function generateVenueId(): string {
  const autoId = admin.firestore().collection("_tmp").doc().id;
  return `v_${autoId}`;
}

export const createVenueOwnedByUser = onRequest(
  { region: "australia-southeast1" },
  async (req, res) => {
    // CORS preflight
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Methods", "POST");
      res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    // Verify Firebase ID token from Authorization header
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      res.status(401).json({ ok: false, error: "Missing auth token" });
      return;
    }

    let uid: string;
    let email: string | null;
    try {
      const token = authHeader.split("Bearer ")[1];
      const decoded = await admin.auth().verifyIdToken(token);
      uid = decoded.uid;
      email = decoded.email || null;
    } catch (e: any) {
      console.error("[createVenueOwnedByUser] token verify failed", e?.message);
      res.status(401).json({ ok: false, error: "Invalid auth token" });
      return;
    }

    // Parse body
    const body = typeof req.body === "string"
      ? JSON.parse(req.body || "{}")
      : (req.body || {});

    const trimmedName = (typeof body.name === "string" ? body.name : "").trim();
    if (!trimmedName) {
      res.status(400).json({ ok: false, error: "Missing venue name" });
      return;
    }

    try {
      const db = admin.firestore();

      // Check user doesn't already have a venue
      const userSnap = await db.collection("users").doc(uid).get();
      const existingVenueId = userSnap.exists ? (userSnap.data() as any)?.venueId : null;
      if (existingVenueId) {
        // Already has a venue — return it instead of creating a duplicate
        console.log("[createVenueOwnedByUser] already has venue", { uid, existingVenueId });
        res.status(200).json({ ok: true, venueId: existingVenueId, existing: true });
        return;
      }

      const venueId = generateVenueId();
      const now = admin.firestore.FieldValue.serverTimestamp();
      const venueRef = db.collection("venues").doc(venueId);
      const memberRef = venueRef.collection("members").doc(uid);
      const userRef = db.collection("users").doc(uid);

      await db.runTransaction(async (tx) => {
        tx.set(venueRef, {
          venueId,
          name: trimmedName,
          createdAt: now,
          ownerUid: uid,
          ownerEmail: email,
          openSignup: false,
          dev: false,
        }, { merge: true });

        tx.set(memberRef, {
          uid,
          role: "owner",
          email,
          joinedAt: now,
        }, { merge: true });

        tx.set(userRef, {
          uid,
          email,
          venueId,
          updatedAt: now,
        }, { merge: true });
      });

      console.log("[createVenueOwnedByUser] created", { uid, venueId, name: trimmedName });
      res.status(200).json({ ok: true, venueId });
    } catch (err: any) {
      console.error("[createVenueOwnedByUser] error", err);
      res.status(500).json({ ok: false, error: "Internal error" });
    }
  }
);
