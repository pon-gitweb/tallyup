import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';

const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

async function sendInviteEmail(
  apiKey: string,
  to: string,
  invitedByName: string,
  venueName: string,
  role: string,
  inviteLink: string
): Promise<void> {
  const roleLabel =
    role === 'owner' ? 'Owner' : role === 'manager' ? 'Manager' : 'Staff Member';
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a2e">
      <h2 style="color:#0B132B;margin-bottom:8px">You're invited to join ${escHtml(venueName)}</h2>
      <p style="margin:0 0 16px">
        <strong>${escHtml(invitedByName)}</strong> has invited you to join
        <strong>${escHtml(venueName)}</strong> as a <strong>${escHtml(roleLabel)}</strong>
        on Hosti-Stock — the hospitality inventory app.
      </p>
      <div style="margin:24px 0">
        <a href="${inviteLink}"
           style="background:#0B132B;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;font-size:16px">
          Accept Invite
        </a>
      </div>
      <p style="color:#888;font-size:13px;margin-top:24px">
        This invite expires in 7 days. If you didn't expect this email, you can safely ignore it.
      </p>
    </div>
  `;

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Hosti-Stock <invites@hosti.co.nz>',
      to: [to],
      subject: `You're invited to join ${venueName} on Hosti-Stock`,
      html,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '(no body)');
    throw new Error(`Resend error ${resp.status}: ${body}`);
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Triggered when a new invite document is created under venues/{venueId}/invites/{inviteId}.
// Sends the invite email via Resend and stamps emailStatus on the doc.
export const onInviteCreated = functions
  .region('us-central1')
  .runWith({ secrets: ['RESEND_API_KEY'], timeoutSeconds: 30 })
  .firestore.document('venues/{venueId}/invites/{inviteId}')
  .onCreate(async (snap, ctx) => {
    const { venueId, inviteId } = ctx.params as { venueId: string; inviteId: string };
    const data = snap.data() as any;

    if (!data || data.status !== 'pending') return;

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error('[onInviteCreated] RESEND_API_KEY not configured');
      await snap.ref.update({ emailStatus: 'skipped_no_key' });
      return;
    }

    try {
      const venueSnap = await admin.firestore().doc(`venues/${venueId}`).get();
      const venueName = (venueSnap.data() as any)?.name || 'your venue';

      let invitedByName = 'A team member';
      if (data.invitedBy) {
        try {
          const u = await admin.auth().getUser(data.invitedBy);
          invitedByName = u.displayName || u.email || 'A team member';
        } catch {}
      }

      const inviteLink = `tallyup://invite/${venueId}/${inviteId}`;
      await sendInviteEmail(apiKey, data.email, invitedByName, venueName, data.role || 'staff', inviteLink);
      await snap.ref.update({
        emailStatus: 'sent',
        emailSentAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log('[onInviteCreated] sent', { venueId, inviteId, to: data.email });
    } catch (e: any) {
      console.error('[onInviteCreated] failed', e?.message);
      await snap.ref.update({ emailStatus: 'error', emailError: e?.message || 'Unknown' }).catch(() => {});
    }
  });

// Callable: accepts an invite and creates the member document.
// Client sends { venueId, inviteId }. User must be authenticated.
export const acceptInviteCallable = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  }

  const uid = context.auth.uid;
  const userEmail = (context.auth.token.email || '').toLowerCase();
  const venueId = String(data?.venueId || '');
  const inviteId = String(data?.inviteId || '');

  if (!venueId || !inviteId) {
    throw new functions.https.HttpsError('invalid-argument', 'venueId and inviteId required');
  }

  const db = admin.firestore();
  const inviteRef = db.doc(`venues/${venueId}/invites/${inviteId}`);
  const inviteSnap = await inviteRef.get();

  if (!inviteSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Invite not found');
  }

  const invite = inviteSnap.data() as any;

  if (invite.status === 'accepted') {
    // Idempotent — already accepted, return success
    const mSnap = await db.doc(`venues/${venueId}/members/${uid}`).get();
    return { ok: true, venueId, role: mSnap.exists ? mSnap.data()?.role || 'staff' : 'staff', alreadyAccepted: true };
  }

  if (invite.status !== 'pending') {
    throw new functions.https.HttpsError('failed-precondition', 'This invite is no longer valid');
  }

  // Check expiry
  const createdAtMs = invite.createdAt?.toMillis ? invite.createdAt.toMillis() : 0;
  if (createdAtMs && Date.now() - createdAtMs > INVITE_EXPIRY_MS) {
    await inviteRef.update({ status: 'expired' });
    throw new functions.https.HttpsError('deadline-exceeded', 'This invite has expired');
  }

  // Verify email matches (if invite has a specific email)
  if (invite.email && userEmail && invite.email.toLowerCase() !== userEmail) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'This invite was sent to a different email address (' + invite.email + ')'
    );
  }

  // Check already a member of this venue
  const memberRef = db.doc(`venues/${venueId}/members/${uid}`);
  const memberSnap = await memberRef.get();
  if (memberSnap.exists) {
    await inviteRef.update({ status: 'accepted', acceptedAt: admin.firestore.FieldValue.serverTimestamp(), acceptedBy: uid });
    return { ok: true, venueId, role: memberSnap.data()?.role || 'staff', alreadyMember: true };
  }

  const role: string = invite.role || 'staff';

  // Create the member document — onMemberWrite will sync custom claims
  await memberRef.set({
    uid,
    role,
    status: 'active',
    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    source: 'invite',
    inviteId,
  });

  // Write venueId to users/{uid} so VenueProvider picks it up
  await db.doc(`users/${uid}`).set({ venueId }, { merge: true });

  // Mark invite accepted
  await inviteRef.update({
    status: 'accepted',
    acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
    acceptedBy: uid,
  });

  console.log('[acceptInviteCallable] accepted', { venueId, inviteId, uid, role });
  return { ok: true, venueId, role };
});
