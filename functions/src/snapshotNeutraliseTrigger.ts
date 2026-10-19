import * as admin from "firebase-admin";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { planNeutralise } from "./snapshotSalesNeutralise";

const REGION = "australia-southeast1";

const db = () => admin.firestore();

// ── helpers ───────────────────────────────────────────────────────────────────

async function loadChunkDocs(
  venueId: string,
  departmentId: string,
  snapshotId: string,
): Promise<Array<{ id: string; index: number; items: any[] }>> {
  const snap = await db()
    .collection("venues")
    .doc(venueId)
    .collection("departments")
    .doc(departmentId)
    .collection("snapshots")
    .doc(snapshotId)
    .collection("itemChunks")
    .get();
  return snap.docs.map(d => {
    const data = d.data();
    return { id: d.id, index: data.index ?? 0, items: data.items ?? [] }; // snapshot-items-ok — chunk doc, not snapshot doc
  });
}

// ── 1. onSnapshotWrittenNeutraliseSales ───────────────────────────────────────
// Fires on every write to a snapshot doc.  Skips deletes and docs that have
// already been neutralised this run (idempotent via soldQtyNeutralisedAt).

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

    const docData = after.data() as Record<string, any>;
    const { venueId, departmentId, snapshotId } = event.params;

    // Skip if already neutralised
    if (docData.soldQtyNeutralisedAt) return;

    // Bail if no item has soldQty — planNeutralise handles this as noop, but
    // skip the chunk read entirely when the inline list has none.
    const inlineItems: any[] = docData.items ?? []; // snapshot-items-ok — optimization pre-check; full item set handled by planNeutralise
    const mayHaveSoldQty = inlineItems.some(it => typeof it.soldQty === "number");
    // Chunked docs may have soldQty even when inline items don't (inline = first 200).
    // Always load chunks so planNeutralise can inspect all items.
    const chunkDocs = docData.itemChunkCount > 0
      ? await loadChunkDocs(venueId, departmentId, snapshotId)
      : [];

    if (docData.itemChunkCount === 0 && !mayHaveSoldQty) return;

    const plan = planNeutralise(docData, chunkDocs);
    if (plan.noop) return;
    if (plan.abort) {
      console.error(`[neutralise] abort venueId=${venueId} snapshotId=${snapshotId}: ${plan.abort}`);
      return;
    }

    const snapshotRef = db()
      .collection("venues")
      .doc(venueId)
      .collection("departments")
      .doc(departmentId)
      .collection("snapshots")
      .doc(snapshotId);

    await db().runTransaction(async (tx) => {
      const fresh = await tx.get(snapshotRef);
      if (!fresh.exists) return;
      const freshData = fresh.data() as Record<string, any>;
      // Re-check idempotency inside transaction
      if (freshData.soldQtyNeutralisedAt) return;

      // Update inline fields on the snapshot doc
      tx.update(snapshotRef, {
        ...plan.docUpdate,
        soldQtyNeutralisedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Update each chunk doc
      if (plan.correctedChunks && plan.correctedChunks.length > 0) {
        const chunkColl = snapshotRef.collection("itemChunks");
        for (const chunk of plan.correctedChunks) {
          tx.update(chunkColl.doc(chunk.id), { items: chunk.items });
        }
      }
    });

    // Sync summary into latestSnapshot/current
    await syncLatest(venueId);
  },
);

// ── 2. onLatestSnapshotWrittenSync ────────────────────────────────────────────
// Fires on writes to the latestSnapshot summary doc and re-syncs any dept
// entries whose source snapshot was already neutralised.

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
    await syncLatest(venueId);
  },
);

// ── syncLatest ────────────────────────────────────────────────────────────────
// Reads venues/{venueId}/latestSnapshot/current.  For each dept entry whose
// linked snapshot has soldQtyNeutralisedAt set, replaces the entry's summary
// fields with the corrected values if they differ.

async function syncLatest(venueId: string): Promise<void> {
  const latestRef = db()
    .collection("venues")
    .doc(venueId)
    .collection("latestSnapshot")
    .doc("current");

  try {
    await db().runTransaction(async (tx) => {
      const latestSnap = await tx.get(latestRef);
      if (!latestSnap.exists) return;

      const latestData = latestSnap.data() as Record<string, any>;
      const departments: Record<string, any> = latestData.departments ?? {};

      let changed = false;
      const updatedDepts: Record<string, any> = {};

      for (const [deptId, deptEntry] of Object.entries(departments)) {
        const snapshotId = deptEntry.snapshotId as string | undefined;
        if (!snapshotId) {
          updatedDepts[deptId] = deptEntry;
          continue;
        }

        const [, departmentId] = deptId.startsWith("dept-") ? [null, deptId] : [null, deptId];
        const snapRef = db()
          .collection("venues")
          .doc(venueId)
          .collection("departments")
          .doc(departmentId)
          .collection("snapshots")
          .doc(snapshotId);

        const snapDoc = await tx.get(snapRef);
        if (!snapDoc.exists) {
          updatedDepts[deptId] = deptEntry;
          continue;
        }

        const snapData = snapDoc.data() as Record<string, any>;
        if (!snapData.soldQtyNeutralisedAt) {
          updatedDepts[deptId] = deptEntry;
          continue;
        }

        // Compare the three unexplained summary fields
        const srcSummary = snapData.summary ?? {};
        const dstSummary = deptEntry.summary ?? {};
        const fields: (keyof typeof srcSummary)[] = [
          "unexplainedVarianceQty",
          "unexplainedVarianceDollars",
          "displayUnexplainedVarianceDollars",
        ];
        const needsUpdate = fields.some(f => srcSummary[f] !== dstSummary[f]);
        if (needsUpdate) {
          updatedDepts[deptId] = {
            ...deptEntry,
            summary: {
              ...dstSummary,
              unexplainedVarianceQty: srcSummary.unexplainedVarianceQty ?? null,
              unexplainedVarianceDollars: srcSummary.unexplainedVarianceDollars ?? null,
              displayUnexplainedVarianceDollars: srcSummary.displayUnexplainedVarianceDollars ?? null,
            },
          };
          changed = true;
        } else {
          updatedDepts[deptId] = deptEntry;
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
