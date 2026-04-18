import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";

// ── Timezone check ────────────────────────────────────────────────────────────
// Returns true when the current UTC moment is Monday 8:00 (hour=8) in the
// given IANA timezone. The hourly schedule guarantees we land here once a week.
function isMonday8amLocal(timezone: string): boolean {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
      hour: "numeric",
      hour12: false,
    }).formatToParts(new Date());
    const weekday = parts.find((p) => p.type === "weekday")?.value;
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "-1", 10);
    return weekday === "Monday" && hour === 8;
  } catch {
    return false;
  }
}

// ── Email resolution ──────────────────────────────────────────────────────────
// Collects email addresses for all managers + the owner of a venue.
// Tries users/{uid} first (written at registration), falls back to Firebase Auth.
async function getManagerEmails(
  db: FirebaseFirestore.Firestore,
  venueId: string,
  ownerUid: string | null
): Promise<string[]> {
  const emails: string[] = [];
  const seen = new Set<string>();

  const addEmail = async (uid: string) => {
    if (!uid || seen.has(uid)) return;
    seen.add(uid);
    try {
      const userDoc = await db.doc(`users/${uid}`).get();
      const email: string | undefined = userDoc.data()?.email;
      if (email) { emails.push(email); return; }
      const record = await admin.auth().getUser(uid);
      if (record.email) emails.push(record.email);
    } catch (e) {
      console.warn(`[weeklySummary] could not resolve email for uid=${uid}`, e);
    }
  };

  if (ownerUid) await addEmail(ownerUid);

  try {
    const membersSnap = await db.collection(`venues/${venueId}/members`).get();
    for (const m of membersSnap.docs) {
      const role: string | undefined = m.data()?.role;
      if (role === "manager" || role === "owner") await addEmail(m.id);
    }
  } catch (e) {
    console.warn(`[weeklySummary] could not list members for venue=${venueId}`, e);
  }

  return emails;
}

// ── Data collection ───────────────────────────────────────────────────────────

interface ItemRow {
  name: string;
  lastCount: number;
  parLevel?: number;
  unit?: string;
}

interface VenueSummary {
  venueName: string;
  stocktakesCompleted: number;
  areasCompleted: string[];
  reorderItems: ItemRow[];   // lastCount < parLevel
  flaggedItems: ItemRow[];   // flagRecount === true
  zeroItems: ItemRow[];      // lastCount === 0
  topItems: ItemRow[];       // highest counts in active areas
}

async function collectVenueSummary(
  db: FirebaseFirestore.Firestore,
  venueId: string
): Promise<VenueSummary> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const venueSnap = await db.doc(`venues/${venueId}`).get();
  const venueName: string = venueSnap.data()?.name || venueId;

  const reorderItems: ItemRow[] = [];
  const flaggedItems: ItemRow[] = [];
  const zeroItems: ItemRow[] = [];
  const allActiveItems: ItemRow[] = [];
  const areasCompleted: string[] = [];
  let stocktakesCompleted = 0;

  const depsSnap = await db.collection(`venues/${venueId}/departments`).limit(20).get();

  for (const depDoc of depsSnap.docs) {
    const areasSnap = await db
      .collection(`venues/${venueId}/departments/${depDoc.id}/areas`)
      .limit(30)
      .get();

    for (const areaDoc of areasSnap.docs) {
      const area = areaDoc.data();

      // Count completed stocktakes this week
      const completedAt: Date | undefined = area?.completedAt?.toDate?.();
      if (completedAt && completedAt >= sevenDaysAgo) {
        stocktakesCompleted++;
        areasCompleted.push(area?.name || areaDoc.id);
      }

      // Only pull items from areas active in the last 7 days
      const startedAt: Date | undefined = area?.startedAt?.toDate?.();
      if (!startedAt || startedAt < sevenDaysAgo) continue;

      const itemsSnap = await db
        .collection(`venues/${venueId}/departments/${depDoc.id}/areas/${areaDoc.id}/items`)
        .limit(200)
        .get();

      for (const itemDoc of itemsSnap.docs) {
        const item = itemDoc.data();
        const lastCount = typeof item.lastCount === "number" ? item.lastCount : null;
        if (lastCount === null) continue;

        const name: string = item.name || "Unknown";
        const parLevel: number | undefined = typeof item.parLevel === "number" ? item.parLevel : undefined;
        const unit: string | undefined = item.unit || undefined;

        allActiveItems.push({ name, lastCount, parLevel, unit });

        if (parLevel !== undefined && lastCount < parLevel && reorderItems.length < 10)
          reorderItems.push({ name, lastCount, parLevel, unit });

        if (item.flagRecount && flaggedItems.length < 10)
          flaggedItems.push({ name, lastCount, unit });

        if (lastCount === 0 && zeroItems.length < 10)
          zeroItems.push({ name });
      }
    }
  }

  const topItems = [...allActiveItems]
    .sort((a, b) => b.lastCount - a.lastCount)
    .slice(0, 5);

  return { venueName, stocktakesCompleted, areasCompleted, reorderItems, flaggedItems, zeroItems, topItems };
}

