export type CoreState = 'included' | 'active' | 'buy' | 'owner_only'

export interface CoreViewInput {
  override?: unknown          // truthy = subscriptionOverride present
  legacyFreeAccess?: boolean | null
  venueType?: string | null
  subscriptionStatus?: string | null
  subscriptionPlan?: string | null
  trialPath: boolean          // billing/trialState doc exists
  isOwner: boolean
}

export interface CoreViewResult {
  coreState: CoreState
  isPilot: boolean
  coreActive: boolean
}

export function deriveCoreView(input: CoreViewInput): CoreViewResult {
  const { override, legacyFreeAccess, venueType, subscriptionStatus, subscriptionPlan, trialPath, isOwner } = input
  const reallyActive = subscriptionStatus === 'active' || subscriptionStatus === 'trialing'

  if (override) {
    return { coreState: 'included', isPilot: false, coreActive: true }
  }

  if (legacyFreeAccess) {
    return { coreState: 'included', isPilot: false, coreActive: true }
  }

  if (reallyActive && subscriptionPlan) {
    return { coreState: 'active', isPilot: false, coreActive: true }
  }

  if (venueType === 'festival') {
    return { coreState: 'included', isPilot: true, coreActive: true }
  }

  if (trialPath && isOwner) {
    return { coreState: 'buy', isPilot: false, coreActive: false }
  }

  if (trialPath && !isOwner) {
    return { coreState: 'owner_only', isPilot: false, coreActive: false }
  }

  // pilot, founder, Matchbox, or any other unrecognised path
  return { coreState: 'included', isPilot: true, coreActive: true }
}

export function moduleActive({
  legacyFreeAccess,
  isPilot,
  modules,
  id,
}: {
  legacyFreeAccess: boolean
  isPilot: boolean
  modules: string[]
  id: string
}): boolean {
  return !!(legacyFreeAccess || isPilot || modules.includes(id))
}
