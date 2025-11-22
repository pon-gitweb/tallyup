import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

// Helper: generate a v_ style venue id similar to your existing ones
function generateVenueId(): string {
  const autoId = admin.firestore().collection("_tmp").doc().id; // random 20-char id
  return autoId.startsWith("v_") ? autoId : `v_${autoId}`;
}

export const createVenueOwnedByUser = onRequest(
  { region: "australia-southeast1" },
  async (req, res) => {
    try {
      // Accept both GET and POST, but prefer POST with JSON body.
      const method = req.method.toUpperCase();

      let name: string | undefined;
      let uid: string | undefined;
      let email: string | undefined;

      if (method === "GET") {
        name = (req.query.name as string | undefined) ?? undefined;
        uid = (req.query.uid as string | undefined) ?? undefined;
        email = (req.query.email as string | undefined) ?? undefined;
      } else if (method === "POST") {
        const body =
          typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
        name = typeof body.name === "string" ? body.name : undefined;
        uid = typeof body.uid === "string" ? body.uid : undefined;
        email = typeof body.email === "string" ? body.email : undefined;
      } else {
        res.status(405).send("Method not allowed");
        return;
      }

      const trimmedName = (name || "").trim();
      if (!trimmedName) {
        res.status(400).send("Missing venue name");
        return;
      }

      if (!uid) {
        res.status(400).send("Missing uid");
        return;
      }

      const db = admin.firestore();
      const venueId = generateVenueId();
      const now = admin.firestore.FieldValue.serverTimestamp();

      const venueRef = db.collection("venues").doc(venueId);
      const memberRef = venueRef.collection("members").doc(uid);
      const userRef = db.collection("users").doc(uid);

      await db.runTransaction(async (tx) => {
        // 1) Venue root
        tx.set(
          venueRef,
          {
            venueId,
            name: trimmedName,
            createdAt: now,
            ownerUid: uid,
            ownerEmail: email ?? null,
            openSignup: false,
            dev: false,
          },
          { merge: true }
        );

        // 2) Member doc (owner)
        tx.set(
          memberRef,
          {
            uid,
            role: "owner",
            email: email ?? null,
            joinedAt: now,
          },
          { merge: true }
        );

        // 3) User doc – this is what your VenueProvider watches (venueId)
        tx.set(
          userRef,
          {
            uid,
            email: email ?? null,
            venueId,
            updatedAt: now,
          },
          { merge: true }
        );
      });

      console.log("[createVenueOwnedByUser] created", { uid, venueId, name: trimmedName });
      res.status(200).json({ ok: true, venueId });
    } catch (err: any) {
      console.error("[createVenueOwnedByUser] error", err);
      res.status(500).send("Internal error");
    }
  }
);