// ── Email HTML builder ────────────────────────────────────────────────────────

function buildEmailHtml(data: VenueSummary, weekOf: string): string {
  const { venueName, stocktakesCompleted, areasCompleted, reorderItems, flaggedItems, zeroItems, topItems } = data;

  const section = (title: string, body: string) => `
    <div style="margin-bottom:28px;">
      <h2 style="margin:0 0 10px;font-size:13px;font-weight:800;color:#6B7280;
                 text-transform:uppercase;letter-spacing:0.8px;border-bottom:1px solid #F3F4F6;
                 padding-bottom:8px;">${title}</h2>
      ${body}
    </div>`;

  const pill = (bg: string, fg: string, text: string) =>
    `<span style="display:inline-block;padding:2px 10px;border-radius:99px;
                  background:${bg};color:${fg};font-size:12px;font-weight:700;">${text}</span>`;

  const tableRow = (left: string, right: string) =>
    `<tr>
      <td style="padding:7px 0;font-size:14px;color:#374151;
                 border-bottom:1px solid #F9FAFB;">${left}</td>
      <td style="padding:7px 0;text-align:right;
                 border-bottom:1px solid #F9FAFB;">${right}</td>
    </tr>`;

  const none = `<p style="font-size:13px;color:#9CA3AF;margin:0;">Nothing to report this week.</p>`;

  const stocktakeBody = stocktakesCompleted === 0
    ? `<p style="font-size:13px;color:#9CA3AF;margin:0;">No stocktakes completed this week.</p>`
    : `<p style="margin:0 0 10px;font-size:14px;color:#374151;">
         <strong>${stocktakesCompleted}</strong>&nbsp;area${stocktakesCompleted !== 1 ? "s" : ""} completed this week.
       </p>
       <div style="display:flex;flex-wrap:wrap;gap:6px;">
         ${areasCompleted.slice(0, 8).map((a) =>
           `<span style="font-size:13px;color:#059669;background:#ECFDF5;
                         padding:3px 10px;border-radius:99px;font-weight:600;">&#10003; ${a}</span>`
         ).join("")}
         ${areasCompleted.length > 8
           ? `<span style="font-size:13px;color:#9CA3AF;">+${areasCompleted.length - 8} more</span>`
           : ""}
       </div>`;

  const reorderBody = reorderItems.length === 0
    ? `<p style="font-size:13px;color:#059669;font-weight:600;margin:0;">
         &#10003; All tracked items above par level.
       </p>`
    : `<table style="width:100%;border-collapse:collapse;">
         <tr>
           <th style="text-align:left;font-size:11px;color:#9CA3AF;font-weight:700;
                      text-transform:uppercase;padding-bottom:6px;">Item</th>
           <th style="text-align:right;font-size:11px;color:#9CA3AF;font-weight:700;
                      text-transform:uppercase;padding-bottom:6px;">On Hand / Par</th>
         </tr>
         ${reorderItems.map((i) =>
           tableRow(
             `${i.name}${i.unit ? ` <span style="color:#9CA3AF;">(${i.unit})</span>` : ""}`,
             pill("#FEE2E2", "#991B1B", `${i.lastCount} / ${i.parLevel}`)
           )
         ).join("")}
       </table>`;

  const flaggedBody = flaggedItems.length === 0 ? none
    : `<table style="width:100%;border-collapse:collapse;">
         ${flaggedItems.map((i) =>
           tableRow(i.name, pill("#FEF3C7", "#92400E", `Count: ${i.lastCount}`))
         ).join("")}
       </table>`;

  const topBody = topItems.length === 0 ? none
    : `<table style="width:100%;border-collapse:collapse;">
         <tr>
           <th style="text-align:left;font-size:11px;color:#9CA3AF;font-weight:700;
                      text-transform:uppercase;padding-bottom:6px;">Product</th>
           <th style="text-align:right;font-size:11px;color:#9CA3AF;font-weight:700;
                      text-transform:uppercase;padding-bottom:6px;">Last Count</th>
         </tr>
         ${topItems.map((i) =>
           tableRow(
             `${i.name}${i.unit ? ` <span style="color:#9CA3AF;">(${i.unit})</span>` : ""}`,
             pill("#DBEAFE", "#1E40AF", String(i.lastCount))
           )
         ).join("")}
       </table>`;

  const zeroBody = zeroItems.length === 0
    ? `<p style="font-size:13px;color:#059669;font-weight:600;margin:0;">
         &#10003; No zero-stock items in active areas.
       </p>`
    : zeroItems.map((i) =>
        `<div style="font-size:14px;color:#DC2626;padding:4px 0;">&#9888; ${i.name}</div>`
      ).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Weekly Stock Summary</title>
