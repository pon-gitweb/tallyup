import { Platform } from 'react-native';

/**
 * canSelfRegister – true on Android/web; false on iOS.
 * On iOS, Apple guideline 3.1.1 requires that all account and venue creation,
 * trial sign-ups, and payment flows be hidden inside the app. Use this flag to
 * gate any UI that creates a new account, venue, or subscription.
 */
export const canSelfRegister: boolean = Platform.OS !== 'ios';
