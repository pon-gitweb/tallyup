import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { v4 as uuidv4 } from "uuid";

export const createVenueOwnedByUser = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "You must be signed in to create a venue.");
  }

  const rawName = (data && (data as any).name) ? String((data as any).name) : "";
  const name = rawName.trim();
  if (!name) {
    throw new functions.https.HttpsError("invalid-argument", "Venue name is required.");
  }

  const uid = context.auth.uid;
  const email = (context.auth.token && (context.auth.token.email as string | undefined)) || null;

  const db = admin.firestore();
  const venueId = `v_${uuidv4().replace(/-/g, "").slice(0, 20)}`;

  const venueRef = db.doc(`venues/${venueId}`);
  const memberRef = venueRef.collection("members").doc(uid);
  const userRef = db.doc(`users/${uid}`);

  await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const currentVenueId = userSnap.exists ? ((userSnap.data() as any).venueId ?? null) : null;

    if (currentVenueId) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "This user is already attached to a venue."
      );
    }

    const now = admin.firestore.FieldValue.serverTimestamp();

    // 1) Venue document
    tx.set(
      venueRef,
      {
        venueId,
        name,
        createdAt: now,
        ownerUid: uid,
        ownerEmail: email,
        openSignup: false,
        dev: false,
      },
      { merge: true }
    );

    // 2) Member document (owner)
    tx.set(
      memberRef,
      {
        uid,
        role: "owner",
        email,
        joinedAt: now,
        status: "active",
      },
      { merge: true }
    );

    // 3) User document – what VenueProvider reads
    tx.set(
      userRef,
      {
        email,
        venueId,
        touchedAt: now,
      },
      { merge: true }
    );
  });

  return { venueId };
});
