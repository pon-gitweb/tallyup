import * as admin from 'firebase-admin';

// Keep in sync with src/screens/settings/AiUsageScreen.tsx PLAN_LIMITS

export type AiCallType =
  | 'invoice_ocr' | 'product_photo' | 'shelf_scan' | 'stocktake_photo'
  | 'sales_report' | 'izzy' | 'suitee' | 'ai_insights'
  | 'suggest_orders' | 'variance_explain' | 'budget_suggest' | 'photo_count'
  | 'prediction_refinement' | 'recipe_generation';

export interface MeterState {
  aiUsed: number;
  aiRemaining: number;
  aiLimit: number;
  resetAt: string;
  plan: 'beta' | 'core' | 'core_plus';
  usageWarning?: { feature: string; used: number; limit: number; percentUsed: number; message: string } | null;
}

export const PLAN_LIMITS: Record<string, Record<string, number>> = {
  beta: {
    total: 600, invoice_ocr: 300, product_photo: 75, shelf_scan: 15,
    stocktake_photo: 40, sales_report: 10, izzy: 150, suitee: 50,
    ai_insights: 12, suggest_orders: 20, variance_explain: 12,
    prediction_refinement: 10, recipe_generation: 50,
  },
  core: {
    total: 500, invoice_ocr: 300, product_photo: 30, shelf_scan: 10,
    stocktake_photo: 20, sales_report: 5, izzy: 100, suitee: 30,
    ai_insights: 8, suggest_orders: 15, variance_explain: 8,
    prediction_refinement: 5, recipe_generation: 10,
  },
  core_plus: {
    total: 800, invoice_ocr: 400, product_photo: 100, shelf_scan: 30,
    stocktake_photo: 60, sales_report: 15, izzy: 300, suitee: 100,
    ai_insights: 20, suggest_orders: 40, variance_explain: 20,
    prediction_refinement: 20, recipe_generation: 30,
  },
};

const FEATURE_LABELS: Record<string, string> = {
  invoice_ocr: 'invoice scanning', product_photo: 'product photos',
  shelf_scan: 'shelf scanning', stocktake_photo: 'stocktake import',
  sales_report: 'sales report import', izzy: 'Izzy questions',
  suitee: 'Suitee queries', ai_insights: 'AI insights',
  suggest_orders: 'order suggestions', variance_explain: 'variance explanations',
  prediction_refinement: 'AI prediction refinement',
  recipe_generation: 'recipe generation',
};

function buildLimitMessage(feature: string, used: number, limit: number, resetAt: string): string {
  const resetDate = new Date(resetAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });
  const msgs: Record<string, string> = {
    invoice_ocr: `You've scanned ${used} invoices this month — great work getting set up! Your scanning allowance resets on ${resetDate}. You can still add suppliers and products manually in the meantime.`,
    product_photo: `You've photographed ${used} products this month. Your photo allowance resets on ${resetDate}. You can still add products by searching or entering details manually.`,
    shelf_scan: `You've used your shelf scanning allowance for this month. Resets on ${resetDate}. Count products manually or use barcode scan.`,
    stocktake_photo: `You've imported ${used} stocktake pages this month. Resets on ${resetDate}. You can still run manual stocktakes.`,
    suitee: `Suitee has answered ${used} questions this month. Your allowance resets on ${resetDate}.`,
    izzy: `Izzy has helped with ${used} questions this month. Check our help docs at office@hosti.co.nz for common questions.`,
    ai_insights: `AI insights have run ${used} times this month. Resets on ${resetDate}.`,
    suggest_orders: `AI order suggestions have been used ${used} times this month. Resets on ${resetDate}.`,
    variance_explain: `Variance explanations have been used ${used} times this month. Resets on ${resetDate}.`,
  };
  const base = msgs[feature] || `You've reached your ${FEATURE_LABELS[feature] || feature} limit for this month. Resets on ${resetDate}.`;
  return base + '\n\nNeed more? Contact us at office@hosti.co.nz';
}

export async function resolveVenuePlan(db: admin.firestore.Firestore, venueId: string): Promise<{ plan: string; effectivePlan: string }> {
  let plan = 'beta';
  let venueCreatedAt: number | null = null;
  try {
    const snap = await db.doc(`venues/${venueId}`).get();
    const d = snap.data();
    plan = d?.billingPlan || 'beta';
    venueCreatedAt = d?.createdAt?.toMillis?.() ?? null;
  } catch {}
  // Grace period: new 'core' venues get beta limits for 14 days
  let effectivePlan = plan;
  if (plan === 'core' && venueCreatedAt) {
    if (Date.now() - venueCreatedAt < 14 * 24 * 60 * 60 * 1000) effectivePlan = 'beta';
  }
  return { plan, effectivePlan };
}

