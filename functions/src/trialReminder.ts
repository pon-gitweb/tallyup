import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";

const THIRTY_DAYS_MS  = 30 * 24 * 60 * 60 * 1000;
const EIGHT_DAYS_MS   =  8 * 24 * 60 * 60 * 1000;

// Resolves the owner email for a venue: checks users/{uid} first,
// falls back to Firebase Auth.
async function getOwnerEmail(
  db: admin.firestore.Firestore,
  ownerUid: string,
): Promise<string | null> {
  try {
    const userSnap = await db.doc(`users/${ownerUid}`).get();
    const email: string | undefined = userSnap.data()?.email;
    if (email) return email;
    const authUser = await admin.auth().getUser(ownerUid);
    return authUser.email ?? null;
  } catch {
    return null;
  }
}

function buildReminderHtml(venueName: string, stocktakesUsed: number): string {
  const remaining = Math.max(0, 3 - stocktakesUsed);
  const stocktakeNote = remaining === 1
    ? `You have <strong>1 stocktake left</strong> in your trial.`
    : `You've used ${stocktakesUsed} of your 3 trial stocktakes.`;

  return `
<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;padding:32px;color:#1a1a2e">
    <h2 style="margin:0 0 12px;color:#0B132B;font-size:20px">
      Your Hosti trial is wrapping up
    </h2>
    <p style="margin:0 0 16px;line-height:1.6">
      Hi there — just a heads-up that your free trial for
      <strong>${escHtml(venueName)}</strong> is getting close to its limit.
      ${stocktakeNote}
    </p>
    <p style="margin:0 0 24px;line-height:1.6">
      The trial ends after 3 stocktakes or 30 days, whichever comes first.
      Finish your remaining stocktake now to make the most of it — your data,
      reports, and product history carry over when you subscribe.
    </p>
    <div style="margin:0 0 24px">
      <a href="https://hosti.co.nz"
         style="display:inline-block;background:#0B132B;color:#fff;padding:14px 28px;
                border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">
        Open Hosti
      </a>
    </div>
    <p style="margin:0;color:#888;font-size:13px;line-height:1.5">
      Questions? Just reply to this email — we're happy to help.
    </p>
  </div>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendReminderViaPostmark(
  apiKey: string,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  const resp = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "X-Postmark-Server-Token": apiKey,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      From: "Hosti <hello@hosti.co.nz>",
      To: to,
      Subject: subject,
      HtmlBody: html,
      // Dedicated stream — create "trial-reminders" in Postmark console before deploying.
      MessageStream: "trial-reminders",
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "(no body)");
    throw new Error(`Postmark error ${resp.status}: ${body}`);
  }
}

// ── Scheduled function ────────────────────────────────────────────────────────
// Runs daily at 9 AM UTC. For each venue with an active trial, checks whether
// the reminder condition is met (1 stocktake remaining OR within 8 days of the
// 30-day expiry) and fires a single nudge email if reminderSentAt is not set.
//
// Stream name: "trial-reminders"
// Create this stream in the Postmark console before deploying.
// Set POSTMARK_API_KEY via: firebase functions:secrets:set POSTMARK_API_KEY
export const trialReminderEmail = onSchedule(
  {
    schedule: "0 9 * * *",
    timeZone: "UTC",
    region: "australia-southeast1",
    memory: "256MiB",
    timeoutSeconds: 300,
    secrets: ["POSTMARK_API_KEY"],
  },
  async () => {
    const db = admin.firestore();
    const apiKey = process.env.POSTMARK_API_KEY;
    if (!apiKey) {
      console.error("[trialReminder] POSTMARK_API_KEY not configured — skipping run");
      return;
    }

    // Query venues where the denormalized trialStatus field is 'active'.
    // Written by VenueProvider.tsx's trial init transaction alongside trialState.
    let venuesSnap: admin.firestore.QuerySnapshot;
    try {
      venuesSnap = await db.collection("venues").where("trialStatus", "==", "active").get();
    } catch (e) {
      console.error("[trialReminder] failed to query trial venues:", e);
      return;
    }

    if (venuesSnap.empty) {
      console.log("[trialReminder] no active trial venues this run");
      return;
    }

    const now = Date.now();

    const results = await Promise.allSettled(
      venuesSnap.docs.map(async (venueDoc) => {
        const venueId = venueDoc.id;
        const venueData = venueDoc.data();

        const trialRef = db.doc(`venues/${venueId}/billing/trialState`);
        const trialSnap = await trialRef.get();
        if (!trialSnap.exists) return;

        const trial = trialSnap.data()!;
        if (trial.status !== "active") return;
        if (trial.reminderSentAt) return; // already sent

        const startMs: number = trial.startedAt?.toMillis?.() ?? 0;
        const stocktakesUsed: number = trial.stocktakesUsed ?? 0;

        const nearStocktakeLimit = stocktakesUsed === 2;
        const nearTimeLimit = now >= startMs + THIRTY_DAYS_MS - EIGHT_DAYS_MS;

        if (!nearStocktakeLimit && !nearTimeLimit) return;

        const ownerUid: string | undefined = venueData.ownerUid;
        if (!ownerUid) {
          console.warn(`[trialReminder] no ownerUid for venue=${venueId}`);
          return;
        }

        const email = await getOwnerEmail(db, ownerUid);
        if (!email) {
          console.warn(`[trialReminder] could not resolve email for ownerUid=${ownerUid} venue=${venueId}`);
          return;
        }

        const venueName: string = venueData.name || "your venue";
        const html = buildReminderHtml(venueName, stocktakesUsed);
        const subject = "Your Hosti trial is wrapping up — finish your stocktake";

        await sendReminderViaPostmark(apiKey, email, subject, html);

        // Stamp sent — prevents re-send on subsequent daily runs
        await trialRef.update({ reminderSentAt: admin.firestore.FieldValue.serverTimestamp() });

        console.log(`[trialReminder] sent to ${email} for venue=${venueId} stocktakesUsed=${stocktakesUsed}`);
      }),
    );

    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    if (failed.length > 0) {
      console.error(`[trialReminder] ${failed.length}/${results.length} venue(s) failed`);
      failed.forEach((f) => console.error("[trialReminder] error:", f.reason));
    }
  },
);
