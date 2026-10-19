import * as admin from "firebase-admin";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { planNeutralise } from "./snapshotSalesNeutralise";

const REGION = "australia-southeast1";

// ── Exported transaction logic (testable with a fake db) ──────────────────────
//
// Reads snapshot doc + all chunk docs inside a single transaction, then writes
// corrected items if planNeutralise finds any numeric soldQty.  Idempotency:
// planNeutralise returns noop when no item has a numeric soldQty, so a second
// run after neutralising does nothing.  soldQtyNeutralisedAt is an audit stamp.
//
// Chunk docs are named "000", "001", … (snapshotWriter.ts uses String(i).padStart(3,'0')).

export async function neutraliseSnapshotTransaction(
  database: admin.firestore.Firestore,
  venueId: string,
  departmentId: string,
  snapshotId: string,
): Promise<"noop" | "abort" | "written"> {
  let outcome: "noop" | "abort" | "written" = "noop";

  const snapshotRef = database
    .collection("venues")
    .doc(venueId)
    .collection("departments")
    .doc(departmentId)
    .collection("snapshots")
    .doc(snapshotId);

  await database.runTransaction(async (tx) => {
    // 1. Read snapshot doc inside the transaction
    const snapDoc = await tx.get(snapshotRef);
    if (!snapDoc.exists) return;
    const docData = snapDoc.data() as Record<string, any>;

    // 2. Read chunk docs by known IDs inside the transaction
    const chunkDocs: Array<{ id: string; index: number; items: any[] }> = [];
    const chunkCount: number = docData.itemChunkCount ?? 0;
    if (chunkCount > 0) {
      const chunkColl = snapshotRef.collection("itemChunks");
      const chunkRefs = Array.from({ length: chunkCount }, (_, i) =>
        chunkColl.doc(String(i).padStart(3, "0")),
      );
      const chunkSnaps = await Promise.all(chunkRefs.map(r => tx.get(r)));
      for (const cd of chunkSnaps) {
        if (cd.exists) {
          const data = cd.data()!;
          chunkDocs.push({ id: cd.id, index: data.index ?? 0, items: data.items ?? [] }); // snapshot-items-ok — chunk doc fields
        }
      }
    }

    // 3. Run pure plan on fresh data read inside the transaction
    const plan = planNeutralise(docData, chunkDocs);
    if (plan.noop) return;
    if (plan.abort) {
      console.error(
        `[neutralise] abort venueId=${venueId} snapshotId=${snapshotId}: ${plan.abort}`,
      );
      outcome = "abort";
      return;
    }

    // 4. Write — all in the same transaction
    tx.update(snapshotRef, {
      ...plan.docUpdate,
      soldQtyNeutralisedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (plan.correctedChunks && plan.correctedChunks.length > 0) {
      const chunkColl = snapshotRef.collection("itemChunks");
      for (const chunk of plan.correctedChunks) {
        tx.set(
          chunkColl.doc(chunk.id),
          { index: chunk.index, items: chunk.items },
          { merge: true },
        );
      }
    }

    outcome = "written";
  });

  return outcome;
}

// ── syncLatest ────────────────────────────────────────────────────────────────
// latestSnapshot/current shape (written by snapshotWriter.ts ~901-906):
//   { updatedAt, departments: Array<{ departmentId, departmentName, cycleNumber,
//     completedAt, summary, dataCompleteness }>, totalDepts, deptsWithData }
//
// For each array entry whose linked snapshot has soldQtyNeutralisedAt, replaces
// the entry's summary and dataCompleteness if they differ.  All reads happen
// before any write.  Preserves array order.

export async function syncLatest(
  database: admin.firestore.Firestore,
  venueId: string,
): Promise<void> {
  const latestRef = database
    .collection("venues")
    .doc(venueId)
    .collection("latestSnapshot")
    .doc("current");

  try {
    await database.runTransaction(async (tx) => {
      const latestSnap = await tx.get(latestRef);
      if (!latestSnap.exists) return;

      const latestData = latestSnap.data() as Record<string, any>;
      const departments: any[] = Array.isArray(latestData.departments)
        ? latestData.departments : [];

      // Gather all snapshot refs first so all reads happen before any write
      const toRead: Array<{
        idx: number;
        entry: any;
        ref: admin.firestore.DocumentReference;
      }> = [];

      for (let i = 0; i < departments.length; i++) {
        const entry = departments[i];
        const deptId: string = entry.departmentId;
        const cycleNumber: number | undefined = entry.cycleNumber;
        if (!deptId || cycleNumber == null) continue;
        toRead.push({
          idx: i,
          entry,
          ref: database
            .collection("venues")
            .doc(venueId)
            .collection("departments")
            .doc(deptId)
            .collection("snapshots")
            .doc(`cycle-${cycleNumber}`),
        });
      }

      // All reads inside the transaction before any write
      const snapDocs = await Promise.all(toRead.map(({ ref }) => tx.get(ref)));

      let changed = false;
      const updatedDepts = departments.slice();

      for (let k = 0; k < toRead.length; k++) {
        const { idx, entry } = toRead[k];
        const snapDoc = snapDocs[k];
        if (!snapDoc.exists) continue;

        const snapData = snapDoc.data() as Record<string, any>;
        if (!snapData.soldQtyNeutralisedAt) continue;

        const srcSummary = snapData.summary ?? {};
        const dstSummary = entry.summary ?? {};
        const srcDC = snapData.dataCompleteness;
        const dstDC = entry.dataCompleteness;

        const summaryChanged = (
          srcSummary.unexplainedVarianceQty !== dstSummary.unexplainedVarianceQty ||
          srcSummary.unexplainedVarianceDollars !== dstSummary.unexplainedVarianceDollars ||
          srcSummary.displayUnexplainedVarianceDollars !== dstSummary.displayUnexplainedVarianceDollars
        );
        const dcChanged = Boolean(srcDC && (
          srcDC.hasSales !== (dstDC?.hasSales) ||
          srcDC.tier !== (dstDC?.tier)
        ));

        if (summaryChanged || dcChanged) {
          updatedDepts[idx] = {
            ...entry,
            summary: {
              ...dstSummary,
              unexplainedVarianceQty: srcSummary.unexplainedVarianceQty ?? null,
              unexplainedVarianceDollars: srcSummary.unexplainedVarianceDollars ?? null,
              displayUnexplainedVarianceDollars: srcSummary.displayUnexplainedVarianceDollars ?? null,
            },
            ...(srcDC ? { dataCompleteness: srcDC } : {}),
          };
          changed = true;
        }
      }

      if (changed) {
        tx.update(latestRef, { departments: updatedDepts });
      }
    });
  } catch (e: any) {
    console.warn("[syncLatest] failed:", e?.message || e);
  }
}

// ── 1. onSnapshotWrittenNeutraliseSales ───────────────────────────────────────

export const onSnapshotWrittenNeutraliseSales = onDocumentWritten(
  {
    document: "venues/{venueId}/departments/{departmentId}/snapshots/{snapshotId}",
    region: REGION,
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return; // delete — nothing to do

    const { venueId, departmentId, snapshotId } = event.params;
    const db = admin.firestore();

    // Quick pre-check from event data: skip if inline items have no soldQty and
    // there are no chunks.  If chunks exist, the transaction decides.
    const docData = after.data() as Record<string, any>;
    const inlineItems: any[] = docData.items ?? []; // snapshot-items-ok — pre-check only
    const anyInlineSoldQty = inlineItems.some(it => typeof it.soldQty === "number");
    if ((docData.itemChunkCount ?? 0) === 0 && !anyInlineSoldQty) return;

    const outcome = await neutraliseSnapshotTransaction(db, venueId, departmentId, snapshotId);
    if (outcome === "written") {
      await syncLatest(db, venueId);
    }
  },
);

// ── 2. onLatestSnapshotWrittenSync ────────────────────────────────────────────

export const onLatestSnapshotWrittenSync = onDocumentWritten(
  {
    document: "venues/{venueId}/latestSnapshot/current",
    region: REGION,
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;
    const { venueId } = event.params;
    await syncLatest(admin.firestore(), venueId);
  },
);
