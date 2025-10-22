import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking, Modal, Platform, Pressable, ScrollView, Text, TextInput, View, ActivityIndicator } from "react-native";
import { validatePromoCode, createCheckout, fetchEntitlement } from "../../services/payments";

type Plan = "monthly" | "yearly";

type Props = {
  visible: boolean;
  onClose: () => void;
  uid: string;
  venueId: string;
  /** optional callback so parent can flip the "AI locked" pill immediately */
  onUnlocked?: (entitled: boolean) => void;
  defaultPlan?: Plan;
};

export default function PaymentSheet(props: Props) {
  const { visible, onClose, uid, venueId, onUnlocked, defaultPlan = "monthly" } = props;

  const [promo, setPromo] = useState<string>("");
  const [plan, setPlan] = useState<Plan>(defaultPlan);
  const [busy, setBusy] = useState(false);

  // === Auto-refresh entitlement whenever the sheet opens ===
  const refreshEntitlement = useCallback(async () => {
    try {
      const { entitled } = await fetchEntitlement(venueId);
      if (entitled) {
        // already unlocked -> close and notify parent
        onUnlocked?.(true);
        onClose();
      }
    } catch {
      // ignore; sheet will still be usable
    }
  }, [venueId, onUnlocked, onClose]);

  useEffect(() => {
    if (visible) {
      refreshEntitlement();
    }
  }, [visible, refreshEntitlement]);

  const onContinue = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      // 1) If a promo code is entered, validate first
      if ((promo ?? "").trim().length > 0) {
        const res = await validatePromoCode({ uid, venueId, code: promo.trim() });
        if (!res.ok) throw new Error("Promo validation failed.");
        // dev flow: entitled:true when promo matches
        const { entitled } = await fetchEntitlement(venueId);
        if (entitled) {
          onUnlocked?.(true);
          Alert.alert("AI unlocked", "This venue now has AI access.");
          onClose();
          return;
        }
        // If server doesn't mark entitled immediately, fall through to checkout
      }

      // 2) Create a (dev) checkout
      const res2 = await createCheckout({ uid, venueId, plan, promoCode: (promo || null) });
      if (!res2.ok) throw new Error("Checkout failed.");
      // Promo path for dev: promoApplied → amountCents 0 → no URL -> just unlocked on server
      if (res2.promoApplied && (res2.amountCents ?? 0) === 0 && !res2.checkoutUrl) {
        const { entitled } = await fetchEntitlement(venueId);
        onUnlocked?.(!!entitled);
        Alert.alert("AI unlocked", "Promo applied. AI access enabled for this venue.");
        onClose();
        return;
      }

      // 3) URL path
      const url = res2.checkoutUrl;
      if (!url) {
        throw new Error("No checkout URL returned.");
      }
      const ok = await Linking.openURL(url).catch(() => false);
      if (!ok) throw new Error("Could not open checkout.");

      // After browser visit, try to refresh entitlement (dev flow may not change state until manual grant)
      setTimeout(async () => {
        try {
          const { entitled } = await fetchEntitlement(venueId);
          if (entitled) onUnlocked?.(true);
        } catch {}
      }, 1500);
    } catch (err: any) {
      const msg = String(err?.message || err || "Could not continue");
      Alert.alert("Could not continue", msg);
    } finally {
      setBusy(false);
    }
  }, [busy, promo, uid, venueId, plan, onUnlocked, onClose]);

  const PlanButton = useCallback(({ value, label }: { value: Plan; label: string }) => {
    const selected = plan === value;
    return (
      <Pressable
        onPress={() => setPlan(value)}
        style={{
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: selected ? "#2563EB" : "#E5E7EB",
          backgroundColor: selected ? "#EFF6FF" : "white",
          minWidth: 120,
          alignItems: "center",
        }}
      >
        <Text style={{ fontWeight: "600", color: selected ? "#1D4ED8" : "#111827" }}>{label}</Text>
      </Pressable>
    );
  }, [plan]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: "white", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 28, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: "85%" }}>
          <View style={{ height: 4, width: 44, backgroundColor: "#E5E7EB", borderRadius: 2, alignSelf: "center", marginBottom: 12 }} />
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 4 }}>Unlock AI Suggested Orders</Text>
            <Text style={{ color: "#4B5563", marginBottom: 16 }}>
              Try AI-powered purchase planning. Continue with a promo code or proceed to checkout.
            </Text>

            <View style={{ flexDirection: "row", gap: 12, marginBottom: 16 }}>
              <PlanButton value="monthly" label="Monthly · $29" />
              <PlanButton value="yearly" label="Yearly · $290" />
            </View>

            <Text style={{ fontWeight: "600", marginBottom: 6 }}>Promo code (optional)</Text>
            <TextInput
              placeholder="Enter promo code"
              value={promo}
              onChangeText={setPromo}
              autoCapitalize="characters"
              autoCorrect={false}
              style={{
                borderWidth: 1,
                borderColor: "#E5E7EB",
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: Platform.OS === "ios" ? 12 : 8,
                marginBottom: 16,
              }}
            />

            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
              <Pressable
                onPress={onClose}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: "#F3F4F6", alignItems: "center" }}
                disabled={busy}
              >
                <Text style={{ fontWeight: "600", color: "#111827" }}>Not now</Text>
              </Pressable>
              <Pressable
                onPress={onContinue}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: busy ? "#93C5FD" : "#2563EB", alignItems: "center" }}
                disabled={busy}
              >
                {busy ? <ActivityIndicator color="white" /> : <Text style={{ fontWeight: "700", color: "white" }}>Continue</Text>}
              </Pressable>
            </View>

            <Text style={{ color: "#6B7280", marginTop: 12, fontSize: 12 }}>
              You’ll complete payment on a secure page. Promo discounts apply at checkout.
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
