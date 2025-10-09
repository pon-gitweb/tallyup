import * as functions from "firebase-functions";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, Query, QueryDocumentSnapshot } from "firebase-admin/firestore";

if (!getApps().length) initializeApp();

type RowOut = {
  itemId: string;
  name?: string | null;
  sku?: string | null;
  departmentId?: string | null;
  onHand?: number | null;
  par?: number | null;
  unit?: string | null;
  lastDeliveryAt?: string | null;
  auditTrail?: Array<{ at: string; action: string; qty?: number; by?: string }>;
  deltaVsPar: number;
  valueImpact?: number | null;

  // NEW: enrichments for AI
  recentSoldQty?: number | null;
  recentReceivedQty?: number | null;
};

function num(v: any, d = 0): number { return (typeof v === "number" && !Number.isNaN(v)) ? v : d; }
function nOrNull(v: any): number | null { return (typeof v === "number" && !Number.isNaN(v)) ? v : null; }
function s(v: any): string | null { if (v==null) return null; const t = String(v); return t || null; }

export const varianceDepartmentReport = functions
  .region("australia-southeast1")
  .https.onRequest(async (req, res): Promise<void> => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
    res.set("Access-Control-Allow-Methods", "POST,OPTIONS");

    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    try {
      const { venueId, departmentId } = req.body || {};
      if (!venueId || typeof venueId !== "string") {
        res.status(400).json({ error: "venueId (string) is required" });
        return;
      }

      const db = getFirestore();

      // Latest completed stocktake (scan latest few to avoid index)
      const stCol = db.collection("venues").doc(venueId).collection("stockTakes");
      const stSnap = await stCol.orderBy("completedAt", "desc").limit(5).get();
      let latest: QueryDocumentSnapshot | undefined;
      for (const d of stSnap.docs) {
        const st = d.data() || {};
        const status = String(st.status || "").toLowerCase();
        if (status === "complete" || status === "completed") { latest = d; break; }
      }
      const stockTakeId = latest?.id;

      // Load items from multiple possible locations
      type ItemDoc = { id: string; data: FirebaseFirestore.DocumentData };
      const found: ItemDoc[] = [];

      // 1) venues/{venueId}/items
      {
        let q: Query = db.collection("venues").doc(venueId).collection("items");
        if (departmentId) q = (q as FirebaseFirestore.CollectionReference).where("departmentId", "==", departmentId);
        const snap = await q.get();
        snap.forEach(d => found.push({ id: d.id, data: d.data() || {} }));
      }

      // 2) venues/{venueId}/products
      if (found.length === 0) {
        let q: Query = db.collection("venues").doc(venueId).collection("products");
        if (departmentId) q = (q as FirebaseFirestore.CollectionReference).where("departmentId", "==", departmentId);
        const snap = await q.get();
        snap.forEach(d => found.push({ id: d.id, data: d.data() || {} }));
      }

      // 3) venues/{venueId}/areas/*/items
      if (found.length === 0) {
        const areasSnap = await db.collection("venues").doc(venueId).collection("areas").get();
        for (const area of areasSnap.docs) {
          let q: Query = area.ref.collection("items");
          if (departmentId) q = (q as FirebaseFirestore.CollectionReference).where("departmentId", "==", departmentId);
          const snap = await q.get();
          snap.forEach(d => found.push({ id: d.id, data: d.data() || {} }));
        }
      }

      // Last counts (if stocktake exists)
      const lastCounts: Record<string, number> = {};
      if (stockTakeId) {
        const countsSnap = await stCol.doc(stockTakeId).collection("counts").get();
        countsSnap.forEach(doc => {
          const d = doc.data() || {};
          lastCounts[doc.id] = num(d.countQty ?? d.qty ?? d.quantity, 0);
        });
      }

      // Movement summaries (safe if absent)
      const sold: Record<string, number> = {};
      const recv: Record<string, number> = {};
      const recvLastDate: Record<string, string> = {};

      try {
        const salesDoc = await db
          .collection("venues").doc(venueId)
          .collection("reports").doc("sales")
          .collection("latest").doc("summary")
          .get();
        if (salesDoc.exists) {
          const mm = salesDoc.data() || {};
          if (mm.items && typeof mm.items === "object") {
            Object.entries(mm.items).forEach(([id, v]: any) => { sold[id] = num(v?.qty, 0); });
          }
        }
      } catch {}

      try {
        const invDoc = await db
          .collection("venues").doc(venueId)
          .collection("reports").doc("invoices")
          .collection("latest").doc("summary")
          .get();
        if (invDoc.exists) {
          const mm = invDoc.data() || {};
          if (mm.items && typeof mm.items === "object") {
            Object.entries(mm.items).forEach(([id, v]: any) => {
              recv[id] = num(v?.qty, 0);
              // NEW: try common date fields if present in your summary
              const d = v?.lastDate || v?.lastDeliveryAt || v?.last_received_at || v?.last_received_date;
              if (d) recvLastDate[id] = String(d);
            });
          }
        }
      } catch {}

      // Build rows + debug metrics
      const out: RowOut[] = [];
      let itemsFetched = 0;
      let withPar = 0;
      let withLastCount = 0;
      let withMovement = 0;

      for (const { id: itemId, data: it } of found) {
        itemsFetched++;

        const par = nOrNull(it.par ?? it.parLevel ?? it.expectedQty ?? it.expected);
        if (par != null) withPar++;

        const unitCost = nOrNull(it.costPrice ?? it.cost ?? it.avgCost ?? it.price);
        const name = s(it.name) ?? s(it.label);
        const sku = s(it.sku) ?? s(it.code) ?? s(it.barcode);
        const deptId = s(it.departmentId) ?? s(it.department) ?? s(it.deptId);

        const lastCount = nOrNull(lastCounts[itemId]);
        if (lastCount != null) withLastCount++;

        const rcv = num(recv[itemId], 0);
        const sld = num(sold[itemId], 0);
        if (rcv !== 0 || sld !== 0) withMovement++;

        const theoretical = (lastCount ?? 0) + rcv - sld;
        const baseline = (rcv !== 0 || sld !== 0) ? theoretical : (lastCount ?? 0);
        const deltaVsPar = par != null ? (baseline - par) : baseline;
        const valueImpact = (unitCost != null) ? deltaVsPar * unitCost : null;

        out.push({
          itemId,
          name,
          sku,
          departmentId: deptId,
          onHand: nOrNull(baseline),
          par,
          unit: s(it.unit) ?? null,
          lastDeliveryAt: recvLastDate[itemId] ?? null,        // NEW
          auditTrail: undefined,
          deltaVsPar,
          valueImpact,
          recentSoldQty: sld || null,                          // NEW
          recentReceivedQty: rcv || null,                      // NEW
        });
      }

      const shortages = out.filter(r => r.deltaVsPar < 0);
      const excesses  = out.filter(r => r.deltaVsPar > 0);
      const totalShortageValue = shortages.reduce((a,r)=>a + (r.valueImpact && r.valueImpact<0 ? Math.abs(r.valueImpact) : 0),0);
      const totalExcessValue   = excesses.reduce((a,r)=>a + (r.valueImpact && r.valueImpact>0 ? r.valueImpact : 0),0);

      res.status(200).json({
        ok: true,
        venueId,
        departmentId: departmentId ?? null,
        shortages,
        excesses,
        totalShortageValue,
        totalExcessValue,
        notes: {
          confidence: out.length === 0 ? "none" :
            (Object.keys(sold).length || Object.keys(recv).length) ? "medium" : "low",
          wouldImprove: [
            "Per-item sales between last two stocktakes",
            "Per-item received qty (linked invoices) for that window",
            "Explicit par per item",
            "Adjustment audit trail between counts"
          ],
          debug: {
            stockTakeId: stockTakeId ?? null,
            itemsFetched,
            withPar,
            withLastCount,
            withMovement,
            sourceTriedOrder: ["venues/{venueId}/items","venues/{venueId}/products","venues/{venueId}/areas/*/items"]
          }
        }
      });
      return;
    } catch (e: any) {
      console.error("[varianceDepartmentReport] error", e);
      res.status(500).json({ ok:false, error: e?.message || String(e) });
      return;
    }
  });
