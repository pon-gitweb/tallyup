const { Firestore, FieldValue } = require('@google-cloud/firestore');

async function main() {
  const [venueId, uid, roleArg] = process.argv.slice(2);
  if (!venueId || !uid) {
    console.error('Usage: node scripts/admin/fix-membership.js <venueId> <uid> [role]');
    process.exit(1);
  }
  const role = roleArg || 'owner';
  const db = new Firestore();

  const docRef = db.doc(`venues/${venueId}/members/${uid}`);
  await docRef.set({
    uid,
    venueId,
    role,                 // 'owner' or 'manager'
    status: 'active',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  const snap = await docRef.get();
  console.log('✅ Membership upserted:', snap.id, '→', snap.data());
}

main().catch(e => {
  console.error('❌ Fix failed:', e);
  process.exit(1);
});