</head>
<body style="margin:0;padding:0;background:#F3F4F6;
             font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:580px;margin:32px auto;padding:0 16px 32px;">

    <div style="background:#0F172A;border-radius:16px 16px 0 0;padding:24px;text-align:center;">
      <div style="font-size:11px;color:#64748B;font-weight:700;letter-spacing:1px;
                  text-transform:uppercase;">Hosti-Stock</div>
      <h1 style="margin:6px 0 2px;font-size:24px;font-weight:800;color:white;">Weekly Summary</h1>
      <div style="font-size:13px;color:#94A3B8;">${venueName} &middot; Week of ${weekOf}</div>
    </div>

    <div style="background:white;padding:28px 24px;border-radius:0 0 16px 16px;
                box-shadow:0 4px 16px rgba(0,0,0,0.06);">

      ${section("Stocktake Activity", stocktakeBody)}
      ${section("Reorder Suggestions", reorderBody)}
      ${section("Flagged for Recount", flaggedBody)}
      ${section("Top Counted Products", topBody)}
      ${section("Zero Stock", zeroBody)}

      <div style="margin-top:24px;padding-top:20px;border-top:1px solid #F3F4F6;text-align:center;">
        <p style="margin:0;font-size:12px;color:#9CA3AF;line-height:1.7;">
          You're receiving this because weekly summaries are enabled for
          <strong>${venueName}</strong>.<br>
          To unsubscribe, open <strong>Settings &rarr; Weekly Summary Email</strong> in Hosti-Stock.
        </p>
      </div>
    </div>

    <p style="text-align:center;font-size:11px;color:#CBD5E1;margin-top:16px;">
      Hosti-Stock &middot; Powered by TallyUp
    </p>
  </div>
</body>
</html>`;
}

// ── Resend delivery ───────────────────────────────────────────────────────────
// Resend uses a plain REST API — no SDK required, consistent with existing fetch calls.
// Prerequisites: verify your sending domain in the Resend dashboard and update
// the `from` address below to match (e.g. reports@yourdomain.com).
async function sendViaResend(
  apiKey: string,
  to: string[],
  subject: string,
  html: string
): Promise<void> {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Hosti-Stock <reports@hosti.co.nz>",
      to,
      subject,
      html,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "(no body)");
    throw new Error(`Resend error ${resp.status}: ${body}`);
  }
}

// ── Scheduled function ────────────────────────────────────────────────────────
// Runs every hour in UTC. For each opted-in venue, checks whether the current
// moment is Monday 8:00 in the venue's local timezone before sending.
// Set RESEND_API_KEY via: firebase functions:secrets:set RESEND_API_KEY
export const weeklySummaryEmail = onSchedule(
  {
    schedule: "0 * * * *",
    timeZone: "UTC",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 540,
    secrets: ["RESEND_API_KEY"],
  },
  async () => {
    const db = admin.firestore();
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error("[weeklySummary] RESEND_API_KEY not configured — skipping run");
      return;
    }

    let venuesSnap: FirebaseFirestore.QuerySnapshot;
    try {
      venuesSnap = await db
        .collection("venues")
        .where("weeklySummaryEmail", "==", true)
        .get();
    } catch (e) {
      console.error("[weeklySummary] failed to query opted-in venues:", e);
      return;
    }

    if (venuesSnap.empty) {
      console.log("[weeklySummary] no opted-in venues this hour");
      return;
    }

    const results = await Promise.allSettled(
      venuesSnap.docs.map(async (venueDoc) => {
        const venueId = venueDoc.id;
        const venueData = venueDoc.data();
        const timezone: string = venueData.timezone || "Pacific/Auckland";

        if (!isMonday8amLocal(timezone)) return;

        console.log(`[weeklySummary] sending for venue=${venueId} tz=${timezone}`);

        const [summary, emails] = await Promise.all([
          collectVenueSummary(db, venueId),
          getManagerEmails(db, venueId, venueData.ownerUid || null),
        ]);

        if (emails.length === 0) {
          console.warn(`[weeklySummary] no manager emails found for venue=${venueId}`);
          return;
        }

        const weekOf = new Date().toLocaleDateString("en-NZ", {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: timezone,
        });

        const html = buildEmailHtml(summary, weekOf);
        await sendViaResend(apiKey, emails, `Weekly Stock Summary — ${summary.venueName}`, html);
        console.log(`[weeklySummary] sent to [${emails.join(", ")}] for venue=${venueId}`);
      })
    );

    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    if (failed.length > 0) {
      console.error(`[weeklySummary] ${failed.length}/${results.length} venue(s) failed`);
      failed.forEach((f) => console.error("[weeklySummary] error:", f.reason));
    }
  }
);
