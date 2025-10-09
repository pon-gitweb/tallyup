import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { getApps, initializeApp } from "firebase-admin/app";

// Ensure Admin is initialized (for future use, even if not needed now)
if (!getApps().length) initializeApp();

// Global defaults for this codebase (Gen 2 only)
setGlobalOptions({
  region: "australia-southeast1",
  timeoutSeconds: 30,
  memory: "512MiB",
});

const VERSION = "aiVarianceExplain-v2-2025-10-09";

// Gen 2 HTTPS function with Secret Manager binding
export const aiVarianceExplain = onRequest(
  { secrets: ["OPENAI_API_KEY"] },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
    res.set("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.set("X-AI-Explain-Version", VERSION);

    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed", version: VERSION }); return; }

    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("Missing OPENAI_API_KEY secret");

      const body = req.body || {};
      const {
        itemName,
        varianceQty,
        varianceValue,
        par,
        lastCountQty,
        theoreticalOnHand,
        departmentId,
        recentSoldQty,
        recentReceivedQty,
        lastDeliveryAt,
        context,
      } = body;

      const prompt = `
You are an inventory auditor for a hospitality venue. Explain a variance clearly and practically.

Item: ${itemName ?? "unknown"}
Department: ${departmentId ?? context?.departmentId ?? "unknown"}
Variance (qty): ${varianceQty ?? "unknown"}
Variance (value): ${typeof varianceValue === "number" ? varianceValue : "unknown"}
Par: ${par ?? "unknown"}
Last count qty: ${lastCountQty ?? "unknown"}
Theoretical on hand: ${theoreticalOnHand ?? "unknown"}

Recent received qty (latest window): ${recentReceivedQty ?? context?.recentReceivedQty ?? "unknown"}
Recent sold qty (latest window): ${recentSoldQty ?? context?.recentSoldQty ?? "unknown"}
Last delivery date: ${lastDeliveryAt ?? context?.lastDeliveryAt ?? "unknown"}

Rules:
- Provide a 2–3 sentence summary first.
- Then list 2–4 likely factors (bullets).
- If context is thin, say what's missing to improve confidence.
- Be specific to hospitality stock (weekend spikes, unposted invoices, transfers, wastage).
`;

      // Node 20+ has global fetch in Gen 2 - no need for node-fetch
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.3,
          max_tokens: 250,
          messages: [
            { role: "system", content: "You are a precise, practical assistant for stock control." },
            { role: "user", content: prompt },
          ],
        }),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`OpenAI API error ${resp.status}: ${text}`);
      }

      const json = await resp.json();
      const content: string = json?.choices?.[0]?.message?.content || "No explanation generated.";

      const lines = content.split(/\n+/);
      const summary = lines.slice(0, 3).join(" ").trim();
      const factors = lines
        .filter((l: string) => /^\s*[-•]/.test(l))
        .map((l: string) => l.replace(/^\s*[-•]\s?/, "").trim())
        .slice(0, 6);

      res.json({
        ok: true,
        version: VERSION,
        summary,
        factors,
        confidence: "medium",
        missing: [
          ...(recentReceivedQty == null && !context?.recentReceivedQty ? ["recent delivery quantities"] : []),
          ...(recentSoldQty == null && !context?.recentSoldQty ? ["recent sales quantities"] : []),
          ...(lastDeliveryAt == null && !context?.lastDeliveryAt ? ["last delivery date"] : []),
        ],
      });
    } catch (e: any) {
      console.error("[aiVarianceExplain] error:", e?.message || e);
      res.status(500).json({
        ok: false,
        version: VERSION,
        summary:
          "Service error (500). Add recent delivery date, sales window, and audit entries for stronger insights.",
        confidence: "unknown",
        factors: [],
        missing: ["recent delivery dates", "sales window data", "audit entries"],
      });
    }
  }
);
