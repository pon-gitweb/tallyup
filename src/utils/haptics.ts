import * as Haptics from 'expo-haptics';

// Haptic weight mapped to emotional significance
// Light = routine confirmation (happens constantly, should be subtle)
// Medium = milestone (area submitted, invoice accepted)
// Heavy = achievement (stocktake complete, department done)
// Warning = something needs attention
// Error = something went wrong

export async function hapticLight() {
  try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
}

export async function hapticMedium() {
  try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
}

export async function hapticHeavy() {
  try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); } catch {}
}

export async function hapticWarning() {
  // Double pulse — something needs attention
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await new Promise(r => setTimeout(r, 100));
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {}
}

export async function hapticAchievement() {
  // Heavy + pause + light — you finished something significant
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await new Promise(r => setTimeout(r, 150));
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {}
}

export async function hapticError() {
  // Three rapid light pulses — something went wrong
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  } catch {}
}

export async function hapticSuccess() {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {}
}
