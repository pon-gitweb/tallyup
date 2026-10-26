import * as admin from "firebase-admin";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import {
  MAPPING_FIELDS,
  MappingVersion, VersionMappingFields,
  diffMappingVsVersion, reportDates,
} from "./mappingVersions";
import { matchAndStoreSalesLines } from "./api";
import { isReportActive } from "./isReportActive";

const REGION = "australia-southeast1";

export const onPosMappingWrittenSyncVersion = onDocumentWritten(
  { document: "venues/{venueId}/posProductMappings/{mappingId}", region: REGION },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return; // deleted — nothing to do

    const { venueId } = event.params;
    const parentData = after.data() as Record<string, unknown>;
    const key = ((parentData.posItemName as string) || '').toLowerCase();
    if (!key) return;

    const db = admin.firestore();

    // Load all versions for this key (sorted asc by effectiveFrom)
    const versionsSnap = await db.collection(`venues/${venueId}/posMappingVersions`)
      .where('mappingKey', '==', key)
      .orderBy('effectiveFrom', 'asc')
      .get();

    if (versionsSnap.empty) return; // unversioned key — behaves exactly as today

    const versions: MappingVersion[] = versionsSnap.docs.map(d =>
      ({ id: d.id, ...(d.data() as any) }) as MappingVersion
    );
    const latest = versions[versions.length - 1];

    if (!diffMappingVsVersion(parentData, latest)) return; // no difference — normal case

    // Parent differs from latest version — a client (e.g. mobile) wrote the parent directly.
    // Treat as editing the CURRENT version only: update its mapping fields to match parent.
    // Never create new versions, never change effectiveFrom, never touch older versions.
    const latestRef = db.doc(`venues/${venueId}/posMappingVersions/${latest.id}`);

    const updatedFields: Record<string, unknown> = {};
    for (const field of MAPPING_FIELDS) {
      updatedFields[field] = parentData[field] ?? null;
    }
    updatedFields.updatedByTrigger = true;
    updatedFields.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    await db.runTransaction(async (tx) => {
      // Re-read latest to avoid races
      const latestSnap = await tx.get(latestRef);
      if (!latestSnap.exists) return; // version was deleted mid-flight; abort
      tx.update(latestRef, updatedFields);
      // DO NOT write the parent doc (no loops)
    });

    // Re-match active reports whose dates overlap the latest version's range [effectiveFrom, today]
    const venueSnap = await db.doc(`venues/${venueId}`).get();
    const tz: string = (venueSnap.data() as any)?.timezone || 'Pacific/Auckland';
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: tz });

    const reportsSnap = await db.collection(`venues/${venueId}/salesReports`).get();
    const toReMatch: string[] = [];
    reportsSnap.forEach(d => {
      const rdata = d.data() as any;
      if (!isReportActive(rdata)) return;
      const periodEndTs: FirebaseFirestore.Timestamp | null = rdata?.periodEnd ?? null;
      if (!periodEndTs) { toReMatch.push(d.id); return; }
      const periodEndStr = periodEndTs.toDate().toLocaleDateString('en-CA', { timeZone: tz });
      if (periodEndStr >= latest.effectiveFrom && periodEndStr <= todayStr) {
        toReMatch.push(d.id);
      }
    });

    await Promise.all(toReMatch.map(async (reportId) => {
      try {
        const rSnap = await db.doc(`venues/${venueId}/salesReports/${reportId}`).get();
        if (!rSnap.exists) return;
        const rdata = rSnap.data() as any;
        const rawLines: any[] = rdata?.report?.lines ?? rdata?.lines ?? [];
        const per = rdata?.report?.period || rdata?.period || null;
        await matchAndStoreSalesLines(db, venueId, reportId, 'trigger-mapping-sync',
          rawLines.map((l: any) => ({
            name: l.name,
            qtySold: Number(l.qty ?? l.qtySold ?? 0),
            gross: l.revenue ?? l.gross ?? null,
            barcode: l.barcode ?? null,
            sku: l.sku ?? null,
          })), per);
      } catch (e: any) {
        console.error(`[onPosMappingWrittenSyncVersion] re-match error reportId=${reportId}`, e?.message);
      }
    }));

    console.log(`[onPosMappingWrittenSyncVersion] synced key=${key} latest=${latest.id} reMatched=${toReMatch.length}`);
  }
);
