import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { createCheckout, addSubscriptionItem, openBillingPortal } from '../services/payments'
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
  const [multiVenueQty, setMultiVenueQty] = useState(1)
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Live venue doc. Three-way precedence, matching mobile VenueProvider:
  //   1. subscriptionOverride present → explicit entitlement (reviewer / pilot-with-override)
  //   2. subscription.status active/trialing → real paid subscription
  //   3. otherwise → implicit pilot (no subscription data at all, or lapsed/cancelled)
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
            })
          } else {
            // Cases 2 & 3: real subscription or implicit pilot
            const reallyActive = s?.status === 'active' || s?.status === 'trialing'
            setSub({
              plan: s?.plan ?? null,
              modules: Array.isArray(s?.modules) ? s.modules : [],
              status: s?.status ?? null,
              stripeCustomerId: s?.stripeCustomerId ?? null,
              isPilot: !s || !reallyActive,  // matches mobile line 385
            })
          }
        } else {
          setSub({ plan: null, modules: [], status: null, stripeCustomerId: null, isPilot: false })
        }
        setLoading(false)
      },
      () => setLoading(false),
    )
    return unsub
  }, [venueId])

  if (loading) return <p className={styles.loading}>Loading billing…</p>

  // ── Entitlement derivation ────────────────────────────────────────────────
  // isPilot short-circuits everything: full access, no subscribe buttons shown.
  const isPilot    = sub?.isPilot ?? false
  const isActive   = isPilot || sub?.status === 'active' || sub?.status === 'trialing'
  const coreActive = isPilot || (isActive && !!sub?.plan)
  const hasModule  = (id: string) => isPilot || (sub?.modules.includes(id) ?? false)
  const bundleActive =
    hasModule(MODULES.SUPPLIER_OPTIMISATION) &&
    hasModule(MODULES.OPS_INTELLIGENCE) &&
    hasModule(MODULES.PERFORMANCE_INCENTIVES)

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
  const mvQtyAbove3      = Math.max(0, multiVenueQty - 3)
  const mvMonthly        = 332.22 + mvQtyAbove3 * 20
  const mvAnnualEff      = 299.00 + mvQtyAbove3 * 18   // ~$18/mo per extra venue on annual

  const prices = {
    core:       cycle === 'monthly' ? '$221.11/mo' : '$199.00/mo',
    coreNote:   cycle === 'annual'  ? '$2,388.00/yr' : null,

    so:         cycle === 'monthly' ? '$87.78/mo' : '$79.00/mo',
    soNote:     cycle === 'annual'  ? '$948.00/yr' : null,

    oi:         cycle === 'monthly' ? '$76.67/mo' : '$69.00/mo',
    oiNote:     cycle === 'annual'  ? '$828.00/yr' : null,

    pi:         cycle === 'monthly' ? '$43.33/mo' : '$39.00/mo',
    piNote:     cycle === 'annual'  ? '$468.00/yr' : null,

    mv:         cycle === 'monthly' ? `$${mvMonthly.toFixed(2)}/mo` : `$${mvAnnualEff.toFixed(2)}/mo`,
    mvNote:     cycle === 'annual'  ? `$${(mvAnnualEff * 12).toFixed(2)}/yr` : null,

    bundle:     cycle === 'monthly' ? '$187.78/mo' : '$169.00/mo',
    bundleNote: cycle === 'annual'  ? '$2,028.00/yr' : null,
    bundleSave: cycle === 'annual'  ? 'Saves $18.00/mo vs. three modules separately' : null,
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
        </div>
        <div className={styles.heroRight}>
          <p className={styles.heroPrice}>{prices.core}</p>
          {prices.coreNote && <p className={styles.priceNote}>{prices.coreNote}</p>}
          {coreActive ? (
            <p className={styles.activeStatus}>✓ Active</p>
          ) : (
            <>
              <button
                type="button"
                className={styles.btn}
                onClick={() => handleCheckout('core', 'core')}
                disabled={!!busy}
              >
                {busy === 'core' ? 'Processing…' : 'Subscribe to Core'}
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
              <button
                type="button"
                className={styles.btn}
                onClick={() => handleAdd(MODULES.SUPPLIER_OPTIMISATION, 'supplier_optimisation')}
                disabled={!!busy}
              >
                {busy === MODULES.SUPPLIER_OPTIMISATION ? 'Processing…' : 'Add Module'}
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
              <button
                type="button"
                className={styles.btn}
                onClick={() => handleAdd(MODULES.OPS_INTELLIGENCE, 'ops_intelligence')}
                disabled={!!busy}
              >
                {busy === MODULES.OPS_INTELLIGENCE ? 'Processing…' : 'Add Module'}
              </button>
              {errors[MODULES.OPS_INTELLIGENCE] && (
                <p className={styles.cardError}>{errors[MODULES.OPS_INTELLIGENCE]}</p>
              )}
            </>
          )}
        </div>

        {/* Performance & Incentives */}
        <div className={styles.card}>
          <p className={styles.cardName}>Performance & Incentives</p>
          <p className={styles.cardDesc}>
            Staff leaderboards, gamified targets, and performance reward tracking — make stocktake accuracy something your team cares about.
          </p>
          <p className={styles.cardPrice}>{prices.pi}</p>
          {prices.piNote && <p className={styles.priceNote}>{prices.piNote}</p>}
          {hasModule(MODULES.PERFORMANCE_INCENTIVES) ? (
            <p className={styles.activeStatus}>✓ Active</p>
          ) : !coreActive ? (
            <button type="button" className={styles.btnGhost} disabled>Requires Core</button>
          ) : (
            <>
              <button
                type="button"
                className={styles.btn}
                onClick={() => handleAdd(MODULES.PERFORMANCE_INCENTIVES, 'performance_incentives')}
                disabled={!!busy}
              >
                {busy === MODULES.PERFORMANCE_INCENTIVES ? 'Processing…' : 'Add Module'}
              </button>
              {errors[MODULES.PERFORMANCE_INCENTIVES] && (
                <p className={styles.cardError}>{errors[MODULES.PERFORMANCE_INCENTIVES]}</p>
              )}
            </>
          )}
        </div>

      </div>

      {/* ── Multi-Venue ────────────────────────────────────────────────────── */}
      <div className={styles.wideCard}>
        <div className={styles.wideLeft}>
          <p className={styles.cardName}>Multi-Venue Command Centre</p>
          <p className={styles.cardDesc}>
            Consolidated dashboards, cross-venue reporting, and group management — run many venues as one.
          </p>
          <div className={styles.qtyRow}>
            <label className={styles.qtyLabel} htmlFor="mv-qty">Number of venues</label>
            <input
              id="mv-qty"
              type="number"
              min={1}
              value={multiVenueQty}
              onChange={(e) => setMultiVenueQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className={styles.qtyInput}
            />
          </div>
          {multiVenueQty > 3 && (
            <p className={styles.qtyNote}>
              Base (≤3 venues) + {multiVenueQty - 3} extra ×{' '}
              {cycle === 'monthly' ? '$20.00/mo' : '~$18.00/mo'}
            </p>
          )}
        </div>
        <div className={styles.wideRight}>
          <p className={styles.cardPrice}>{prices.mv}</p>
          {prices.mvNote && <p className={styles.priceNote}>{prices.mvNote}</p>}
          {hasModule(MODULES.MULTI_VENUE) ? (
            <p className={styles.activeStatus}>✓ Active</p>
          ) : !coreActive ? (
            <button type="button" className={styles.btnGhost} disabled>Requires Core</button>
          ) : (
            <>
              <button
                type="button"
                className={styles.btn}
                onClick={() => handleAdd(MODULES.MULTI_VENUE, 'multi_venue', multiVenueQty)}
                disabled={!!busy}
              >
                {busy === MODULES.MULTI_VENUE ? 'Processing…' : 'Add Multi-Venue'}
              </button>
              {errors[MODULES.MULTI_VENUE] && (
                <p className={styles.cardError}>{errors[MODULES.MULTI_VENUE]}</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Pro Ops Bundle ─────────────────────────────────────────────────── */}
      <div className={styles.bundleCard}>
        <div className={styles.wideLeft}>
          <p className={styles.bundleTag}>Bundle</p>
          <p className={styles.cardName}>Pro Ops Bundle</p>
          <p className={styles.cardDesc}>
            Supplier Optimisation, Ops Intelligence, and Performance & Incentives — the complete operational upgrade, bundled together.
          </p>
          {prices.bundleSave && <p className={styles.bundleSaving}>{prices.bundleSave}</p>}
        </div>
        <div className={styles.wideRight}>
          <p className={styles.cardPrice}>{prices.bundle}</p>
          {prices.bundleNote && <p className={styles.priceNote}>{prices.bundleNote}</p>}
          {bundleActive ? (
            <p className={styles.activeStatus}>✓ Active</p>
          ) : !coreActive ? (
            <button type="button" className={styles.btnGhost} disabled>Requires Core</button>
          ) : (
            <>
              <button
                type="button"
                className={styles.btn}
                onClick={() => handleAdd('pro_ops_bundle', 'pro_ops_bundle')}
                disabled={!!busy}
              >
                {busy === 'pro_ops_bundle' ? 'Processing…' : 'Add Bundle'}
              </button>
              {errors.pro_ops_bundle && (
                <p className={styles.cardError}>{errors.pro_ops_bundle}</p>
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
