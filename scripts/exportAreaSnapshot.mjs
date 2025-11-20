import fs from 'fs';
import admin from 'firebase-admin';

// 1) Initialise Admin SDK using the service account
const serviceAccount = JSON.parse(
  fs.readFileSync('./secret/serviceAccountKey.json', 'utf8')
);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

// TODO: adjust these if needed
const VENUE_ID = 'v_7ykrc92wuw58gbrgyicr7e';  // from your screenshot
const DEPT_ID  = 'Bar';                       // department id
const AREA_ID  = 'BackBar';                   // area id

async function main() {
  const colRef = db
    .collection('venues')
    .doc(VENUE_ID)
    .collection('departments')
    .doc(DEPT_ID)
    .collection('areas')
    .doc(AREA_ID)
    .collection('items');

  const snap = await colRef.get();

  const out = [];
  snap.forEach(doc => {
    out.push({ id: doc.id, ...doc.data() });
  });

  const json = JSON.stringify(out, null, 2);
  const fileName = `export-${VENUE_ID}-${DEPT_ID}-${AREA_ID}.json`;
  fs.writeFileSync(fileName, json, 'utf8');

  console.log(`Exported ${out.length} items -> ${fileName}`);
}

main().catch(err => {
  console.error('Export failed:', err);
  process.exit(1);
});
