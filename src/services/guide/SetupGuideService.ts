// @ts-nocheck
import AsyncStorage from '@react-native-async-storage/async-storage';

export type GuideStepId = 'venue_created' | 'suppliers_added' | 'products_loaded' | 'departments_ready' | 'first_stocktake' | 'first_order';

export type GuideStep = {
  id: GuideStepId; title: string; description: string; tip: string;
  action: string; actionRoute: string; actionParams?: Record<string, any>;
  completed: boolean; dismissed: boolean;
};

const STORAGE_KEY = '@hosti_setup_guide';
const GUIDE_DISMISSED_KEY = '@hosti_guide_dismissed';

export const GUIDE_STEPS: Omit<GuideStep, 'completed' | 'dismissed'>[] = [
  { id: 'venue_created', title: 'Create your venue', description: 'Your venue is the home base for everything in Hosti-Stock.', tip: "You've already done this one — nice work! 🎉", action: 'View settings', actionRoute: 'Settings' },
  { id: 'suppliers_added', title: 'Add your suppliers', description: 'Add the companies you order from — Bidfood, Gilmours, your local brewery, anyone.', tip: "Start with your top 2-3 suppliers and add more later. Suppliers unlock smarter orders and budget tracking.", action: 'Add suppliers', actionRoute: 'Suppliers' },
  { id: 'products_loaded', title: 'Load your products', description: 'Import your product list so Hosti-Stock knows what you are counting.', tip: "The fastest way is to import a CSV from your supplier or POS system. No CSV? Add products manually or scan barcodes during your first stocktake — Hosti-Stock builds your list as you go.", action: 'Import your inventory', actionRoute: 'InventoryImport' },
  { id: 'departments_ready', title: 'Set up your areas', description: 'Divide your venue into sections — Bar, Kitchen, Cellar, Cool Room.', tip: "We have added some default departments to get you started. Rename them to match your venue or add new ones. Each department can have multiple areas.", action: 'View departments', actionRoute: 'StockControl' },
  { id: 'first_stocktake', title: 'Run your first stocktake', description: 'Count your stock area by area. Tap each item and enter what you see.', tip: "Your first stocktake sets the baseline — it does not need to be perfect. Count what you can, skip what you cannot, and finish. The AI needs at least one completed stocktake to start giving you useful insights.", action: 'Start stocktake', actionRoute: 'StockControl' },
  { id: 'first_order', title: 'Place your first order', description: 'After your stocktake, Hosti-Stock suggests what to order based on what is low.', tip: "The AI suggested order is a starting point — review it, adjust quantities, and submit. After a few cycles the suggestions get much more accurate as the AI learns your usage patterns.", action: 'View suggested orders', actionRoute: 'SuggestedOrder' },
];

export type GuideState = { steps: GuideStep[]; guideFullyDismissed: boolean };

export async function loadGuideState(): Promise<GuideState> {
  try {
    const [raw, dismissed] = await Promise.all([AsyncStorage.getItem(STORAGE_KEY), AsyncStorage.getItem(GUIDE_DISMISSED_KEY)]);
    const saved = raw ? JSON.parse(raw) : {};
    const steps: GuideStep[] = GUIDE_STEPS.map(s => ({ ...s, completed: saved[s.id]?.completed ?? false, dismissed: saved[s.id]?.dismissed ?? false }));
    return { steps, guideFullyDismissed: dismissed === 'true' };
  } catch {
    return { steps: GUIDE_STEPS.map(s => ({ ...s, completed: false, dismissed: false })), guideFullyDismissed: false };
  }
}

export async function markStepComplete(stepId: GuideStepId): Promise<void> {
  try { const raw = await AsyncStorage.getItem(STORAGE_KEY); const saved = raw ? JSON.parse(raw) : {}; saved[stepId] = { ...saved[stepId], completed: true }; await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch {}
}

export async function dismissStep(stepId: GuideStepId): Promise<void> {
  try { const raw = await AsyncStorage.getItem(STORAGE_KEY); const saved = raw ? JSON.parse(raw) : {}; saved[stepId] = { ...saved[stepId], dismissed: true }; await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch {}
}

export async function dismissGuide(): Promise<void> {
  try { await AsyncStorage.setItem(GUIDE_DISMISSED_KEY, 'true'); } catch {}
}

export async function resetGuide(): Promise<void> {
  try { await Promise.all([AsyncStorage.removeItem(STORAGE_KEY), AsyncStorage.removeItem(GUIDE_DISMISSED_KEY)]); } catch {}
}

export function getNextIncompleteStep(steps: GuideStep[]): GuideStep | null {
  return steps.find(s => !s.completed && !s.dismissed) ?? null;
}

export function getCompletedCount(steps: GuideStep[]): number {
  return steps.filter(s => s.completed).length;
}
