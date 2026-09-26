import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { createCheckout, addSubscriptionItem, openBillingPortal, createOneOffCheckout } from '../services/payments'
import { MODULES } from '../services/billing/modules'
import styles from './BillingPage.module.css'

// Confirmed from firebase.json: hosting.public = "web", rewrites /app/** → /app/index.html.
// Firebase project tallyup-f1463 (.firebaserc). Default Hosting domain = tallyup-f1463.web.app.
// App lives under /app/ per the rewrite, so return paths must include that prefix.
const SUCCESS_URL = 'https://tallyup-f1463.web.app/app/billing-success'
const CANCEL_URL  = 'https://tallyup-f1463.web.app/app/billing-cancel'

type BillingCycle = 'monthly' | 'annual'

type SubState = {
  plan: string | null
  modules: string[]
  status: string | null           // 'active' | 'trialing' | other
  stripeCustomerId: string | null
  isPilot: boolean                // mirrors mobile: !subscription || status not active/trialing
  legacyFreeAccess: boolean       // permanent full access for grandfathered venues; Console-only flag
}

/** Build a Stripe lookup key from a base string and billing cycle. */
function lk(base: string, cycle: BillingCycle): string {
  return cycle === 'monthly' ? `${base}_monthly_rolling` : `${base}_annual`
}

