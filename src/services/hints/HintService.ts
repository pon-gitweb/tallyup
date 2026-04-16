// @ts-nocheck
/**
 * HintService — contextual one-time hints
 * Shows a hint once, dismisses on tap, never shows again.
 * Resettable from Settings → Reset tips.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = '@hosti_hint_';

export type HintId =
  | 'stocktake_longpress'
  | 'products_longpress'
  | 'orders_longpress'
  | 'scale_connect'
  | 'barcode_scan'
  | 'stocktake_save_indicator';

export const HINT_CONTENT: Record<HintId, { icon: string; text: string }> = {
  stocktake_longpress: {
    icon: '💡',
    text: 'Long press any item to use a Bluetooth scale or photo count',
  },
  products_longpress: {
    icon: '💡',
    text: 'Long press a product to edit or delete it',
  },
  orders_longpress: {
    icon: '💡',
    text: 'Long press an order line to remove it',
  },
  scale_connect: {
    icon: '⚖️',
    text: 'Connect a Bluetooth scale in Settings for automatic weight counting',
  },
  barcode_scan: {
    icon: '📷',
    text: 'Tap the scan button to find products by barcode instantly',
  },
  stocktake_save_indicator: {
    icon: '💚',
    text: 'The green indicator means your count is saved. Tap a count again to update it or add to it.',
  },
};

class HintServiceClass {
  private dismissed = new Set<HintId>();
  private loaded = false;

  private async ensureLoaded() {
    if (this.loaded) return;
    try {
      const keys = Object.keys(HINT_CONTENT) as HintId[];
      for (const key of keys) {
        const val = await AsyncStorage.getItem(PREFIX + key);
        if (val === 'dismissed') this.dismissed.add(key);
      }
    } catch {}
    this.loaded = true;
  }

  async shouldShow(id: HintId): Promise<boolean> {
    await this.ensureLoaded();
    return !this.dismissed.has(id);
  }

  async dismiss(id: HintId): Promise<void> {
    this.dismissed.add(id);
    try { await AsyncStorage.setItem(PREFIX + id, 'dismissed'); } catch {}
  }

  async resetAll(): Promise<void> {
    this.dismissed.clear();
    this.loaded = false;
    try {
      const keys = Object.keys(HINT_CONTENT).map(k => PREFIX + k);
      await AsyncStorage.multiRemove(keys);
    } catch {}
  }
}

export const HintService = new HintServiceClass();
