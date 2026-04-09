// @ts-nocheck
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

export type StocktakeReportPrefs = {
  showZeroVariance: boolean;
  showExpectedQty: boolean;
  showCostValue: boolean;
  showTotalValue: boolean;
  showSupplier: boolean;
  showCategory: boolean;
  varianceFormat: 'units' | 'percentage' | 'dollars' | 'all';
  groupBy: 'area' | 'supplier' | 'category' | 'none';
  sortBy: 'name' | 'variance' | 'value';
  showLogo: boolean;
  showDate: boolean;
  showSignatureLine: boolean;
  pageSize: 'A4' | 'letter';
};

export type OrderReportPrefs = {
  showUnitCost: boolean;
  showLineTotal: boolean;
  showOrderTotal: boolean;
  showSupplierDetails: boolean;
  showDeliveryNotes: boolean;
  showLogo: boolean;
  showDate: boolean;
  showSignatureLine: boolean;
};

export type ReportPreferences = {
  stocktake: StocktakeReportPrefs;
  order: OrderReportPrefs;
};

export const DEFAULT_STOCKTAKE_PREFS: StocktakeReportPrefs = {
  showZeroVariance: false, showExpectedQty: true, showCostValue: true,
  showTotalValue: true, showSupplier: false, showCategory: true,
  varianceFormat: 'units', groupBy: 'area', sortBy: 'name',
  showLogo: true, showDate: true, showSignatureLine: false, pageSize: 'A4',
};

export const DEFAULT_ORDER_PREFS: OrderReportPrefs = {
  showUnitCost: true, showLineTotal: true, showOrderTotal: true,
  showSupplierDetails: true, showDeliveryNotes: true,
  showLogo: true, showDate: true, showSignatureLine: true,
};

export const DEFAULT_REPORT_PREFS: ReportPreferences = {
  stocktake: DEFAULT_STOCKTAKE_PREFS,
  order: DEFAULT_ORDER_PREFS,
};

const CACHE_KEY = '@hosti_report_prefs';

export async function loadReportPreferences(venueId: string): Promise<ReportPreferences> {
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY + venueId);
    if (cached) return JSON.parse(cached);
    const db = getFirestore();
    const snap = await getDoc(doc(db, 'venues', venueId, 'settings', 'reportPreferences'));
    if (snap.exists()) {
      const data = snap.data() as ReportPreferences;
      const merged = {
        stocktake: { ...DEFAULT_STOCKTAKE_PREFS, ...data.stocktake },
        order: { ...DEFAULT_ORDER_PREFS, ...data.order },
      };
      await AsyncStorage.setItem(CACHE_KEY + venueId, JSON.stringify(merged));
      return merged;
    }
  } catch {}
  return DEFAULT_REPORT_PREFS;
}

export async function saveReportPreferences(venueId: string, prefs: ReportPreferences): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY + venueId, JSON.stringify(prefs));
    const db = getFirestore();
    await setDoc(doc(db, 'venues', venueId, 'settings', 'reportPreferences'), prefs, { merge: true });
  } catch {}
}
