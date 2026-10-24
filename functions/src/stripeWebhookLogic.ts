// Pure webhook logic — no Firebase or Stripe imports.
// commitWebhookTransaction accepts a generic db-like object so tests can inject a fake.

// ── mapSubscriptionToVenueState ───────────────────────────────────────────────

export interface VenueSubscriptionState {
  status: string;
  plan: string | null;
  modules: string[];
  quantity: number;
  currentPeriodEnd: string | null;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripeSyncedAt: number;
}

export function mapSubscriptionToVenueState(sub: any, syncedAtMs: number): VenueSubscriptionState {
  const statusRaw: string = sub.status ?? "unknown";
  const status = statusRaw === "canceled" ? "cancelled" : statusRaw;

  const items: any[] = sub.items?.data ?? [];
  // planItem: first item whose price.metadata.plan is set, else items[0]
  const planItem = items.find((it: any) => it.price?.metadata?.plan) ?? items[0] ?? null;

  const plan: string | null = status === "cancelled"
    ? null
    : (planItem?.price?.metadata?.plan || "core");

  // Split comma-separated module metadata across ALL items, trim, de-duplicate; [] when cancelled
  const modules: string[] = status === "cancelled" ? [] : Array.from(new Set(
    items
      .flatMap((item: any) => (item.price?.metadata?.module ?? "").split(","))
      .map((m: string) => m.trim())
      .filter(Boolean),
  ));

  const quantity: number = planItem?.quantity ?? 1;

  const currentPeriodEnd: string | null =
    typeof planItem?.current_period_end === "number"
      ? new Date(planItem.current_period_end * 1000).toISOString()
      : null;

  const stripeCustomerId: string =
    typeof sub.customer === "string" ? sub.customer : (sub.customer?.id ?? "");
  const stripeSubscriptionId: string = sub.id ?? "";

  return {
    status,
    plan,
    modules,
    quantity,
    currentPeriodEnd,
    stripeCustomerId,
    stripeSubscriptionId,
    stripeSyncedAt: syncedAtMs,
  };
}

// ── resolveVenueTarget ────────────────────────────────────────────────────────

export type VenueTargetResult =
  | { venueId: string }
  | { retry: string }
  | { ambiguous: string[] };

export function resolveVenueTarget(sub: any, venueIdsForCustomer: string[]): VenueTargetResult {
  const metaVenueId: string | undefined = sub.metadata?.venueId;
  if (metaVenueId) return { venueId: metaVenueId };
  if (venueIdsForCustomer.length === 1) return { venueId: venueIdsForCustomer[0] };
  if (venueIdsForCustomer.length === 0) return { retry: "no venue found for customer" };
  return { ambiguous: venueIdsForCustomer };
}

// ── invoiceSubscriptionId ─────────────────────────────────────────────────────

export function invoiceSubscriptionId(invoice: any): string | null {
  if (typeof invoice.subscription === "string") return invoice.subscription;
  if (invoice.subscription?.id) return invoice.subscription.id as string;
  const s = invoice.parent?.subscription_details?.subscription;
  if (!s) return null;
  return typeof s === "string" ? s : (s?.id ?? null);
}

// ── Stale guards ──────────────────────────────────────────────────────────────

export function isStale(storedSyncedAt: number | undefined, incomingSyncedAt: number): boolean {
  if (storedSyncedAt == null) return false;
  return incomingSyncedAt < storedSyncedAt;
}

export function isOlderPaymentEvent(
  storedEventCreated: number | undefined,
  incomingCreated: number,
): boolean {
  if (storedEventCreated == null) return false;
  return incomingCreated <= storedEventCreated;
}

// ── shouldRetryUnlinked ───────────────────────────────────────────────────────
// Returns true only while we're still inside the short race window where a
// subscription/invoice event may arrive before checkout.session.completed has
// linked the venue.  Beyond the window the customer is truly orphaned and
// Stripe should not keep retrying (to avoid endpoint suspension).

export function shouldRetryUnlinked(
  eventCreatedSec: number,
  nowMs: number,
  windowMs = 60 * 60 * 1000,
): boolean {
  return nowMs - eventCreatedSec * 1000 < windowMs;
}

// ── commitWebhookTransaction ──────────────────────────────────────────────────
// Wraps ALL Firestore writes for one Stripe event in a single transaction.
// Idempotent: if stripeEvents/{eventId} already exists, skips all writes.
// writeFn must perform only tx reads/writes; all Stripe API calls happen before this.

export async function commitWebhookTransaction(
  db: any,
  eventId: string,
  eventType: string,
  venueId: string | undefined,
  writeFn: (tx: any) => void | Promise<void>,
  nowMs: number,
): Promise<"duplicate" | "written"> {
  let result: "duplicate" | "written" = "written";

  await db.runTransaction(async (tx: any) => {
    const eventRef = db.doc(`stripeEvents/${eventId}`);
    const eventDoc = await tx.get(eventRef);
    if (eventDoc.exists) {
      result = "duplicate";
      return;
    }
    await writeFn(tx);
    tx.set(eventRef, {
      type: eventType,
      venueId: venueId ?? null,
      processedAt: new Date(nowMs),
      expireAt: new Date(nowMs + 90 * 24 * 60 * 60 * 1000),
    });
  });

  return result;
}
