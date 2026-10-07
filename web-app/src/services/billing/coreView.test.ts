import { describe, it, expect } from 'vitest'
import { deriveCoreView, moduleActive } from './coreView'
import type { CoreViewInput, CoreViewResult } from './coreView'

function row(overrides: Partial<CoreViewInput> = {}): CoreViewInput {
  return {
    override: undefined,
    legacyFreeAccess: false,
    venueType: 'bar',
    subscriptionStatus: null,
    subscriptionPlan: null,
    trialPath: false,
    isOwner: true,
    ...overrides,
  }
}

describe('deriveCoreView', () => {
  it('override present → included, not pilot, coreActive', () => {
    expect(deriveCoreView(row({ override: { plan: 'core_plus' } }))).toEqual<CoreViewResult>({
      coreState: 'included', isPilot: false, coreActive: true,
    })
  })

  it('legacyFreeAccess → included, not pilot, coreActive', () => {
    expect(deriveCoreView(row({ legacyFreeAccess: true }))).toEqual<CoreViewResult>({
      coreState: 'included', isPilot: false, coreActive: true,
    })
  })

  it('active subscription with plan → active, not pilot, coreActive', () => {
    expect(deriveCoreView(row({ subscriptionStatus: 'active', subscriptionPlan: 'core' }))).toEqual<CoreViewResult>({
      coreState: 'active', isPilot: false, coreActive: true,
    })
  })

  it('trialing subscription with plan → active, not pilot, coreActive', () => {
    expect(deriveCoreView(row({ subscriptionStatus: 'trialing', subscriptionPlan: 'core' }))).toEqual<CoreViewResult>({
      coreState: 'active', isPilot: false, coreActive: true,
    })
  })

  it('festival venueType → included, isPilot, coreActive', () => {
    expect(deriveCoreView(row({ venueType: 'festival' }))).toEqual<CoreViewResult>({
      coreState: 'included', isPilot: true, coreActive: true,
    })
  })

  it('trialPath + owner → buy, not pilot, not coreActive', () => {
    expect(deriveCoreView(row({ trialPath: true, isOwner: true }))).toEqual<CoreViewResult>({
      coreState: 'buy', isPilot: false, coreActive: false,
    })
  })

  it('trialPath + non-owner → owner_only, not pilot, not coreActive', () => {
    expect(deriveCoreView(row({ trialPath: true, isOwner: false }))).toEqual<CoreViewResult>({
      coreState: 'owner_only', isPilot: false, coreActive: false,
    })
  })

  it('no trialPath, no subscription, no override → included (pilot), coreActive', () => {
    expect(deriveCoreView(row())).toEqual<CoreViewResult>({
      coreState: 'included', isPilot: true, coreActive: true,
    })
  })

  it('canceled subscription on trial-path venue (owner) → buy', () => {
    expect(deriveCoreView(row({
      subscriptionStatus: 'canceled',
      subscriptionPlan: 'core',
      trialPath: true,
      isOwner: true,
    }))).toEqual<CoreViewResult>({
      coreState: 'buy', isPilot: false, coreActive: false,
    })
  })

  it('trial-path venue that is also festival → included (festival wins)', () => {
    expect(deriveCoreView(row({ venueType: 'festival', trialPath: true, isOwner: true }))).toEqual<CoreViewResult>({
      coreState: 'included', isPilot: true, coreActive: true,
    })
  })

  it('active subscription with no plan → falls through to pilot (included)', () => {
    expect(deriveCoreView(row({ subscriptionStatus: 'active', subscriptionPlan: null }))).toEqual<CoreViewResult>({
      coreState: 'included', isPilot: true, coreActive: true,
    })
  })

  it('override beats legacyFreeAccess (both present)', () => {
    expect(deriveCoreView(row({ override: { plan: 'core_plus' }, legacyFreeAccess: true }))).toEqual<CoreViewResult>({
      coreState: 'included', isPilot: false, coreActive: true,
    })
  })

  it('legacyFreeAccess beats festival (checked before venueType)', () => {
    expect(deriveCoreView(row({ legacyFreeAccess: true, venueType: 'festival' }))).toEqual<CoreViewResult>({
      coreState: 'included', isPilot: false, coreActive: true,
    })
  })
})

// ── moduleActive ──────────────────────────────────────────────────────────────

describe('moduleActive', () => {
  it('legacyFreeAccess true → any module id is true', () => {
    expect(moduleActive({ legacyFreeAccess: true, isPilot: false, modules: [], id: 'supplier_optimisation' })).toBe(true)
    expect(moduleActive({ legacyFreeAccess: true, isPilot: false, modules: [], id: 'ops_intelligence' })).toBe(true)
  })

  it('isPilot true → any module id is true', () => {
    expect(moduleActive({ legacyFreeAccess: false, isPilot: true, modules: [], id: 'supplier_optimisation' })).toBe(true)
    expect(moduleActive({ legacyFreeAccess: false, isPilot: true, modules: [], id: 'ops_intelligence' })).toBe(true)
  })

  it('override venue with modules ["ops_intelligence"] → only ops_intelligence true', () => {
    const m = (id: string) => moduleActive({ legacyFreeAccess: false, isPilot: false, modules: ['ops_intelligence'], id })
    expect(m('ops_intelligence')).toBe(true)
    expect(m('supplier_optimisation')).toBe(false)
  })

  it('active subscription with ["supplier_optimisation"] → only that one true', () => {
    const m = (id: string) => moduleActive({ legacyFreeAccess: false, isPilot: false, modules: ['supplier_optimisation'], id })
    expect(m('supplier_optimisation')).toBe(true)
    expect(m('ops_intelligence')).toBe(false)
  })

  it('trial-path venue with no subscription → all modules false', () => {
    const m = (id: string) => moduleActive({ legacyFreeAccess: false, isPilot: false, modules: [], id })
    expect(m('supplier_optimisation')).toBe(false)
    expect(m('ops_intelligence')).toBe(false)
  })
})
