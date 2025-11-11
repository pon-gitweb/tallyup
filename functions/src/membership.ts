import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

const auth = admin.auth();
type Role = 'owner'|'manager'|'member';

async function setClaims(uid: string, venueId: string, role: Role) {
  const user = await auth.getUser(uid);
  const existing = (user.customClaims as any) || {};
  const venues = { ...(existing.venues || {}), [venueId]: true };
  const venue_roles = { ...(existing.venue_roles || {}), [venueId]: role };
  const next = { ...existing, venues, venue_roles };
  const was = JSON.stringify({ venues: existing.venues, venue_roles: existing.venue_roles });
  const now = JSON.stringify({ venues, venue_roles });
  if (was !== now) {
    await auth.setCustomUserClaims(uid, next);
  }
}

export const onMemberWrite = functions.firestore
  .document('venues/{venueId}/members/{uid}')
  .onWrite(async (snap, ctx) => {
    const { venueId, uid } = ctx.params as { venueId: string; uid: string };
    const after = snap.after.exists ? (snap.after.data() as any) : null;

    if (!after) {
      // Member removed -> strip this venue from claims
      const user = await auth.getUser(uid);
      const cc = (user.customClaims as any) || {};
      if (cc.venues?.[venueId] || cc.venue_roles?.[venueId]) {
        if (cc.venues) delete cc.venues[venueId];
        if (cc.venue_roles) delete cc.venue_roles[venueId];
        await auth.setCustomUserClaims(uid, cc);
      }
      return;
    }

    const role: Role = after.role ?? 'member';
    await setClaims(uid, venueId, role);

    // Optional nudge for clients to refresh snapshots
    await admin.firestore().doc(`users/${uid}`).set(
      { touchedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
  });

export const refreshMyClaims = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  }
  const uid = context.auth.uid;
  const venueId = String(data?.venueId || '');
  if (!venueId) {
    throw new functions.https.HttpsError('invalid-argument', 'venueId required');
  }

  const memberSnap = await admin.firestore().doc(`venues/${venueId}/members/${uid}`).get();
  if (!memberSnap.exists) {
    return { refreshed: false, reason: 'not_member' as const };
  }

  const role: Role = (memberSnap.data()?.role as Role) || 'member';
  await setClaims(uid, venueId, role);
  return { refreshed: true as const };
});
