import { Platform } from 'react-native';

/**
 * canSelfRegister – true on Android/web; false on iOS.
 * Gates account creation, venue creation, and trial sign-up UI.
 * Apple guideline 3.1.1: no in-app account creation or payment on iOS.
 */
export const canSelfRegister: boolean = Platform.OS !== 'ios';

/**
 * canShowPurchasePaths – always false on mobile (both iOS and Android).
 * Purchase paths (subscribe, billing plans, trial upgrade CTAs, paywall
 * pricing) are web-only. Gate all pricing/billing UI on this flag.
 */
export const canShowPurchasePaths: boolean = false;