export default function BillingPage({
  venueId,
  user: _user,
  billingReturnStatus,
  onClearStatus,
}: {
  venueId: string
  user: User
  billingReturnStatus: 'success' | 'cancel' | null
  onClearStatus: () => void
}) {
  const [sub, setSub] = useState<SubState | null>(null)
  const [loading, setLoading] = useState(true)
  const [cycle, setCycle] = useState<BillingCycle>('monthly')
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Live venue doc. Three-way precedence, matching mobile VenueProvider:
  //   1. subscriptionOverride present → explicit entitlement (reviewer / pilot-with-override)
  //   2. legacyFreeAccess true → permanent full access for grandfathered pilot venues (Console-only flag)
  //   3. subscription.status active/trialing → real paid subscription
  //   4. otherwise → implicit pilot (no subscription data at all, or lapsed/cancelled)
  //      mobile: isPilot = !subscription || !['active','trialing'].includes(subscription.status)
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'venues', venueId),
      (snap) => {
        if (snap.exists()) {
          const d = snap.data() as any
          const override = d?.subscriptionOverride
          const s = d?.subscription
          if (override) {
            // Case 1: explicit entitlement override (reviewer / seeded pilot account)
            setSub({
              plan: override.plan ?? null,
              modules: Array.isArray(override.modules) ? override.modules : [],
              status: 'active',
              stripeCustomerId: s?.stripeCustomerId ?? null,
              isPilot: false,
              legacyFreeAccess: false,
            })
          } else if (d?.legacyFreeAccess === true) {
            // Case 2: grandfathered pilot venue — permanent full access.
            // Flag is set via Firebase Console only; never client-writable (protected by
            // omission from the venue hasOnlyFields allowlist in firestore.rules).
            // Independent branch so this survives any future restructure of the isPilot formula.
            setSub({
              plan: 'core_plus',
              modules: [],        // legacyFreeAccess drives hasModule directly; modules list unused
              status: 'active',
              stripeCustomerId: s?.stripeCustomerId ?? null,
              isPilot: false,
              legacyFreeAccess: true,
            })
          } else {
            // Cases 3 & 4: real subscription or implicit pilot
            const reallyActive = s?.status === 'active' || s?.status === 'trialing'
            setSub({
              plan: s?.plan ?? null,
              modules: Array.isArray(s?.modules) ? s.modules : [],
              status: s?.status ?? null,
              stripeCustomerId: s?.stripeCustomerId ?? null,
              isPilot: !s || !reallyActive,  // matches mobile line 385
              legacyFreeAccess: false,
            })
          }
        } else {
          setSub({ plan: null, modules: [], status: null, stripeCustomerId: null, isPilot: false, legacyFreeAccess: false })
        }
        setLoading(false)
      },
      () => setLoading(false),
    )
    return unsub
  }, [venueId])

  if (loading) return <p className={styles.loading}>Loading billing…</p>

  // ── Entitlement derivation ────────────────────────────────────────────────
  // legacyFreeAccess and isPilot both short-circuit everything: full access, no subscribe buttons.
  const legacyFreeAccess = sub?.legacyFreeAccess ?? false
  const isPilot    = sub?.isPilot ?? false
  const isActive   = legacyFreeAccess || isPilot || sub?.status === 'active' || sub?.status === 'trialing'
  const coreActive = legacyFreeAccess || isPilot || (isActive && !!sub?.plan)
  const hasModule  = (id: string) => legacyFreeAccess || isPilot || (sub?.modules.includes(id) ?? false)

  // SO + Ops combo: active when both constituent modules are included (P&I is now free in Core)
  const comboActive =
    hasModule(MODULES.SUPPLIER_OPTIMISATION) &&
    hasModule(MODULES.OPS_INTELLIGENCE)

  // ── Helpers ───────────────────────────────────────────────────────────────
  function clearError(key: string) {
    setErrors((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  async function handleCheckout(cardKey: string, lookupKeyBase: string) {
    if (busy) return
    clearError(cardKey)
    setBusy(cardKey)
    try {
      const result = await createCheckout({
        venueId,
        lookupKey: lk(lookupKeyBase, cycle),
        successUrl: SUCCESS_URL,
        cancelUrl: CANCEL_URL,
      })
      window.location.href = result.url
    } catch (e: any) {
      setErrors((prev) => ({ ...prev, [cardKey]: e?.message ?? 'Something went wrong. Please try again.' }))
      setBusy(null)
    }
    // No setBusy(null) on success — we're navigating away
  }

  async function handleAdd(cardKey: string, lookupKeyBase: string, quantity?: number) {
    if (busy) return
    clearError(cardKey)
    setBusy(cardKey)
    try {
      await addSubscriptionItem({ venueId, lookupKey: lk(lookupKeyBase, cycle), quantity })
      // onSnapshot fires automatically when the subscription webhook updates the venue doc
    } catch (e: any) {
      setErrors((prev) => ({ ...prev, [cardKey]: e?.message ?? 'Something went wrong. Please try again.' }))
    }
    setBusy(null)
  }

  async function handleOneOffCheckout(cardKey: string, lookupKey: string) {
    if (busy) return
    clearError(cardKey)
    setBusy(cardKey)
    try {
      const result = await createOneOffCheckout({
        venueId,
        lookupKey,
        successUrl: SUCCESS_URL,
        cancelUrl: CANCEL_URL,
      })
      window.location.href = result.url
    } catch (e: any) {
      setErrors((prev) => ({ ...prev, [cardKey]: e?.message ?? 'Something went wrong. Please try again.' }))
      setBusy(null)
    }
    // No setBusy(null) on success — we're navigating away
  }

  async function handlePortal() {
    if (busy) return
    clearError('portal')
    setBusy('portal')
    try {
      const result = await openBillingPortal({ venueId, returnUrl: SUCCESS_URL })
      window.location.href = result.url
    } catch (e: any) {
      setErrors((prev) => ({ ...prev, portal: e?.message ?? 'Could not open billing portal. Please try again.' }))
      setBusy(null)
    }
  }

  // ── Pricing display ───────────────────────────────────────────────────────
  const prices = {
    core:       cycle === 'monthly' ? '$149.00/mo excl. GST' : '$134.00/mo excl. GST',
    coreNote:   cycle === 'annual'  ? '$1,608.00/yr excl. GST' : null,

    so:         cycle === 'monthly' ? '$59.00/mo excl. GST' : '$53.00/mo excl. GST',
    soNote:     cycle === 'annual'  ? '$637.00/yr excl. GST' : null,

    oi:         cycle === 'monthly' ? '$49.00/mo excl. GST' : '$44.00/mo excl. GST',
    oiNote:     cycle === 'annual'  ? '$529.00/yr excl. GST' : null,

    combo:      cycle === 'monthly' ? '$89.00/mo excl. GST' : '$80.00/mo excl. GST',
    comboNote:  cycle === 'annual'  ? '$961.00/yr excl. GST' : null,
    comboSave:  cycle === 'annual'  ? 'Saves $205.00/yr vs. modules separately' : 'Saves $19.00/mo vs. modules separately',

    liveSales:     cycle === 'monthly' ? '$70.00/mo excl. GST' : '$63.00/mo excl. GST',
    liveSalesNote: cycle === 'annual'  ? '$756.00/yr excl. GST' : null,
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Plans & Billing</h1>
      <p className={styles.subhead}>Choose the plan that fits your operation.</p>

      {/* Return status banners */}
      {billingReturnStatus === 'success' && (
        <div className={`${styles.banner} ${styles.bannerSuccess}`}>
          <span>✓ Your subscription has been updated.</span>
          <button type="button" className={styles.bannerDismiss} onClick={onClearStatus} aria-label="Dismiss">✕</button>
        </div>
      )}
      {billingReturnStatus === 'cancel' && (
        <div className={`${styles.banner} ${styles.bannerCancel}`}>
          <span>Checkout was cancelled — no changes have been made.</span>
          <button type="button" className={styles.bannerDismiss} onClick={onClearStatus} aria-label="Dismiss">✕</button>
        </div>
      )}

      {/* Billing cycle toggle */}
      <div className={styles.toggleRow}>
        <button
          type="button"
          className={`${styles.toggleBtn} ${cycle === 'monthly' ? styles.toggleActive : ''}`}
          onClick={() => setCycle('monthly')}
        >
          Monthly
        </button>
        <button
          type="button"
          className={`${styles.toggleBtn} ${cycle === 'annual' ? styles.toggleActive : ''}`}
          onClick={() => setCycle('annual')}
        >
          Annual <span className={styles.savingsPill}>~10% off</span>
        </button>
      </div>

      {/* ── Core hero ──────────────────────────────────────────────────────── */}
      <div className={styles.heroCard}>
        <div className={styles.heroLeft}>
          <p className={styles.heroName}>Core Platform</p>
          <p className={styles.heroDesc}>
            Stocktake, ordering, receiving, and reporting — the complete operational backbone for any venue.
          </p>
          <p className={styles.heroIncluded}>✓ Performance &amp; Incentives included free</p>
        </div>
        <div className={styles.heroRight}>
          <p className={styles.heroPrice}>{prices.core}</p>
          {prices.coreNote && <p className={styles.priceNote}>{prices.coreNote}</p>}
          {coreActive ? (
            <p className={styles.activeStatus}>✓ Active</p>
          ) : (
            <>
              <button type="button" className={styles.btnGhost} disabled>
                Updated plans — checkout reopening shortly
              </button>
              {errors.core && <p className={styles.cardError}>{errors.core}</p>}
            </>
          )}
        </div>
      </div>

      {/* ── Module cards ───────────────────────────────────────────────────── */}
      <div className={styles.cardsGrid}>

        {/* Supplier Optimisation */}
        <div className={styles.card}>
          <p className={styles.cardName}>Supplier Optimisation</p>
          <p className={styles.cardDesc}>
            AI-driven order suggestions and supplier performance tracking to keep stock lean and supplier relationships sharper.
          </p>
          <p className={styles.cardPrice}>{prices.so}</p>
          {prices.soNote && <p className={styles.priceNote}>{prices.soNote}</p>}
          {hasModule(MODULES.SUPPLIER_OPTIMISATION) ? (
            <p className={styles.activeStatus}>✓ Active</p>
          ) : !coreActive ? (
            <button type="button" className={styles.btnGhost} disabled>Requires Core</button>
          ) : (
            <>
              <button type="button" className={styles.btnGhost} disabled>
                Updated plans — checkout reopening shortly
              </button>
              {errors[MODULES.SUPPLIER_OPTIMISATION] && (
                <p className={styles.cardError}>{errors[MODULES.SUPPLIER_OPTIMISATION]}</p>
              )}
            </>
          )}
        </div>

        {/* Ops Intelligence */}
        <div className={styles.card}>
          <p className={styles.cardName}>Ops Intelligence</p>
          <p className={styles.cardDesc}>
            Hosti Health scores, KPI dashboards, and operational insights — a single source of truth for what's working and what isn't.
          </p>
          <p className={styles.cardPrice}>{prices.oi}</p>
          {prices.oiNote && <p className={styles.priceNote}>{prices.oiNote}</p>}
          {hasModule(MODULES.OPS_INTELLIGENCE) ? (
            <p className={styles.activeStatus}>✓ Active</p>
          ) : !coreActive ? (
            <button type="button" className={styles.btnGhost} disabled>Requires Core</button>
          ) : (
            <>
              <button type="button" className={styles.btnGhost} disabled>
                Updated plans — checkout reopening shortly
              </button>
              {errors[MODULES.OPS_INTELLIGENCE] && (
                <p className={styles.cardError}>{errors[MODULES.OPS_INTELLIGENCE]}</p>
              )}
            </>
          )}
        </div>

        {/* Live Sales — coming soon */}
        <div className={`${styles.card} ${styles.comingSoonCard}`}>
          <div className={styles.comingSoonBadge}>Coming soon</div>
          <p className={styles.cardName}>Live Sales</p>
          <p className={styles.cardDesc}>
            Real-time sales data from your POS — automatic recipe matching, live COGS, and instant variance detection as sales happen.
          </p>
          <p className={styles.cardPrice}>{prices.liveSales}</p>
          {prices.liveSalesNote && <p className={styles.priceNote}>{prices.liveSalesNote}</p>}
          <button type="button" className={styles.btnGhost} disabled>
            Requires a live POS connection — not yet available
          </button>
        </div>

        {/* AI Meter Extension — one-off top-up, no subscription, no plan gate */}
        <div className={styles.card}>
          <p className={styles.cardName}>AI Meter Extension</p>
          <p className={styles.cardDesc}>
            Topped out on AI calls this month? Buy a one-off extension — doubles your plan's monthly AI call limit for the rest of this calendar month, then resets automatically.
          </p>
          <p className={styles.cardPrice}>$40.00 one-off excl. GST</p>
          <>
            <button type="button" className={styles.btnGhost} disabled>
              Updated plans — checkout reopening shortly
            </button>
            {errors.ai_meter_extension && (
              <p className={styles.cardError}>{errors.ai_meter_extension}</p>
            )}
          </>
        </div>

      </div>

      {/* ── SO + Ops Combo ─────────────────────────────────────────────────── */}
      <div className={styles.bundleCard}>
        <div className={styles.wideLeft}>
          <p className={styles.bundleTag}>Best value</p>
          <p className={styles.cardName}>SO + Ops Combo</p>
          <p className={styles.cardDesc}>
            Supplier Optimisation and Ops Intelligence together — smarter ordering and clearer performance insights, at a better price than buying separately.
          </p>
          <p className={styles.bundleSaving}>{prices.comboSave}</p>
        </div>
        <div className={styles.wideRight}>
          <p className={styles.cardPrice}>{prices.combo}</p>
          {prices.comboNote && <p className={styles.priceNote}>{prices.comboNote}</p>}
          {comboActive ? (
            <p className={styles.activeStatus}>✓ Active</p>
          ) : !coreActive ? (
            <button type="button" className={styles.btnGhost} disabled>Requires Core</button>
          ) : (
            <>
              <button type="button" className={styles.btnGhost} disabled>
                Updated plans — checkout reopening shortly
              </button>
              {errors.so_ops_combo && (
                <p className={styles.cardError}>{errors.so_ops_combo}</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div className={styles.footer}>
        <button
          type="button"
          className={styles.portalLink}
          onClick={handlePortal}
          disabled={!!busy}
        >
          {busy === 'portal' ? 'Opening portal…' : 'Manage or cancel anytime →'}
        </button>
        {errors.portal && <p className={styles.cardError}>{errors.portal}</p>}
        <p className={styles.footerNote}>Additional AI capacity is available for high-usage venues.</p>
      </div>
    </div>
  )
}
