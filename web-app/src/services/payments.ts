// Web-app Stripe billing service.
// Calls Cloud Functions API — do NOT call Stripe directly from the client.
// All three functions require an authenticated user; they will throw if
// auth.currentUser is null when called.
import { auth } from '../firebase'

const API = 'https://us-central1-tallyup-f1463.cloudfunctions.net/api'

async function getToken(): Promise<string> {
  const token = await auth.currentUser?.getIdToken()
  if (!token) throw new Error('Not authenticated')
  return token
}

/** POST /stripe/create-checkout-session
 *  Opens a Stripe Checkout flow for a new subscription line item.
 *  Pass lookupKey only — never raw price_... IDs.
 *  Returns the Stripe-hosted checkout URL; caller should redirect to it.
 */
export async function createCheckout(params: {
  venueId: string
  lookupKey: string
  successUrl: string
  cancelUrl: string
  quantity?: number
}): Promise<{ sessionId: string; url: string }> {
  const token = await getToken()
  const res = await fetch(`${API}/stripe/create-checkout-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  })
  const data = await res.json()
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? 'Checkout session creation failed')
  }
  return { sessionId: data.sessionId, url: data.url }
}

/** POST /stripe/add-subscription-item
 *  Adds a module to an existing active subscription, or updates its quantity.
 *  Requires Core to be active first (enforced server-side).
 *  Pass lookupKey only — never raw price_... IDs.
 */
export async function addSubscriptionItem(params: {
  venueId: string
  lookupKey: string
  quantity?: number
}): Promise<{ subscriptionId: string }> {
  const token = await getToken()
  const res = await fetch(`${API}/stripe/add-subscription-item`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  })
  const data = await res.json()
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? 'Failed to add subscription item')
  }
  return { subscriptionId: data.subscriptionId }
}

/** POST /stripe/create-one-off-checkout-session
 *  Opens a Stripe Checkout flow for a one-off (non-subscription) purchase.
 *  Pass lookupKey — never raw price_... IDs.
 *  Returns the Stripe-hosted checkout URL; caller should redirect to it.
 */
export async function createOneOffCheckout(params: {
  venueId: string
  lookupKey: string
  successUrl: string
  cancelUrl: string
}): Promise<{ sessionId: string; url: string }> {
  const token = await getToken()
  const res = await fetch(`${API}/stripe/create-one-off-checkout-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  })
  const data = await res.json()
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? 'Checkout session creation failed')
  }
  return { sessionId: data.sessionId, url: data.url }
}

/** GET /stripe/portal
 *  Creates a Stripe Billing Portal session for the venue's Stripe customer.
 *  Returns the portal URL; caller should redirect to it.
 */
export async function openBillingPortal(params: {
  venueId: string
  returnUrl?: string
}): Promise<{ url: string }> {
  const token = await getToken()
  const qs = new URLSearchParams({ venueId: params.venueId })
  if (params.returnUrl) qs.set('returnUrl', params.returnUrl)
  const res = await fetch(`${API}/stripe/portal?${qs.toString()}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
  const data = await res.json()
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? 'Portal session creation failed')
  }
  return { url: data.url }
}