export async function trackAiCall(venueId: string, callType: AiCallType): Promise<MeterState> {
  const db = admin.firestore();
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const resetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

  const { plan, effectivePlan } = await resolveVenuePlan(db, venueId);
  const limits = PLAN_LIMITS[effectivePlan] ?? PLAN_LIMITS.beta;
  const totalLimit = limits.total ?? 600;
  const featureLimit = limits[callType] ?? totalLimit;
  const usageRef = db.doc(`venues/${venueId}/aiUsage/${monthKey}`);

  let aiUsed = 0;
  let featureUsedAfter = 0;
  let usageWarning: MeterState['usageWarning'] = null;
  try {
    const snap = await usageRef.get();
    const data = snap.data() || {};
    aiUsed = (data.totalCalls || 0) + 1;
    featureUsedAfter = (data.breakdown?.[callType] || 0) + 1;

    await usageRef.set({
      totalCalls: aiUsed,
      lastCallAt: admin.firestore.FieldValue.serverTimestamp(),
      resetAt,
      plan: effectivePlan,
      breakdown: { ...data.breakdown, [callType]: featureUsedAfter },
    }, { merge: true });

    // FIX 5: 80% warning
    const pct = Math.round((featureUsedAfter / featureLimit) * 100);
    if (pct >= 80 && pct < 100) {
      const label = FEATURE_LABELS[callType] || callType;
      const remaining = featureLimit - featureUsedAfter;
      usageWarning = {
        feature: callType,
        used: featureUsedAfter,
        limit: featureLimit,
        percentUsed: pct,
        message: `You've used ${pct}% of your monthly ${label} allowance (${featureUsedAfter} of ${featureLimit}). ${remaining} remaining this month.`,
      };
    }
  } catch (e) {
    console.log('[meter] tracking error', e);
    aiUsed = 1;
  }

  return {
    aiUsed,
    aiRemaining: Math.max(0, totalLimit - aiUsed),
    aiLimit: totalLimit,
    resetAt,
    plan: plan as MeterState['plan'],
    usageWarning,
  };
}

export async function checkAiLimit(venueId: string, callType: AiCallType): Promise<{ allowed: boolean; meter: MeterState; limitError?: any }> {
  const db = admin.firestore();
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const resetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

  const { plan, effectivePlan } = await resolveVenuePlan(db, venueId);
  const limits = PLAN_LIMITS[effectivePlan] ?? PLAN_LIMITS.beta;
  const totalLimit = limits.total ?? 600;
  const featureLimit = limits[callType] ?? totalLimit;

  let aiUsed = 0;
  let featureUsed = 0;
  try {
    const snap = await db.doc(`venues/${venueId}/aiUsage/${monthKey}`).get();
    const d = snap.data() || {};
    aiUsed = d.totalCalls || 0;
    featureUsed = d.breakdown?.[callType] || 0;
  } catch {}

  const baseMeter: MeterState = {
    aiUsed, aiRemaining: Math.max(0, totalLimit - aiUsed), aiLimit: totalLimit, resetAt, plan: plan as any,
  };

  if (aiUsed >= totalLimit) {
    const resetDate = new Date(resetAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long' });
    return {
      allowed: false, meter: { ...baseMeter, aiRemaining: 0 },
      limitError: {
        error: 'limit_reached', feature: 'total', used: aiUsed, limit: totalLimit, plan,
        resetsAt: resetAt, upgradeAvailable: plan !== 'core_plus',
        message: `You've used all ${totalLimit} AI calls for this month. Resets on ${resetDate}.\n\nNeed more? Contact us at office@hosti.co.nz`,
      },
    };
  }

  if (featureUsed >= featureLimit) {
    return {
      allowed: false, meter: baseMeter,
      limitError: {
        error: 'limit_reached', feature: callType, used: featureUsed, limit: featureLimit, plan,
        resetsAt: resetAt, upgradeAvailable: plan !== 'core_plus',
        message: buildLimitMessage(callType, featureUsed, featureLimit, resetAt),
      },
    };
  }

  return { allowed: true, meter: baseMeter };
}
