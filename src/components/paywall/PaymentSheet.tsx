import React, { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Modal, Platform, Pressable, ScrollView, Text, TextInput, View, ActivityIndicator } from "react-native";
import { validatePromoCode, createCheckout, fetchEntitlement } from "../../services/payments";

type Plan = "monthly" | "yearly";

type Props = {
  visible: boolean;
  onClose: () => void;
  uid: string;
  venueId: string;
  /** NEW: preferred callback */
  onUnlocked?: (entitled: boolean) => void;
  /** LEGACY: for compatibility with existing screens */
  onEntitled?: (entitled: boolean) => void;
  defaultPlan?: Plan;
};

export default function PaymentSheet(props: Props) {
  const { visible, onClose, uid, venueId, onUnlocked, onEntitled, defaultPlan = "monthly" } = props;

  const [promo, setPromo] = useState<string>("");
  const [plan, setPlan] = useState<Plan>(defaultPlan);
  const [busy, setBusy] = useState(false);

  const notifyUnlocked = useCallback((ent: boolean) => {
    try { onUnlocked?.(ent); } catch {}
    try { onEntitled?.(ent); } catch {}
  }, [onUnlocked, onEntitled]);

  // Auto-close if already entitled
  useEffect(() => {
    if (!visible) return;
    (async () => {
      try {
        const { entitled } = await fetchEntitlement(venueId);
        if (entitled) {
          notifyUnlocked(true);
          onClose();
        }
      } catch {
        /* ignore */
      }
    })();
  }, [visible, venueId, notifyUnlocked, onClose]);

  const onContinue = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      // 1) Promo path (dev codes unlock immediately)
      if (promo.trim().length > 0) {
        const res = await validatePromoCode({ uid, venueId, code: promo.trim() });
        if (!res.ok) throw new Error("Promo validation failed.");
        const { entitled } = await fetchEntitlement(venueId);
        if (entitled) {
          notifyUnlocked(true);
          Alert.alert("AI unlocked", "This venue now has AI access.");
          onClose();
          return;
        }
      }

      // 2) Checkout path (stub)
      const c = await createCheckout({ uid, venueId, plan, promoCode: promo || null });
      if (!c.ok) throw new Error("Checkout failed.");
      if (c.promoApplied && (c.amountCents ?? 0) === 0 && !c.checkoutUrl) {
        const { entitled } = await fetchEntitlement(venueId);
        notifyUnlocked(!!entitled);
        Alert.alert("AI unlocked", "Promo applied. AI access enabled for this venue.");
        onClose();
        return;
      }
      const url = c.checkoutUrl;
      if (!url) throw new Error("No checkout URL returned.");
      const ok = await Linking.openURL(url).catch(() => false);
      if (!ok) throw new Error("Could not open checkout.");

      // Best-effort entitlement refresh after browser open
      setTimeout(async () => {
        try { const { entitled } = await fetchEntitlement(venueId); if (entitled) notifyUnlocked(true); } catch {}
      }, 1200);
    } catch (err: any) {
      Alert.alert("Could not continue", String(err?.message || err || "Unknown error"));
    } finally {
      setBusy(false);
    }
  }, [busy, promo, uid, venueId, plan, notifyUnlocked, onClose]);

  const PlanButton = ({ value, label }: { value: Plan; label: string }) => {
    const selected = plan === value;
    return (
      <Pressable
        onPress={() => setPlan(value)}
        style={{
          paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1,
          borderColor: selected ? "#2563EB" : "#E5E7EB", backgroundColor: selected ? "#EFF6FF" : "white",
          minWidth: 120, alignItems: "center",
        }}
      >
        <Text style={{ fontWeight: "600", color: selected ? "#1D4ED8" : "#111827" }}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: "white", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 28, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: "85%" }}>
          <View style={{ height: 4, width: 44, backgroundColor: "#E5E7EB", borderRadius: 2, alignSelf: "center", marginBottom: 12 }} />
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 4 }}>Unlock AI Suggested Orders</Text>
            <Text style={{ color: "#4B5563", marginBottom: 16 }}>Try AI-powered purchase planning. Continue with a promo code or proceed to checkout.</Text>

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
              style={{ borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 8, paddingHorizontal: 12, paddingVertical: Platform.OS === "ios" ? 12 : 8, marginBottom: 16 }}
            />

            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
              <Pressable onPress={onClose} style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: "#F3F4F6", alignItems: "center" }} disabled={busy}>
                <Text style={{ fontWeight: "600", color: "#111827" }}>Not now</Text>
              </Pressable>
              <Pressable onPress={onContinue} style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: busy ? "#93C5FD" : "#2563EB", alignItems: "center" }} disabled={busy}>
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
