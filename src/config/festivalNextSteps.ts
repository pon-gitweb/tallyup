// Festival dashboard — "Next Steps" hero carousel configuration.
//
// This is the ONLY file that needs editing to change what the carousel offers.
// The carousel component (screens/festival/components/FestivalNextSteps.tsx)
// renders whatever this list returns, in order, filtered by role/visibility.
//
// ⚠️  PLACEHOLDER STEPS — final list pending Poni's decision. The entries below
//     are wired to real, registered routes so the structure is testable today.
//
// Rules the component enforces (so config mistakes can't strand a user):
//   • A step whose `route` isn't registered in the navigator is dropped (and
//     logged in dev) — a typo can never produce a dead card.
//   • Steps with `isDone` true move to the end and show "Done" — still tappable.
//     Order in this file is the suggested order; the first not-done step gets
//     the "Suggested" chip. Nothing is locked — the user chooses.
//   • If nothing is visible, the carousel renders nothing (no empty hero).

export type FestivalRole = 'owner' | 'manager' | 'staff';

export type NextStepContext = {
  role: FestivalRole | null;
  setupDone: number;        // completed setup sections
  setupTotal: number;       // total setup sections
  setupComplete: boolean;
  hasOrders: boolean;
  productCount: number;
  event: any;               // venues/{id}/event/details
};

export type FestivalNextStep = {
  key: string;
  phase: string;            // small eyebrow label, e.g. "Orders & receiving"
  title: string;
  body: string | ((ctx: NextStepContext) => string);
  cta: string;
  route: string;            // must be a registered route name
  params?: Record<string, any>;
  roles: FestivalRole[];
  isVisible?: (ctx: NextStepContext) => boolean;   // default: visible
  isDone?: (ctx: NextStepContext) => boolean;      // default: not done
};

export const FESTIVAL_NEXT_STEPS: FestivalNextStep[] = [
  {
    // Only exists while setup is incomplete — once 6/6 it disappears, and
    // setup stays editable via the "View event setup" link.
    key: 'finish-setup',
    phase: 'Event setup',
    title: 'Finish setting up your event',
    body: ctx => `${ctx.setupDone} of ${ctx.setupTotal} sections done. Pick up where you left off.`,
    cta: 'Continue setup',
    route: 'FestivalEventSetup',
    roles: ['owner', 'manager'],
    isVisible: ctx => !ctx.setupComplete,
  },
  {
    key: 'suggested-order', // PLACEHOLDER
    phase: 'Orders & receiving',
    title: 'Generate your suggested order',
    body: ctx => ctx.productCount > 0
      ? `Built from your setup and ${ctx.productCount} planned products.`
      : 'Built from your bars, storage and product planning.',
    cta: 'Build order',
    route: 'FestivalPurchasingPrediction',
    roles: ['owner', 'manager'],
    isVisible: ctx => ctx.setupDone >= 4,
    isDone: ctx => ctx.hasOrders,
  },
  {
    key: 'goods-in', // PLACEHOLDER
    phase: 'Orders & receiving',
    title: 'Receive deliveries',
    body: 'Check stock in against orders as it arrives on site.',
    cta: 'Open goods in',
    route: 'FestivalGoodsIn',
    roles: ['owner', 'manager'],
    isVisible: ctx => ctx.hasOrders,
  },
  {
    key: 'contracts', // PLACEHOLDER
    phase: 'Contracts & compliance',
    title: 'Load your supplier contracts',
    body: 'Keep pouring rights and volume commitments in one place.',
    cta: 'Open contracts',
    route: 'FestivalContracts',
    roles: ['owner'],
  },
  {
    key: 'obligations', // PLACEHOLDER
    phase: 'Contracts & compliance',
    title: 'Review your obligations',
    body: 'See what you’ve committed to before the gates open.',
    cta: 'Open obligations',
    route: 'FestivalObligations',
    roles: ['owner', 'manager'],
  },
  {
    key: 'load-in', // PLACEHOLDER
    phase: 'Counts',
    title: 'Start your load-in count',
    body: 'Count stock into each bar as it’s set up.',
    cta: 'Choose a bar',
    route: 'FestivalBarSelection',
    roles: ['owner', 'manager', 'staff'],
  },
];
